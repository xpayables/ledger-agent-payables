import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { createGatewayServer } from "../core/gateway.mjs";
import { createBudgetLedger } from "../core/budget.mjs";
import { createVelocityWindow } from "../core/velocity.mjs";
import { MockSignerAdapter, LedgerSignerAdapter } from "../core/signer.mjs";
import { localEip191App } from "../core/local-signer.mjs";
import { approvalMessage } from "../core/policy-message.mjs";
import { usd } from "../core/money.mjs";

async function buildGateway({ ownerSigner } = {}) {
  const signer = ownerSigner ?? new MockSignerAdapter();
  const future = new Date(Date.now() + 3_600_000).toISOString();

  const policy = {
    id: "policy_test",
    gatewayDomain: "localhost",
    network: "eip155:5042002",
    currency: "USDC",
    asset: "arc-testnet-usdc",
    agentId: "agent-1",
    ownerAddress: await signer.getAddress(),
    allowedVendors: ["weather"],
    maxAmountAtomic: usd(0.05),
    dailyBudgetAtomic: usd(1),
    maxRequestsPerMinute: 60,
    expiresAt: future,
  };
  const signedPolicy = await signer.signPolicy(policy);

  const runs = new Map([
    [
      "run-main",
      { id: "run-main", policyId: policy.id, agentId: "agent-1", taskLabel: "run-main", runBudgetAtomic: usd(0.05), maxRequestsPerMinute: 60, expiresAt: future, status: "active" },
    ],
  ]);

  const budget = createBudgetLedger({ policyDailyAtomic: policy.dailyBudgetAtomic });
  const velocityByRun = new Map();
  for (const run of runs.values()) {
    budget.registerRun(run.id, run.runBudgetAtomic);
    velocityByRun.set(run.id, createVelocityWindow({ maxRequestsPerMinute: run.maxRequestsPerMinute }));
  }

  const resources = new Map([
    ["/vendor/weather/paid/a", { vendorId: "weather", amountAtomic: usd(0.02), content: "A" }],
    ["/vendor/market/paid/x", { vendorId: "market", amountAtomic: usd(0.02), content: "M" }],
  ]);

  const gateway = createGatewayServer({ policy, runs, budget, velocityByRun, resources, signedPolicy });
  await new Promise((resolve) => gateway.server.listen(0, "127.0.0.1", resolve));
  const { port } = gateway.server.address();
  return { ...gateway, signer, policy, runs, budget, origin: `http://127.0.0.1:${port}` };
}

async function post(origin, path, body) {
  const res = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(origin, path) {
  const res = await fetch(`${origin}${path}`);
  return { status: res.status, body: await res.json() };
}

function marketRequest(over = {}) {
  return {
    agentId: "agent-1",
    runId: "run-main",
    resourceUrl: "/vendor/market/paid/x",
    idempotencyKey: crypto.randomUUID(),
    ...over,
  };
}

async function openException(gateway, over = {}) {
  const response = await post(gateway.origin, "/guarded-request", marketRequest(over));
  assert.equal(response.status, 202);
  assert.ok(response.body.exceptionId);
  const { body } = await get(gateway.origin, "/exceptions");
  return body.exceptions.find((exception) => exception.id === response.body.exceptionId);
}

test("needs_approval opens a pending exception with canonical message", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const exception = await openException(gateway);
  assert.equal(exception.status, "pending");
  assert.equal(exception.type, "new_vendor");
  assert.equal(exception.vendorId, "market");
  assert.equal(exception.amountAtomic, usd(0.02));

  const message = await get(gateway.origin, `/exceptions/${exception.id}/message`);
  assert.equal(message.status, 200);
  assert.equal(message.body.message, approvalMessage(exception));
});

test("owner-signed approval executes the recorded request", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const request = marketRequest();
  await post(gateway.origin, "/guarded-request", request);
  const exception = (await get(gateway.origin, "/exceptions")).body.exceptions[0];

  const approval = await gateway.signer.signApproval(exception);
  const approved = await post(gateway.origin, `/exceptions/${exception.id}/approve`, { approval });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.decision, "approved");
  assert.equal(approved.body.reason, "exception_approved");
  assert.equal(approved.body.status, "payment_settled");
  assert.equal(approved.body.paidResource.status, 200);
  assert.equal(approved.body.exception.status, "approved");
  assert.equal(approved.body.exception.approverAddress, await gateway.signer.getAddress());
  assert.equal(gateway.budget.runSnapshot("run-main").runSettled, usd(0.02));
  assert.equal(gateway.statementRows().find((row) => row.vendorId === "market").decision, "approved");

  const replay = await post(gateway.origin, "/guarded-request", request);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.decision, "approved");
  assert.equal(replay.body.status, "payment_settled");
  assert.equal(gateway.events.length, 1);
});

test("approval signed by a non-owner is rejected", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const exception = await openException(gateway);
  const intruder = new MockSignerAdapter();
  const approval = await intruder.signApproval(exception);
  const rejected = await post(gateway.origin, `/exceptions/${exception.id}/approve`, { approval });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.body.error, "approver_not_policy_owner");
});

test("approval signature cannot be replayed onto a different exception", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const first = await openException(gateway);
  const second = await openException(gateway, { resourceUrl: "/vendor/market/paid/x" });
  assert.notEqual(first.id, second.id);

  const approvalForFirst = await gateway.signer.signApproval(first);
  const replayed = await post(gateway.origin, `/exceptions/${second.id}/approve`, { approval: approvalForFirst });
  assert.equal(replayed.status, 403);
  assert.equal(replayed.body.error, "approval_signature_invalid");

  const legit = await post(gateway.origin, `/exceptions/${first.id}/approve`, { approval: approvalForFirst });
  assert.equal(legit.status, 200);
});

test("unknown exception id, double approval, and missing signature fail closed", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const missing = await post(gateway.origin, "/exceptions/nope/approve", { approval: {} });
  assert.equal(missing.status, 404);

  const exception = await openException(gateway);
  const noSignature = await post(gateway.origin, `/exceptions/${exception.id}/approve`, {});
  assert.equal(noSignature.status, 400);

  const approval = await gateway.signer.signApproval(exception);
  const first = await post(gateway.origin, `/exceptions/${exception.id}/approve`, { approval });
  assert.equal(first.status, 200);
  const again = await post(gateway.origin, `/exceptions/${exception.id}/approve`, { approval });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "exception_not_pending");
});

test("approval still binds to budget", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  await post(gateway.origin, "/guarded-request", marketRequest({ resourceUrl: "/vendor/weather/paid/a" }));
  await post(gateway.origin, "/guarded-request", marketRequest({ resourceUrl: "/vendor/weather/paid/a" }));
  assert.equal(gateway.budget.runSnapshot("run-main").runRemaining, usd(0.01));

  const exception = await openException(gateway);
  const approval = await gateway.signer.signApproval(exception);
  const blocked = await post(gateway.origin, `/exceptions/${exception.id}/approve`, { approval });
  assert.equal(blocked.status, 422);
  assert.equal(blocked.body.error, "budget_exceeded");
  const refreshed = (await get(gateway.origin, "/exceptions")).body.exceptions.find((e) => e.id === exception.id);
  assert.equal(refreshed.status, "pending");
});

test("Ledger EIP-191 approval verifies end to end", async (t) => {
  const account = privateKeyToAccount(generatePrivateKey());
  const ledgerSigner = new LedgerSignerAdapter({ app: localEip191App(account) });
  const gateway = await buildGateway({ ownerSigner: ledgerSigner });
  t.after(() => gateway.server.close());
  const exception = await openException(gateway);

  const approval = await ledgerSigner.signApproval(exception);
  const approved = await post(gateway.origin, `/exceptions/${exception.id}/approve`, { approval });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.decision, "approved");
  assert.equal(approved.body.status, "payment_settled");

  const tamperedException = await openException(gateway);
  const tamperedApproval = await ledgerSigner.signApproval({ ...tamperedException, amountAtomic: usd(5) });
  const rejected = await post(gateway.origin, `/exceptions/${tamperedException.id}/approve`, { approval: tamperedApproval });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.body.error, "approval_signature_invalid");
});

test("forged mock approval is rejected", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const exception = await openException(gateway);
  const ownerAddress = await gateway.signer.getAddress();

  const intruder = new MockSignerAdapter();
  const forged = { ...(await intruder.signApproval(exception)), signer: ownerAddress };
  const rejected = await post(gateway.origin, `/exceptions/${exception.id}/approve`, { approval: forged });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.body.error, "approval_signature_invalid");

  const legit = await post(gateway.origin, `/exceptions/${exception.id}/approve`, { approval: await gateway.signer.signApproval(exception) });
  assert.equal(legit.status, 200);
});

test("signatureType downgrade is rejected", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const exception = await openException(gateway);
  const approval = await gateway.signer.signApproval(exception);
  const downgraded = { ...approval, signatureType: "ledger-eip191" };
  const rejected = await post(gateway.origin, `/exceptions/${exception.id}/approve`, { approval: downgraded });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.body.error, "approval_signature_type_mismatch");
});

test("concurrent double-approval settles exactly once", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const exception = await openException(gateway);
  const approval = await gateway.signer.signApproval(exception);

  const responses = await Promise.all(
    Array.from({ length: 5 }, () => post(gateway.origin, `/exceptions/${exception.id}/approve`, { approval })),
  );
  assert.equal(responses.filter((r) => r.status === 200).length, 1);
  assert.equal(responses.filter((r) => r.status === 409).length, 4);
  assert.equal(gateway.budget.runSnapshot("run-main").runSettled, usd(0.02));
});

test("approval after policy expiry fails closed", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const exception = await openException(gateway);
  const approval = await gateway.signer.signApproval(exception);
  gateway.policy.expiresAt = new Date(Date.now() - 1000).toISOString();
  const blocked = await post(gateway.origin, `/exceptions/${exception.id}/approve`, { approval });
  assert.equal(blocked.status, 422);
  assert.equal(blocked.body.error, "expired_policy");
  const refreshed = (await get(gateway.origin, "/exceptions")).body.exceptions.find((e) => e.id === exception.id);
  assert.equal(refreshed.status, "pending");
});

test("approval after the run goes inactive fails closed", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const exception = await openException(gateway);
  const approval = await gateway.signer.signApproval(exception);
  gateway.runs.get("run-main").status = "closed";
  const blocked = await post(gateway.origin, `/exceptions/${exception.id}/approve`, { approval });
  assert.equal(blocked.status, 422);
  assert.equal(blocked.body.error, "run_not_active");
  const refreshed = (await get(gateway.origin, "/exceptions")).body.exceptions.find((e) => e.id === exception.id);
  assert.equal(refreshed.status, "pending");
});
