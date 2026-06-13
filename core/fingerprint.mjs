import crypto from "node:crypto";
import { canonicalJson } from "./canonical.mjs";

// Bind the authorization context used to distinguish safe retries from conflicts.
export function requestFingerprint({ policy, request, requirement }) {
  return crypto
    .createHash("sha256")
    .update(
      canonicalJson({
        policyId: policy.id,
        gatewayDomain: policy.gatewayDomain,
        runId: request.runId,
        network: policy.network,
        currency: policy.currency,
        asset: policy.asset,
        agentId: request.agentId,
        resourceUrl: request.resourceUrl,
        vendorId: requirement.vendorId,
        amountAtomic: requirement.amountAtomic,
      }),
    )
    .digest("hex");
}
