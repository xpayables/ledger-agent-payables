import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { createGatewayServer } from "../core/gateway.mjs";
import { MockSignerAdapter } from "../core/signer.mjs";
import { usd } from "../core/money.mjs";

async function buildUnconfiguredGateway() {
  const resources = new Map([
    ["/vendor/weather/paid/a", { vendorId: "weather", amountAtomic: usd(0.02), content: "A" }],
    ["/vendor/market/paid/x", { vendorId: "market", amountAtomic: usd(0.02), content: "M" }],
  ]);
  const gateway = createGatewayServer({ resources });
  await new Promise((resolve) => gateway.server.listen(0, "127.0.0.1", resolve));
  const { port } = gateway.server.address();
  return { ...gateway, origin: `http://127.0.0.1:${port}` };
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

function buildPolicy(ownerAddress) {
  return {
    id: "policy_console_001",
    gatewayDomain: "localhost",
    network: "eip155:5042002",
    currency: "USDC",
    asset: "arc-testnet-usdc",
    agentId: "agent-1",
    ownerAddress,
    allowedVendors: ["weather"],
    maxAmountAtomic: usd(0.05),
    dailyBudgetAtomic: usd(1),
    maxRequestsPerMinute: 60,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    nonce: "n1",
  };
}

test("unconfigured gateway rejects guarded requests and reports null policy", async (t) => {
  const gateway = await buildUnconfiguredGateway();
  t.after(() => gateway.server.close());
  const response = await post(gateway.origin, "/guarded-request", {
    agentId: "a",
    runId: "r",
    resourceUrl: "/vendor/weather/paid/a",
    idempotencyKey: crypto.randomUUID(),
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, "no_active_policy");
  assert.equal((await get(gateway.origin, "/policy")).body.policy, null);
  assert.deepEqual((await get(gateway.origin, "/budget")).body, { policy: null, runs: [] });
});

test("POST /policy configures the gateway", async (t) => {
  const gateway = await buildUnconfiguredGateway();
  t.after(() => gateway.server.close());
  const signer = new MockSignerAdapter();
  const policy = buildPolicy(await signer.getAddress());
  const signed = await signer.signPolicy(policy);

  const set = await post(gateway.origin, "/policy", { policy, signed });
  assert.equal(set.status, 200);
  assert.equal(set.body.runId, "run_console_001");
  assert.equal((await get(gateway.origin, "/policy")).body.signature.signatureType, "mock-secp256k1");

  const ok = await post(gateway.origin, "/guarded-request", {
    agentId: "agent-1",
    runId: "run_console_001",
    resourceUrl: "/vendor/weather/paid/a",
    idempotencyKey: crypto.randomUUID(),
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.status, "payment_settled");

  const flagged = await post(gateway.origin, "/guarded-request", {
    agentId: "agent-1",
    runId: "run_console_001",
    resourceUrl: "/vendor/market/paid/x",
    idempotencyKey: crypto.randomUUID(),
  });
  assert.equal(flagged.status, 202);
});

test("POST /policy fails closed on bad signature and signer mismatch", async (t) => {
  const gateway = await buildUnconfiguredGateway();
  t.after(() => gateway.server.close());
  const signer = new MockSignerAdapter();
  const policy = buildPolicy(await signer.getAddress());
  const signed = await signer.signPolicy(policy);

  const tampered = await post(gateway.origin, "/policy", { policy: { ...policy, dailyBudgetAtomic: usd(100) }, signed });
  assert.equal(tampered.status, 403);
  assert.equal(tampered.body.error, "policy_signature_invalid");

  const intruder = new MockSignerAdapter();
  const intruderSigned = await intruder.signPolicy(policy);
  const wrongSigner = await post(gateway.origin, "/policy", { policy, signed: intruderSigned });
  assert.equal(wrongSigner.status, 403);
  assert.equal(wrongSigner.body.error, "signer_not_owner");
  assert.equal((await get(gateway.origin, "/policy")).body.policy, null);
});
