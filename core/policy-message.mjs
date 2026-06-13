// Canonical messages signed for policy and exception authority.
export function policyMessage(policy) {
  return [
    "Ledger Agent Payables Policy",
    `Policy ID: ${policy.id}`,
    `Gateway: ${policy.gatewayDomain}`,
    `Network: ${policy.network}`,
    `Currency: ${policy.currency}`,
    `Asset: ${policy.asset}`,
    `Agent: ${policy.agentId}`,
    `Owner: ${policy.ownerAddress}`,
    `Allowed vendors: ${[...policy.allowedVendors].join(", ")}`,
    `Max per request (atomic): ${policy.maxAmountAtomic}`,
    `Daily budget (atomic): ${policy.dailyBudgetAtomic}`,
    `Max requests/min: ${policy.maxRequestsPerMinute}`,
    `Expires: ${policy.expiresAt}`,
    `Nonce: ${policy.nonce}`,
    "Ledger signs bounded authority, not individual nano-payments.",
  ].join("\n");
}

export function approvalMessage(exception) {
  return [
    "Ledger Agent Payables Exception Approval",
    `Gateway: ${exception.gatewayDomain}`,
    `Network: ${exception.network}`,
    `Owner: ${exception.ownerAddress}`,
    `Exception ID: ${exception.id}`,
    `Policy ID: ${exception.policyId}`,
    `Event ID: ${exception.eventId}`,
    `Type: ${exception.type}`,
    `Vendor: ${exception.vendorId}`,
    `Resource: ${exception.resourceUrl}`,
    `Amount (atomic): ${exception.amountAtomic}`,
    `Currency: ${exception.currency}`,
    "Approves this single recorded request only.",
  ].join("\n");
}

export function messageHex(message) {
  return [...new TextEncoder().encode(message)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function policyMessageHex(policy) {
  return messageHex(policyMessage(policy));
}

export function approvalMessageHex(exception) {
  return messageHex(approvalMessage(exception));
}
