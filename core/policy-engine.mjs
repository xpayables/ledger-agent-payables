// Pure authorization decision. Budget reservation is enforced separately.
export function decide({ policy, run, request, requirement, now = new Date(), velocityExceeded = false }) {
  const ts = now instanceof Date ? now : new Date(now);

  if (new Date(policy.expiresAt) <= ts) {
    return { decision: "blocked", reason: "expired_policy" };
  }
  if (run.status !== "active" || new Date(run.expiresAt) <= ts) {
    return { decision: "blocked", reason: "run_not_active" };
  }
  if (request.agentId !== policy.agentId) {
    return { decision: "blocked", reason: "agent_not_authorized" };
  }
  if (request.runId !== run.id || request.agentId !== run.agentId) {
    return { decision: "blocked", reason: "run_not_authorized" };
  }
  if (velocityExceeded) {
    return { decision: "blocked", reason: "rate_limit" };
  }
  if (!policy.allowedVendors.includes(requirement.vendorId)) {
    return { decision: "needs_approval", reason: "new_vendor" };
  }
  if (requirement.amountAtomic > policy.maxAmountAtomic) {
    return { decision: "blocked", reason: "amount_exceeds_limit" };
  }
  return { decision: "approved", reason: "vendor_allowed" };
}
