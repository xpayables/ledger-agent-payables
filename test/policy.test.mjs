import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "../core/policy-engine.mjs";
import { requestFingerprint } from "../core/fingerprint.mjs";
import { usd } from "../core/money.mjs";

const ARC_TESTNET = "eip155:5042002";
const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";

const now = new Date("2026-06-13T12:00:00.000Z");
const future = new Date(now.getTime() + 3_600_000).toISOString();
const past = new Date(now.getTime() - 1_000).toISOString();

const policy = {
  id: "policy_arc_001",
  gatewayDomain: "localhost",
  network: ARC_TESTNET,
  currency: "USDC",
  asset: ARC_TESTNET_USDC,
  agentId: "research-agent",
  allowedVendors: ["weather"],
  maxAmountAtomic: usd(0.05),
  dailyBudgetAtomic: usd(1),
  expiresAt: future,
};
const run = { id: "run_arc_001", agentId: "research-agent", status: "active", expiresAt: future };
const request = { agentId: "research-agent", runId: "run_arc_001", resourceUrl: "http://127.0.0.1:4031/paid/weather" };
const requirement = { vendorId: "weather", amountAtomic: usd(0.001) };

test("allowed vendor under limits is approved", () => {
  assert.deepEqual(decide({ policy, run, request, requirement, now }), {
    decision: "approved",
    reason: "vendor_allowed",
  });
});

test("amount over per-request cap is blocked", () => {
  const d = decide({ policy, run, request, requirement: { vendorId: "weather", amountAtomic: usd(0.1) }, now });
  assert.equal(d.decision, "blocked");
  assert.equal(d.reason, "amount_exceeds_limit");
});

test("non-allowlisted vendor needs approval", () => {
  const d = decide({ policy, run, request, requirement: { vendorId: "market", amountAtomic: usd(0.001) }, now });
  assert.equal(d.decision, "needs_approval");
  assert.equal(d.reason, "new_vendor");
});

test("expired policy is blocked", () => {
  assert.equal(decide({ policy: { ...policy, expiresAt: past }, run, request, requirement, now }).reason, "expired_policy");
});

test("inactive run is blocked", () => {
  assert.equal(decide({ policy, run: { ...run, status: "paused" }, request, requirement, now }).reason, "run_not_active");
});

test("agent not matching policy is blocked", () => {
  assert.equal(decide({ policy, run, request: { ...request, agentId: "other-agent" }, requirement, now }).reason, "agent_not_authorized");
});

test("velocity exceeded is rate-limited (runaway loop)", () => {
  assert.equal(decide({ policy, run, request, requirement, now, velocityExceeded: true }).reason, "rate_limit");
});

test("idempotency: same key + same request produces identical fingerprint (safe replay)", () => {
  assert.equal(
    requestFingerprint({ policy, request, requirement }),
    requestFingerprint({ policy, request, requirement }),
  );
});

test("idempotency: same key + different amount produces different fingerprint (conflict)", () => {
  assert.notEqual(
    requestFingerprint({ policy, request, requirement }),
    requestFingerprint({ policy, request, requirement: { ...requirement, amountAtomic: usd(0.03) } }),
  );
});
