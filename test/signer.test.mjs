import test from "node:test";
import assert from "node:assert/strict";
import { MockSignerAdapter, LedgerSignerAdapter, verifyPolicySignature } from "../core/signer.mjs";
import { usd } from "../core/money.mjs";

const policy = {
  id: "policy_arc_001",
  gatewayDomain: "localhost",
  network: "eip155:5042002",
  currency: "USDC",
  asset: "arc-testnet-usdc",
  agentId: "research-agent",
  ownerAddress: "0xmock-owner",
  allowedVendors: ["weather"],
  maxAmountAtomic: usd(0.05),
  dailyBudgetAtomic: usd(1),
  maxRequestsPerMinute: 60,
  expiresAt: "2999-01-01T00:00:00.000Z",
  nonce: "nonce-1",
};

test("mock signer round-trips a policy signature", async () => {
  const signer = new MockSignerAdapter();
  const signed = await signer.signPolicy(policy);
  assert.equal(await verifyPolicySignature(policy, signed), true);
});

test("tampered policy fails mock verification", async () => {
  const signer = new MockSignerAdapter();
  const signed = await signer.signPolicy(policy);
  const tampered = { ...policy, dailyBudgetAtomic: usd(100) };
  assert.equal(await verifyPolicySignature(tampered, signed), false);
});

test("verifyPolicySignature rejects an unknown signatureType", async () => {
  await assert.rejects(
    () => verifyPolicySignature(policy, { signatureType: "unknown-type" }),
    /unsupported signatureType/,
  );
});

test("mock signer address is stable", async () => {
  const signer = new MockSignerAdapter();
  assert.equal(await signer.getAddress(), await signer.getAddress());
});

test("Ledger adapter requires an injected app", () => {
  assert.throws(() => new LedgerSignerAdapter(), /injected/);
  assert.throws(() => new LedgerSignerAdapter({}), /injected/);
});
