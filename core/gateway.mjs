// Policy gateway for guarded requests, mock paid resources, and exceptions.
import http from "node:http";
import crypto from "node:crypto";

import { fromAtomic } from "./money.mjs";
import { requestFingerprint } from "./fingerprint.mjs";
import { decide } from "./policy-engine.mjs";
import { approvalMessage, approvalMessageHex } from "./policy-message.mjs";
import { verifyApprovalSignature, verifyPolicySignature } from "./signer.mjs";
import { createBudgetLedger } from "./budget.mjs";
import { createVelocityWindow } from "./velocity.mjs";
import { dashboardHtml } from "./dashboard.mjs";

export function createGatewayServer({
  policy,
  runs,
  budget,
  velocityByRun,
  resources,
  resourceClient,
  signedPolicy,
  demoApprovalSigner,
  demoTargets = [],
}) {
  const events = [];
  const idempotencyIndex = new Map();
  const exceptions = [];
  const exceptionsById = new Map();

  function configure({ policy: nextPolicy, signed, runBudgetAtomic }) {
    policy = nextPolicy;
    signedPolicy = signed ?? null;
    budget = createBudgetLedger({ policyDailyAtomic: policy.dailyBudgetAtomic });
    const runId = "run_console_001";
    const runBudget = runBudgetAtomic ?? policy.dailyBudgetAtomic;
    runs = new Map([
      [
        runId,
        {
          id: runId,
          policyId: policy.id,
          agentId: policy.agentId,
          taskLabel: "console session",
          runBudgetAtomic: runBudget,
          maxRequestsPerMinute: policy.maxRequestsPerMinute,
          expiresAt: policy.expiresAt,
          status: "active",
        },
      ],
    ]);
    budget.registerRun(runId, runBudget);
    velocityByRun = new Map([[runId, createVelocityWindow({ maxRequestsPerMinute: policy.maxRequestsPerMinute })]]);
    events.length = 0;
    idempotencyIndex.clear();
    exceptions.length = 0;
    exceptionsById.clear();
    return { runId };
  }

  function sameOriginTarget(resourceUrl, origin) {
    try {
      const target = new URL(resourceUrl, origin);
      return target.origin === origin ? target.href : null;
    } catch {
      return null;
    }
  }

  const client = resourceClient ?? {
    async getRequirement(resourceUrl, { origin }) {
      const target = sameOriginTarget(resourceUrl, origin);
      if (!target) return null;
      const challenge = await fetch(target);
      if (challenge.status !== 402) return null;
      return challenge.json();
    },

    async pay({ resourceUrl, idempotencyKey }, { origin }) {
      const target = sameOriginTarget(resourceUrl, origin);
      if (!target) throw new Error("resourceUrl_outside_gateway_origin");
      const response = await fetch(target, {
        headers: { "X-Mock-Payment": `settled:${idempotencyKey}` },
      });
      return { status: response.status, body: await response.json() };
    },
  };

  function jsonResponse(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload, null, 2));
  }

  async function readJson(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  }

  function recordEvent(request, requirement, decision) {
    const event = {
      id: crypto.randomUUID(),
      idempotencyKey: request.idempotencyKey,
      requestFingerprint: requestFingerprint({ policy, request, requirement }),
      policyId: policy.id,
      runId: request.runId,
      agentId: request.agentId,
      vendorId: requirement.vendorId,
      resourceUrl: request.resourceUrl,
      method: request.method ?? "GET",
      requestBody: request.body ?? null,
      amountAtomic: requirement.amountAtomic,
      currency: policy.currency,
      network: policy.network,
      decision: decision.decision,
      decisionReason: decision.reason,
      status: decision.decision === "approved" ? "payment_pending" : "decision_recorded",
      paidResourceStatus: null,
      txHash: null,
      exceptionId: null,
      createdAt: new Date().toISOString(),
    };
    events.push(event);
    idempotencyIndex.set(event.idempotencyKey, event);
    return event;
  }

  function recordException(event, decision) {
    const exception = {
      id: crypto.randomUUID(),
      policyId: policy.id,
      gatewayDomain: policy.gatewayDomain,
      network: policy.network,
      ownerAddress: policy.ownerAddress,
      eventId: event.id,
      type: decision.reason,
      status: "pending",
      runId: event.runId,
      agentId: event.agentId,
      vendorId: event.vendorId,
      resourceUrl: event.resourceUrl,
      amountAtomic: event.amountAtomic,
      currency: event.currency,
      approverAddress: null,
      approvalSignature: null,
      createdAt: event.createdAt,
      resolvedAt: null,
    };
    exceptions.push(exception);
    exceptionsById.set(exception.id, exception);
    event.exceptionId = exception.id;
    return exception;
  }

  async function executeReservedPayment(event, origin) {
    try {
      const paid = await client.pay(
        { resourceUrl: event.resourceUrl, idempotencyKey: event.idempotencyKey, amountAtomic: event.amountAtomic },
        { origin, method: event.method, body: event.requestBody },
      );
      budget.settle(event.runId, event.amountAtomic);
      event.status = "payment_settled";
      event.paidResourceStatus = paid.status;
      event.txHash = paid.settlement?.transaction ?? null;
      return paid;
    } catch (error) {
      budget.release(event.runId, event.amountAtomic);
      event.decision = "blocked";
      event.decisionReason = "payment_failed";
      event.status = "payment_failed";
      event.paidResourceStatus = 502;
      return { status: 502, body: { error: error.message } };
    }
  }

  function statementRows() {
    const rows = new Map();
    for (const event of events) {
      const key = `${event.agentId}:${event.vendorId}:${event.decision}`;
      const row =
        rows.get(key) ??
        { agentId: event.agentId, vendorId: event.vendorId, decision: event.decision, requestCount: 0, approvedAtomic: 0, attemptedAtomic: 0 };
      row.requestCount += 1;
      row.attemptedAtomic += event.amountAtomic;
      if (event.decision === "approved") row.approvedAtomic += event.amountAtomic;
      rows.set(key, row);
    }
    return [...rows.values()].map((row) => ({
      agentId: row.agentId,
      vendorId: row.vendorId,
      decision: row.decision,
      requestCount: row.requestCount,
      approvedUsd: fromAtomic(row.approvedAtomic),
      attemptedUsd: fromAtomic(row.attemptedAtomic),
    }));
  }

  function statusFor(event) {
    if (event.decision === "approved") return 201;
    if (event.decision === "needs_approval") return 202;
    if (event.decisionReason === "rate_limit") return 429;
    if (event.decisionReason === "agent_not_authorized" || event.decisionReason === "run_not_authorized") return 403;
    if (event.decisionReason === "payment_failed") return 503;
    return 422;
  }

  function decisionResponse(event, paidResource, remainingBudgetAtomic) {
    return {
      decision: event.decision,
      reason: event.decisionReason,
      eventId: event.id,
      idempotencyKey: event.idempotencyKey,
      amountAtomic: event.amountAtomic,
      status: event.status,
      remainingBudgetAtomic,
      requiresLedger: event.decision === "needs_approval",
      exceptionId: event.exceptionId,
      paidResource: paidResource ?? null,
    };
  }

  function handlePaidResource(req, res, pathname) {
    if (!policy) return jsonResponse(res, 409, { error: "no_active_policy" });
    const resource = resources?.get(pathname);
    if (!resource) return jsonResponse(res, 404, { error: "resource_not_found" });
    if (!req.headers["x-mock-payment"]) {
      return jsonResponse(res, 402, {
        error: "payment_required",
        vendorId: resource.vendorId,
        amountAtomic: resource.amountAtomic,
        currency: policy.currency,
        network: policy.network,
      });
    }
    return jsonResponse(res, 200, { ok: true, vendorId: resource.vendorId, content: resource.content });
  }

  async function handleGuardedRequest(req, res, origin) {
    if (!policy) return jsonResponse(res, 409, { error: "no_active_policy" });
    const request = await readJson(req);
    if (!request.agentId || !request.runId || !request.resourceUrl || !request.idempotencyKey) {
      return jsonResponse(res, 400, { error: "missing_required_fields" });
    }

    const requirement = await client.getRequirement(request.resourceUrl, { origin, method: request.method, body: request.body });
    if (!requirement) return jsonResponse(res, 502, { error: "paid_resource_did_not_return_402" });

    const currentFingerprint = requestFingerprint({ policy, request, requirement });
    const existing = idempotencyIndex.get(request.idempotencyKey);
    if (existing?.requestFingerprint === currentFingerprint) {
      const remaining = runs.has(existing.runId) ? budget.runSnapshot(existing.runId).runRemaining : null;
      return jsonResponse(res, 200, { replayed: true, ...decisionResponse(existing, null, remaining) });
    }
    if (existing) return jsonResponse(res, 409, { decision: "blocked", reason: "idempotency_conflict" });

    const run = runs.get(request.runId);
    if (!run) {
      const event = recordEvent(request, requirement, { decision: "blocked", reason: "run_not_active" });
      return jsonResponse(res, statusFor(event), decisionResponse(event, null, null));
    }
    const velocityExceeded = !velocityByRun.get(run.id).tryConsume();
    let decision = decide({ policy, run, request, requirement, velocityExceeded });
    let reserved = false;

    if (decision.decision === "approved") {
      reserved = budget.reserve(run.id, requirement.amountAtomic).ok;
      if (!reserved) decision = { decision: "blocked", reason: "budget_exceeded" };
    }

    const event = recordEvent(request, requirement, decision);
    if (decision.decision === "needs_approval") recordException(event, decision);
    const paidResource = reserved ? await executeReservedPayment(event, origin) : null;
    const remainingBudgetAtomic = budget.runSnapshot(run.id).runRemaining;
    return jsonResponse(res, statusFor(event), decisionResponse(event, paidResource, remainingBudgetAtomic));
  }

  async function handleApproveException(req, res, exception, origin) {
    if (exception.status !== "pending") {
      return jsonResponse(res, 409, { error: "exception_not_pending", status: exception.status });
    }
    exception.status = "approving";
    const fail = (code, payload) => {
      exception.status = "pending";
      return jsonResponse(res, code, payload);
    };

    const { approval } = await readJson(req);
    if (!approval?.signature || !approval?.signatureType || !approval?.signer) {
      return fail(400, { error: "missing_approval_signature" });
    }
    if (signedPolicy && approval.signatureType !== signedPolicy.signatureType) {
      return fail(403, { error: "approval_signature_type_mismatch" });
    }
    if (approval.signer.toLowerCase() !== policy.ownerAddress.toLowerCase()) {
      return fail(403, { error: "approver_not_policy_owner" });
    }

    let valid = false;
    try {
      valid = await verifyApprovalSignature(exception, approval);
    } catch {
      valid = false;
    }
    if (!valid) return fail(403, { error: "approval_signature_invalid" });

    const run = runs.get(exception.runId);
    if (new Date(policy.expiresAt) <= new Date()) return fail(422, { error: "expired_policy" });
    if (!run || run.status !== "active" || new Date(run.expiresAt) <= new Date()) {
      return fail(422, { error: "run_not_active" });
    }
    if (!budget.reserve(exception.runId, exception.amountAtomic).ok) {
      return fail(422, { error: "budget_exceeded" });
    }

    const event = events.find((e) => e.id === exception.eventId);
    event.decision = "approved";
    event.decisionReason = "exception_approved";
    event.status = "payment_pending";

    const paidResource = await executeReservedPayment(event, origin);
    if (event.status === "payment_failed") {
      exception.status = "pending";
      return jsonResponse(res, statusFor(event), decisionResponse(event, paidResource, budget.runSnapshot(exception.runId).runRemaining));
    }

    exception.status = "approved";
    exception.approverAddress = approval.signer;
    exception.approvalSignature = { signature: approval.signature, signatureType: approval.signatureType };
    exception.resolvedAt = new Date().toISOString();

    const remainingBudgetAtomic = budget.runSnapshot(exception.runId).runRemaining;
    return jsonResponse(res, 200, {
      exception,
      ...decisionResponse(event, paidResource, remainingBudgetAtomic),
    });
  }

  async function handleSetPolicy(req, res) {
    const { policy: nextPolicy, signed, runBudgetAtomic } = await readJson(req);
    if (!nextPolicy || !signed?.signature) return jsonResponse(res, 400, { error: "missing_policy_or_signature" });
    if (signed.signer?.toLowerCase() !== nextPolicy.ownerAddress?.toLowerCase()) {
      return jsonResponse(res, 403, { error: "signer_not_owner" });
    }

    let valid = false;
    try {
      valid = await verifyPolicySignature(nextPolicy, signed);
    } catch {
      valid = false;
    }
    if (!valid) return jsonResponse(res, 403, { error: "policy_signature_invalid" });
    const { runId } = configure({ policy: nextPolicy, signed, runBudgetAtomic });
    return jsonResponse(res, 200, { ok: true, policy: nextPolicy, runId });
  }

  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }

      const origin = `http://${req.headers.host}`;
      const { pathname } = new URL(req.url, origin);
      if (req.method === "GET" && pathname.startsWith("/vendor/")) return handlePaidResource(req, res, pathname);
      if (req.method === "POST" && pathname === "/guarded-request") return handleGuardedRequest(req, res, origin);
      if (req.method === "POST" && pathname === "/policy") return handleSetPolicy(req, res);
      if (req.method === "GET" && pathname === "/statement") return jsonResponse(res, 200, { rows: statementRows() });
      if (req.method === "GET" && pathname === "/exceptions") return jsonResponse(res, 200, { exceptions });
      if (req.method === "GET" && pathname === "/dashboard") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(dashboardHtml());
      }
      if (req.method === "GET" && pathname === "/policy") {
        return jsonResponse(res, 200, {
          policy: policy ?? null,
          signature: signedPolicy
            ? { signer: signedPolicy.signer, signatureType: signedPolicy.signatureType }
            : null,
        });
      }
      if (req.method === "GET" && pathname === "/budget") {
        if (!budget) return jsonResponse(res, 200, { policy: null, runs: [] });
        return jsonResponse(res, 200, {
          policy: budget.policySnapshot(),
          runs: [...runs.values()].map((run) => ({ id: run.id, taskLabel: run.taskLabel, ...budget.runSnapshot(run.id) })),
        });
      }
      if (req.method === "GET" && pathname === "/events") {
        return jsonResponse(res, 200, { events: events.slice(-200).reverse() });
      }
      if (req.method === "GET" && pathname === "/demo-targets") {
        return jsonResponse(res, 200, { targets: demoTargets });
      }
      if (req.method === "POST" && pathname === "/demo/sign-approval") {
        if (!demoApprovalSigner) return jsonResponse(res, 404, { error: "demo_signing_not_enabled" });
        const { exceptionId } = await readJson(req);
        const exception = exceptionsById.get(exceptionId);
        if (!exception) return jsonResponse(res, 404, { error: "exception_not_found" });
        return jsonResponse(res, 200, { approval: await demoApprovalSigner.signApproval(exception) });
      }

      const exceptionRoute = pathname.match(/^\/exceptions\/([^/]+)\/(message|approve)$/);
      if (exceptionRoute) {
        const exception = exceptionsById.get(exceptionRoute[1]);
        if (!exception) return jsonResponse(res, 404, { error: "exception_not_found" });
        if (req.method === "GET" && exceptionRoute[2] === "message") {
          return jsonResponse(res, 200, {
            exceptionId: exception.id,
            message: approvalMessage(exception),
            messageHex: approvalMessageHex(exception),
          });
        }
        if (req.method === "POST" && exceptionRoute[2] === "approve") {
          return handleApproveException(req, res, exception, origin);
        }
      }
      return jsonResponse(res, 404, { error: "not_found" });
    } catch (error) {
      return jsonResponse(res, 500, { error: error.message });
    }
  });

  return { server, events, exceptions, statementRows };
}
