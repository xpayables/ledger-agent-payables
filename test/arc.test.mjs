import test from "node:test";
import assert from "node:assert/strict";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { createArcResourceClient } from "../core/arc-client.mjs";
import {
  ARC_TESTNET,
  ARC_TESTNET_GATEWAY_WALLET,
  ARC_TESTNET_USDC,
} from "../core/arc-config.mjs";
import { createArcSeller } from "../core/arc-seller.mjs";
import { usd } from "../core/money.mjs";

function decodePaymentRequired(header) {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
}

async function startSeller() {
  let handlerCalled = false;
  const payTo = privateKeyToAccount(generatePrivateKey()).address;
  const seller = createArcSeller({
    payTo,
    routes: {
      "GET /paid/weather": {
        priceUsd: 0.001,
        description: "Weather",
        vendorId: "weather",
        handler: async () => {
          handlerCalled = true;
          return { ok: true };
        },
      },
    },
  });
  await seller.listen(0);
  const { port } = seller.server.address();
  return { seller, payTo, origin: `http://127.0.0.1:${port}`, handlerCalled: () => handlerCalled };
}

test("Arc seller emits a GatewayWalletBatched payment requirement", async (t) => {
  const { seller, origin, payTo, handlerCalled } = await startSeller();
  t.after(() => seller.server.close());

  const response = await fetch(`${origin}/paid/weather`);
  assert.equal(response.status, 402);
  assert.equal(handlerCalled(), false);

  const paymentRequired = decodePaymentRequired(response.headers.get("payment-required"));
  assert.equal(paymentRequired.x402Version, 2);
  assert.equal(paymentRequired.resource.url, `${origin}/paid/weather`);
  assert.equal(paymentRequired.accepts.length, 1);

  const accepted = paymentRequired.accepts[0];
  assert.equal(accepted.scheme, "exact");
  assert.equal(accepted.network, ARC_TESTNET);
  assert.equal(accepted.asset, ARC_TESTNET_USDC);
  assert.equal(accepted.amount, String(usd(0.001)));
  assert.equal(accepted.payTo, payTo);
  assert.equal(accepted.extra.name, "GatewayWalletBatched");
  assert.equal(accepted.extra.verifyingContract, ARC_TESTNET_GATEWAY_WALLET);
});

test("Arc resource client reads requirements only for registered vendor origins", async (t) => {
  const { seller, origin } = await startSeller();
  t.after(() => seller.server.close());

  const buyerKey = generatePrivateKey();
  const trusted = createArcResourceClient({ buyerKey, vendorRegistry: { [origin]: "weather" } });
  const requirement = await trusted.getRequirement(`${origin}/paid/weather`);

  assert.equal(requirement.vendorId, "weather");
  assert.equal(requirement.amountAtomic, usd(0.001));
  assert.match(requirement.payTo, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(requirement.asset, ARC_TESTNET_USDC);

  const untrusted = createArcResourceClient({ buyerKey, vendorRegistry: {} });
  assert.equal(await untrusted.getRequirement(`${origin}/paid/weather`), null);
});
