import test from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { LedgerSignerAdapter, verifyPolicySignature } from "../core/signer.mjs";
import { verifyLedgerPolicySignature } from "../core/ledger-verify.mjs";
import { localEip191App } from "../core/local-signer.mjs";
import { policyMessage } from "../core/policy-message.mjs";
import { usd } from "../core/money.mjs";

const account = privateKeyToAccount(generatePrivateKey());

const policy = {
  id: "policy_arc_001",
  gatewayDomain: "localhost",
  network: "eip155:5042002",
  currency: "USDC",
  asset: "arc-testnet-usdc",
  agentId: "research-agent",
  ownerAddress: account.address,
  allowedVendors: ["weather"],
  maxAmountAtomic: usd(0.05),
  dailyBudgetAtomic: usd(1),
  maxRequestsPerMinute: 60,
  expiresAt: "2999-01-01T00:00:00.000Z",
  nonce: "nonce-1",
};

test("policyMessage is deterministic for the same policy", () => {
  assert.equal(policyMessage(policy), policyMessage({ ...policy }));
});

test("policyMessage changes when a policy field changes", () => {
  assert.notEqual(
    policyMessage(policy),
    policyMessage({ ...policy, dailyBudgetAtomic: usd(100) }),
  );
});

test("LedgerSignerAdapter signs a policy and the signature verifies", async () => {
  const signer = new LedgerSignerAdapter({ app: localEip191App(account) });
  const signed = await signer.signPolicy(policy);
  assert.equal(signed.signatureType, "ledger-eip191");
  assert.equal(signed.signer.toLowerCase(), account.address.toLowerCase());
  assert.equal(await verifyLedgerPolicySignature(policy, signed), true);
});

test("tampered policy fails Ledger verification", async () => {
  const signer = new LedgerSignerAdapter({ app: localEip191App(account) });
  const signed = await signer.signPolicy(policy);
  const tampered = { ...policy, dailyBudgetAtomic: usd(100) };
  assert.equal(await verifyLedgerPolicySignature(tampered, signed), false);
});

test("verifyPolicySignature dispatches ledger-eip191", async () => {
  const signer = new LedgerSignerAdapter({ app: localEip191App(account) });
  const signed = await signer.signPolicy(policy);
  assert.equal(await verifyPolicySignature(policy, signed), true);
  assert.equal(await verifyPolicySignature({ ...policy, dailyBudgetAtomic: usd(100) }, signed), false);
});

test("verifyLedgerPolicySignature rejects an unknown signatureType", async () => {
  await assert.rejects(
    () => verifyLedgerPolicySignature(policy, { signatureType: "mock-secp256k1" }),
    /unsupported signatureType/,
  );
});
