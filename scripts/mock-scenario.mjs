// Scripted mock scenario. Starts a local gateway, drives the full flow, prints
// results, then exits. No real funds move.
import crypto from "node:crypto";

import { usd, fromAtomic } from "../core/money.mjs";
import { createBudgetLedger } from "../core/budget.mjs";
import { createVelocityWindow } from "../core/velocity.mjs";
import { MockSignerAdapter, verifyPolicySignature } from "../core/signer.mjs";
import { createGatewayServer } from "../core/gateway.mjs";

const signer = new MockSignerAdapter();

const policy = {
  id: "policy_mock_001",
  gatewayDomain: "localhost",
  network: "eip155:5042002",
  currency: "USDC",
  asset: "arc-testnet-usdc",
  agentId: "research-agent",
  ownerAddress: await signer.getAddress(),
  allowedVendors: ["weather"],
  maxAmountAtomic: usd(0.05),
  dailyBudgetAtomic: usd(1),
  maxRequestsPerMinute: 60,
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  nonce: crypto.randomUUID(),
};

const signedPolicy = await signer.signPolicy(policy);
if (!(await verifyPolicySignature(policy, signedPolicy))) {
  throw new Error("policy signature failed to verify");
}
if (await verifyPolicySignature({ ...policy, dailyBudgetAtomic: usd(100) }, signedPolicy)) {
  throw new Error("tampered policy verified");
}

const runs = new Map([
  [
    "run_research_001",
    {
      id: "run_research_001",
      policyId: policy.id,
      agentId: "research-agent",
      taskLabel: "weather research",
      runBudgetAtomic: usd(0.03),
      maxRequestsPerMinute: policy.maxRequestsPerMinute,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      status: "active",
    },
  ],
  [
    "run_runaway_001",
    {
      id: "run_runaway_001",
      policyId: policy.id,
      agentId: "research-agent",
      taskLabel: "runaway loop demo",
      runBudgetAtomic: usd(1),
      maxRequestsPerMinute: 5,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      status: "active",
    },
  ],
]);

const budget = createBudgetLedger({ policyDailyAtomic: policy.dailyBudgetAtomic });
const velocityByRun = new Map();
for (const run of runs.values()) {
  budget.registerRun(run.id, run.runBudgetAtomic);
  velocityByRun.set(run.id, createVelocityWindow({ maxRequestsPerMinute: run.maxRequestsPerMinute }));
}

const resources = new Map([
  ["/vendor/weather/paid/current", { vendorId: "weather", amountAtomic: usd(0.02), content: "Mock paid weather result." }],
  ["/vendor/weather/paid/forecast", { vendorId: "weather", amountAtomic: usd(0.02), content: "Mock paid forecast result." }],
  ["/vendor/weather/paid/expensive", { vendorId: "weather", amountAtomic: usd(0.1), content: "Mock expensive weather report." }],
  ["/vendor/market/paid/quote", { vendorId: "market", amountAtomic: usd(0.01), content: "Mock market quote." }],
]);

const demoTargets = [
  { label: "Allowed payment ($0.02)", resourceUrl: "/vendor/weather/paid/current", kind: "allowed" },
  { label: "Over-cap ($0.10)", resourceUrl: "/vendor/weather/paid/expensive", kind: "overcap" },
  { label: "New vendor ($0.01)", resourceUrl: "/vendor/market/paid/quote", kind: "unknown" },
];

const { server } = createGatewayServer({
  policy,
  runs,
  budget,
  velocityByRun,
  resources,
  signedPolicy,
  demoApprovalSigner: signer,
  demoTargets,
});

const gatewayPort = process.argv.includes("--serve") ? Number(process.env.PORT ?? 4020) : 0;

function listen() {
  return new Promise((resolve) => server.listen(gatewayPort, "127.0.0.1", () => resolve(server.address())));
}

async function post(origin, body) {
  const response = await fetch(`${origin}/guarded-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const address = await listen();
const origin = `http://${address.address}:${address.port}`;
const mainRun = "run_research_001";
const runawayRun = "run_runaway_001";

const competing = [
  { agentId: "research-agent", runId: mainRun, resourceUrl: "/vendor/weather/paid/current", idempotencyKey: "idem_competing_1" },
  { agentId: "research-agent", runId: mainRun, resourceUrl: "/vendor/weather/paid/forecast", idempotencyKey: "idem_competing_2" },
];

const results = {
  directPaidResourceStatus: (await fetch(`${origin}/vendor/weather/paid/current`)).status,
  competing: await Promise.all(competing.map((request) => post(origin, request))),
  replay: await post(origin, competing[0]),
  conflict: await post(origin, { ...competing[0], resourceUrl: "/vendor/weather/paid/forecast" }),
  expensive: await post(origin, { agentId: "research-agent", runId: mainRun, resourceUrl: "/vendor/weather/paid/expensive", idempotencyKey: "idem_expensive" }),
  newVendor: await post(origin, { agentId: "research-agent", runId: mainRun, resourceUrl: "/vendor/market/paid/quote", idempotencyKey: "idem_new_vendor" }),
  runaway: [],
};

for (let i = 1; i <= 8; i += 1) {
  results.runaway.push(
    await post(origin, {
      agentId: "research-agent",
      runId: runawayRun,
      resourceUrl: "/vendor/weather/paid/current",
      idempotencyKey: `idem_runaway_${i}`,
    }),
  );
}

const pendingException = (await (await fetch(`${origin}/exceptions`)).json()).exceptions
  .find((exception) => exception.status === "pending");
const approvalText = (await (await fetch(`${origin}/exceptions/${pendingException.id}/message`)).json()).message;
const approval = await signer.signApproval(pendingException);
results.approval = await (async () => {
  const response = await fetch(`${origin}/exceptions/${pendingException.id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approval }),
  });
  return { status: response.status, body: await response.json() };
})();
results.approvedReplay = await post(origin, {
  agentId: "research-agent",
  runId: mainRun,
  resourceUrl: "/vendor/market/paid/quote",
  idempotencyKey: "idem_new_vendor",
});
results.statement = await (await fetch(`${origin}/statement`)).json();

console.log("\nLedger Agent Payables Mock Demo");
console.log("--------------------------------");
console.log(`Local server: ${origin}`);
console.log(`Policy ${policy.id} signed by ${signedPolicy.signer} (${signedPolicy.signatureType}); signature verified, tamper rejected.`);
console.log(`Direct paid resource without payment: HTTP ${results.directPaidResourceStatus}`);
console.log(`Main run budget: $${fromAtomic(runs.get(mainRun).runBudgetAtomic)} for "${runs.get(mainRun).taskLabel}"`);

console.log("\nNear-simultaneous approved-looking requests:");
console.table(
  results.competing.map((result, index) => ({
    request: index + 1,
    httpStatus: result.status,
    decision: result.body.decision,
    reason: result.body.reason,
    paidResourceStatus: result.body.paidResource?.status ?? null,
  })),
);

console.log("\nIdempotency:");
console.table([
  { scenario: "replay", httpStatus: results.replay.status, reason: results.replay.body.replayed ? "replayed" : results.replay.body.reason },
  { scenario: "conflict", httpStatus: results.conflict.status, reason: results.conflict.body.reason },
]);

console.log("\nBlocked / exception requests:");
console.table([
  { scenario: "expensive", httpStatus: results.expensive.status, decision: results.expensive.body.decision, reason: results.expensive.body.reason },
  { scenario: "new vendor", httpStatus: results.newVendor.status, decision: results.newVendor.body.decision, reason: results.newVendor.body.reason },
]);

console.log("\nException approval:");
console.log(`  Canonical approval message:\n    ${approvalText.split("\n").join("\n    ")}`);
console.table([
  { step: "approve exception", httpStatus: results.approval.status, decision: results.approval.body.decision, status: results.approval.body.status },
  { step: "replay original request", httpStatus: results.approvedReplay.status, decision: results.approvedReplay.body.decision, status: results.approvedReplay.body.status },
]);

console.log(`\nRunaway loop on "${runs.get(runawayRun).taskLabel}" (${runs.get(runawayRun).maxRequestsPerMinute}/min, 8 rapid requests):`);
console.table(
  results.runaway.map((result, index) => ({
    request: index + 1,
    httpStatus: result.status,
    decision: result.body.decision,
    reason: result.body.reason,
  })),
);

console.log("\nStatement:");
console.table(results.statement.rows);

console.log("\nBudget state:");
const policySnapshot = budget.policySnapshot();
console.table({
  policyDailyUsd: fromAtomic(policySnapshot.policyDailyAtomic),
  policySettledUsd: fromAtomic(policySnapshot.policySettled),
  policyRemainingUsd: fromAtomic(policySnapshot.policyRemaining),
});

if (process.argv.includes("--serve")) {
  console.log(`\nGateway listening on ${origin} — open the console to drive it.`);
} else {
  server.close();
}
