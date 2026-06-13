import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { createGatewayServer } from "../core/gateway.mjs";
import { createBudgetLedger } from "../core/budget.mjs";
import { createVelocityWindow } from "../core/velocity.mjs";
import { MockSignerAdapter } from "../core/signer.mjs";
import { usd } from "../core/money.mjs";

async function buildGateway() {
  const signer = new MockSignerAdapter();
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

  const runDefs = [
    { id: "run-main", runBudgetAtomic: usd(0.03), maxRequestsPerMinute: 60 },
    { id: "run-rate", runBudgetAtomic: usd(1), maxRequestsPerMinute: 2 },
    { id: "run-concur", runBudgetAtomic: usd(1), maxRequestsPerMinute: 100 },
  ];
  const runs = new Map(
    runDefs.map((run) => [
      run.id,
      {
        id: run.id,
        policyId: policy.id,
        agentId: "agent-1",
        taskLabel: run.id,
        runBudgetAtomic: run.runBudgetAtomic,
        maxRequestsPerMinute: run.maxRequestsPerMinute,
        expiresAt: future,
        status: "active",
      },
    ]),
  );

  const budget = createBudgetLedger({ policyDailyAtomic: policy.dailyBudgetAtomic });
  const velocityByRun = new Map();
  for (const run of runs.values()) {
    budget.registerRun(run.id, run.runBudgetAtomic);
    velocityByRun.set(run.id, createVelocityWindow({ maxRequestsPerMinute: run.maxRequestsPerMinute }));
  }

  const resources = new Map([
    ["/vendor/weather/paid/a", { vendorId: "weather", amountAtomic: usd(0.02), content: "A" }],
    ["/vendor/weather/paid/b", { vendorId: "weather", amountAtomic: usd(0.02), content: "B" }],
    ["/vendor/weather/paid/expensive", { vendorId: "weather", amountAtomic: usd(0.1), content: "E" }],
    ["/vendor/market/paid/x", { vendorId: "market", amountAtomic: usd(0.02), content: "M" }],
  ]);

  const gateway = createGatewayServer({ policy, runs, budget, velocityByRun, resources });
  await new Promise((resolve) => gateway.server.listen(0, "127.0.0.1", resolve));
  const { port } = gateway.server.address();
  return { ...gateway, budget, origin: `http://127.0.0.1:${port}` };
}

function req(over = {}) {
  return {
    agentId: "agent-1",
    runId: "run-main",
    resourceUrl: "/vendor/weather/paid/a",
    idempotencyKey: crypto.randomUUID(),
    ...over,
  };
}

async function post(origin, body) {
  const res = await fetch(`${origin}/guarded-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test("approved request settles", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const response = await post(gateway.origin, req());
  assert.equal(response.status, 201);
  assert.equal(response.body.decision, "approved");
  assert.equal(response.body.paidResource.status, 200);
  assert.equal(response.body.status, "payment_settled");
  assert.equal(typeof response.body.remainingBudgetAtomic, "number");
  assert.equal(response.body.requiresLedger, false);
});

test("amount over per-payment cap returns 422", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const response = await post(gateway.origin, req({ resourceUrl: "/vendor/weather/paid/expensive" }));
  assert.equal(response.status, 422);
  assert.equal(response.body.reason, "amount_exceeds_limit");
});

test("non-allowlisted vendor returns 202 needs_approval", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const response = await post(gateway.origin, req({ resourceUrl: "/vendor/market/paid/x" }));
  assert.equal(response.status, 202);
  assert.equal(response.body.reason, "new_vendor");
  assert.equal(response.body.requiresLedger, true);
});

test("agent not authorized returns 403", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const response = await post(gateway.origin, req({ agentId: "intruder" }));
  assert.equal(response.status, 403);
  assert.equal(response.body.reason, "agent_not_authorized");
});

test("idempotent replay returns original event", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const body = req();
  const first = await post(gateway.origin, body);
  const second = await post(gateway.origin, body);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.replayed, true);
  assert.equal(second.body.eventId, first.body.eventId);
  assert.equal(gateway.events.length, 1);
});

test("same idempotency key with different request returns 409", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const key = crypto.randomUUID();
  await post(gateway.origin, req({ idempotencyKey: key, resourceUrl: "/vendor/weather/paid/a" }));
  const conflict = await post(gateway.origin, req({ idempotencyKey: key, resourceUrl: "/vendor/weather/paid/b" }));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.reason, "idempotency_conflict");
});

test("requests beyond the run rate limit return 429", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const r1 = await post(gateway.origin, req({ runId: "run-rate" }));
  const r2 = await post(gateway.origin, req({ runId: "run-rate" }));
  const r3 = await post(gateway.origin, req({ runId: "run-rate" }));
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 201);
  assert.equal(r3.status, 429);
  assert.equal(r3.body.reason, "rate_limit");
});

test("run budget allows only one over-committing request", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const [a, b] = await Promise.all([
    post(gateway.origin, req({ resourceUrl: "/vendor/weather/paid/a" })),
    post(gateway.origin, req({ resourceUrl: "/vendor/weather/paid/b" })),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 422]);
  assert.equal([a, b].find((r) => r.status === 422).body.reason, "budget_exceeded");
});

test("concurrent same-key retries cannot double-spend", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const body = req({ runId: "run-concur" });
  const responses = await Promise.all(Array.from({ length: 5 }, () => post(gateway.origin, body)));
  assert.equal(gateway.events.length, 1);
  assert.equal(gateway.budget.runSnapshot("run-concur").runSettled, usd(0.02));
  assert.equal(responses.filter((r) => r.status === 201).length, 1);
  assert.equal(responses.filter((r) => r.status === 200).length, 4);
});

test("missing required fields returns 400", async (t) => {
  const gateway = await buildGateway();
  t.after(() => gateway.server.close());
  const response = await post(gateway.origin, { agentId: "agent-1" });
  assert.equal(response.status, 400);
});

test("guarded request threads method/body to the resourceClient", async (t) => {
  const signer = new MockSignerAdapter();
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const policy = {
    id: "policy_post",
    gatewayDomain: "localhost",
    network: "eip155:5042002",
    currency: "USDC",
    asset: "arc-testnet-usdc",
    agentId: "agent-1",
    ownerAddress: await signer.getAddress(),
    allowedVendors: ["chatvendor"],
    maxAmountAtomic: usd(0.05),
    dailyBudgetAtomic: usd(1),
    maxRequestsPerMinute: 60,
    expiresAt: future,
  };
  const runs = new Map([
    ["run-main", { id: "run-main", policyId: policy.id, agentId: "agent-1", taskLabel: "t", runBudgetAtomic: usd(1), maxRequestsPerMinute: 60, expiresAt: future, status: "active" }],
  ]);
  const budget = createBudgetLedger({ policyDailyAtomic: policy.dailyBudgetAtomic });
  const velocityByRun = new Map();
  for (const run of runs.values()) {
    budget.registerRun(run.id, run.runBudgetAtomic);
    velocityByRun.set(run.id, createVelocityWindow({ maxRequestsPerMinute: run.maxRequestsPerMinute }));
  }
  const seen = {};
  const resourceClient = {
    async getRequirement(_url, ctx) {
      seen.get = { method: ctx.method, body: ctx.body };
      return { vendorId: "chatvendor", amountAtomic: usd(0.02) };
    },
    async pay(_req, ctx) {
      seen.pay = { method: ctx.method, body: ctx.body };
      return { status: 200, body: { ok: true } };
    },
  };
  const gateway = createGatewayServer({ policy, runs, budget, velocityByRun, resources: new Map(), resourceClient });
  await new Promise((resolve) => gateway.server.listen(0, "127.0.0.1", resolve));
  t.after(() => gateway.server.close());
  const { port } = gateway.server.address();

  const response = await post(`http://127.0.0.1:${port}`, {
    agentId: "agent-1",
    runId: "run-main",
    resourceUrl: "https://api.vendor.example/chat",
    method: "POST",
    body: { prompt: "hi" },
    idempotencyKey: crypto.randomUUID(),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(seen.get, { method: "POST", body: { prompt: "hi" } });
  assert.deepEqual(seen.pay, { method: "POST", body: { prompt: "hi" } });
});

test("resourceClient pay failure returns 503 and releases reservation", async (t) => {
  const signer = new MockSignerAdapter();
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const policy = {
    id: "policy_failure_test",
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
  const runs = new Map([
    ["run-main", { id: "run-main", policyId: policy.id, agentId: "agent-1", taskLabel: "run-main", runBudgetAtomic: usd(0.05), maxRequestsPerMinute: 60, expiresAt: future, status: "active" }],
  ]);
  const budget = createBudgetLedger({ policyDailyAtomic: policy.dailyBudgetAtomic });
  const velocityByRun = new Map();
  for (const run of runs.values()) {
    budget.registerRun(run.id, run.runBudgetAtomic);
    velocityByRun.set(run.id, createVelocityWindow({ maxRequestsPerMinute: run.maxRequestsPerMinute }));
  }
  const resourceClient = {
    async getRequirement() {
      return { vendorId: "weather", amountAtomic: usd(0.02) };
    },
    async pay() {
      throw new Error("settlement failed");
    },
  };
  const gateway = createGatewayServer({ policy, runs, budget, velocityByRun, resources: new Map(), resourceClient });
  await new Promise((resolve) => gateway.server.listen(0, "127.0.0.1", resolve));
  t.after(() => gateway.server.close());
  const { port } = gateway.server.address();

  const before = budget.runSnapshot("run-main").runRemaining;
  const response = await post(`http://127.0.0.1:${port}`, req());
  assert.equal(response.status, 503);
  assert.equal(response.body.reason, "payment_failed");
  assert.equal(response.body.status, "payment_failed");
  assert.equal(budget.runSnapshot("run-main").runRemaining, before);
});
