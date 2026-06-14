// EIP-191 verification for Ledger-style signatures.
import { verifyMessage, serializeSignature } from "viem";
import { policyMessage } from "./policy-message.mjs";

function toHexSignature(signature) {
  if (typeof signature === "string") return signature;
  const { r, s, v } = signature;
  const numericV = Number(v);
  const yParity = numericV >= 27 ? numericV - 27 : numericV;
  return serializeSignature({ r, s, yParity });
}

export async function verifyLedgerSignedMessage(message, signed) {
  if (signed?.signatureType !== "ledger-eip191") {
    throw new Error(
      `verifyLedgerSignedMessage: unsupported signatureType "${signed?.signatureType}"`,
    );
  }
  return verifyMessage({
    address: signed.signer,
    message,
    signature: toHexSignature(signed.signature),
  });
}

export async function verifyLedgerPolicySignature(policy, signed) {
  return verifyLedgerSignedMessage(policyMessage(policy), signed);
}
