// Arc testnet paid-resource server using Circle Gateway batched settlements.
import http from "node:http";

import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";

export const ARC_TESTNET = "eip155:5042002";
export const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";
export const ARC_TESTNET_GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
export const ARC_TESTNET_RPC = "https://rpc.testnet.arc.network";
export const ARCSCAN = "https://testnet.arcscan.app";
const GATEWAY_API_TESTNET = "https://gateway-api-testnet.circle.com";

function arcPaymentRequirements({ route, payTo }) {
  return {
    scheme: "exact",
    network: ARC_TESTNET,
    asset: ARC_TESTNET_USDC,
    amount: Math.round(route.priceUsd * 1_000_000).toString(),
    payTo,
    maxTimeoutSeconds: 345600,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: ARC_TESTNET_GATEWAY_WALLET,
    },
  };
}

export function createArcSeller({ payTo, routes, gatewayUrl = GATEWAY_API_TESTNET }) {
  if (!payTo) throw new Error("createArcSeller requires a payTo address");
  const facilitator = new BatchFacilitatorClient({ url: gatewayUrl });

  function json(res, status, payload, headers = {}) {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(payload));
  }

  async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    if (!body) return null;
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, `http://${req.headers.host}`);
      const route = routes[`${req.method} ${pathname}`];
      if (!route) return json(res, 404, { error: "not_found" });

      const requirements = arcPaymentRequirements({ route, payTo });
      const paymentSignature = req.headers["payment-signature"];
      if (!paymentSignature) {
        const paymentRequired = {
          x402Version: 2,
          resource: {
            url: `http://${req.headers.host}${pathname}`,
            description: route.description,
            mimeType: "application/json",
          },
          accepts: [requirements],
        };
        return json(res, 402, { error: "payment_required" }, {
          "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(paymentRequired)).toString("base64"),
        });
      }

      const paymentPayload = JSON.parse(Buffer.from(paymentSignature, "base64").toString("utf8"));
      const verifyResult = await facilitator.verify(paymentPayload, requirements);
      if (!verifyResult.isValid) {
        return json(res, 402, { error: "payment_verification_failed", reason: verifyResult.invalidReason });
      }

      const settleResult = await facilitator.settle(paymentPayload, requirements);
      if (!settleResult.success) {
        return json(res, 402, { error: "payment_settlement_failed", reason: settleResult.errorReason });
      }

      const body = await readBody(req);
      const content = await route.handler({ body });
      const payer = settleResult.payer ?? verifyResult.payer ?? null;
      return json(res, 200, content, {
        "PAYMENT-RESPONSE": Buffer.from(
          JSON.stringify({ success: true, transaction: settleResult.transaction ?? null, network: requirements.network, payer }),
        ).toString("base64"),
      });
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  });

  return {
    server,
    listen(port, host = "127.0.0.1") {
      return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
    },
  };
}
