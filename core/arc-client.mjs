// Arc testnet buyer client used by the policy gateway after policy approval.
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { GatewayClient } from "@circle-fin/x402-batching/client";

import { ARC_TESTNET } from "./arc-seller.mjs";

export function createArcResourceClient({ buyerKey, vendorRegistry }) {
  const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: buyerKey });

  function vendorFor(resourceUrl) {
    const { origin } = new URL(resourceUrl);
    return vendorRegistry[origin] ?? null;
  }

  function requestInit(context) {
    const method = context?.method ?? "GET";
    if (context?.body == null) return { method };
    return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(context.body) };
  }

  return {
    async getRequirement(resourceUrl, context) {
      const vendorId = vendorFor(resourceUrl);
      if (!vendorId) return null;

      const challenge = await fetch(resourceUrl, requestInit(context));
      if (challenge.status !== 402) return null;

      const header = challenge.headers.get("PAYMENT-REQUIRED");
      const paymentRequired = header
        ? decodePaymentRequiredHeader(header)
        : await challenge.json().catch(() => null);
      const accepted = paymentRequired?.accepts?.find(
        (option) =>
          option.scheme === "exact" &&
          option.network === ARC_TESTNET &&
          option.extra?.name === "GatewayWalletBatched",
      );
      if (!accepted) return null;

      const amountAtomic = Number(accepted.amount);
      if (!Number.isSafeInteger(amountAtomic) || amountAtomic <= 0) return null;
      return { vendorId, amountAtomic, payTo: accepted.payTo, asset: accepted.asset };
    },

    async pay({ resourceUrl, amountAtomic }, context) {
      const payOptions = { method: context?.method ?? "GET" };
      if (context?.body != null) payOptions.body = context.body;

      const result = await gateway.pay(resourceUrl, payOptions);
      if (result.status !== 200) {
        throw new Error(`Arc nanopayment did not settle: HTTP ${result.status}`);
      }
      if (Number(result.amount) !== amountAtomic) {
        throw new Error(`Arc settled ${result.amount} != approved ${amountAtomic}`);
      }
      return {
        status: 200,
        body: result.data,
        settlement: { transaction: result.transaction },
      };
    },
  };
}

export async function getGatewayBalances({ buyerKey }) {
  const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: buyerKey });
  return gateway.getBalances();
}

export async function ensureGatewayDeposit({ buyerKey, minAvailableUsd = 0.5, depositUsd = 1 }) {
  const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: buyerKey });
  const before = await gateway.getBalances();
  const minAtomic = BigInt(Math.round(minAvailableUsd * 1_000_000));
  if (before.gateway.available >= minAtomic) {
    return { gateway, balances: before, deposited: false };
  }

  const result = await gateway.deposit(String(depositUsd));
  const balances = await gateway.getBalances();
  return { gateway, balances, deposited: true, depositTxHash: result.depositTxHash };
}
