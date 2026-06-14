// Scripted Arc testnet scenario: policy approval, Gateway deposit, paid request,
// Arc settlement, and statement rollup.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, erc20Abi, formatUnits, http as viemHttp } from "viem";
import { arcTestnet } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { createArcResourceClient, ensureGatewayDeposit } from "../core/arc-client.mjs";
import {
  ARCSCAN,
  ARC_TESTNET,
  ARC_TESTNET_RPC,
  ARC_TESTNET_USDC,
  createArcSeller,
} from "../core/arc-seller.mjs";
import { createBudgetLedger } from "../core/budget.mjs";
import { createGatewayServer } from "../core/gateway.mjs";
import { localEip191App } from "../core/local-signer.mjs";
import { fromAtomic, usd } from "../core/money.mjs";
import { LedgerSignerAdapter, verifyPolicySignature } from "../core/signer.mjs";
import { createVelocityWindow } from "../core/velocity.mjs";

function readEnv() {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
  const env = { ...process.env };
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !(match[1] in process.env)) env[match[1]] = match[2];
  }
  return env;
}

const env = readEnv();
const buyerKey = env.ARC_BUYER_PRIVATE_KEY;
if (!buyerKey) {
  console.error("No ARC_BUYER_PRIVATE_KEY. Run: npm run arc:wallet");
  process.exit(1);
}

const buyerAccount = privateKeyToAccount(buyerKey);
const sellerAccount = env.ARC_SELLER_PRIVATE_KEY ? privateKeyToAccount(env.ARC_SELLER_PRIVATE_KEY) : privateKeyToAccount(generatePrivateKey());
const payTo = env.ARC_PAY_TO ?? sellerAccount.address;
if (payTo.toLowerCase() === buyerAccount.address.toLowerCase()) {
  console.error("ARC_PAY_TO must be different from the buyer address.");
  process.exit(1);
}

const publicClient = createPublicClient({ chain: arcTestnet, transport: viemHttp(ARC_TESTNET_RPC) });
const usdcBalance = await publicClient.readContract({
  address: ARC_TESTNET_USDC,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [buyerAccount.address],
});
console.log(`Buyer ${buyerAccount.address} has ${formatUnits(usdcBalance, 6)} Arc Testnet USDC`);
if (usdcBalance < BigInt(usd(0.1))) {
  console.error("Fund the buyer address with Arc Testnet USDC at https://faucet.circle.com, then rerun.");
  process.exit(1);
}

let seller;
let gateway;
try {
  console.log("Ensuring Gateway deposit...");
  const { balances, deposited, depositTxHash } = await ensureGatewayDeposit({ buyerKey, minAvailableUsd: 0.05, depositUsd: 0.5 });
  console.log(`Gateway available: ${balances.gateway.formattedAvailable}${deposited ? ` (deposit tx ${depositTxHash})` : ""}`);

  const sellerPort = Number(env.ARC_SELLER_PORT ?? 4031);
  seller = createArcSeller({
    payTo,
    routes: {
      "GET /paid/weather": {
        priceUsd: 0.001,
        description: "Current weather for New York City",
        vendorId: "weather",
        handler: async () => {
          const response = await fetch("https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&current_weather=true");
          const data = await response.json();
          return { vendorId: "weather", location: "New York, NY", current: data.current_weather };
        },
      },
    },
  });
  await seller.listen(sellerPort);
  const sellerOrigin = `http://127.0.0.1:${sellerPort}`;

  const ownerAccount = privateKeyToAccount(env.OWNER_PRIVATE_KEY ?? generatePrivateKey());
  const signer = new LedgerSignerAdapter({ app: localEip191App(ownerAccount) });
  const policy = {
    id: "policy_arc_001",
    gatewayDomain: "localhost",
    network: ARC_TESTNET,
    currency: "USDC",
    asset: ARC_TESTNET_USDC,
    agentId: "research-agent",
    ownerAddress: await signer.getAddress(),
    allowedVendors: ["weather"],
    maxAmountAtomic: usd(0.05),
    dailyBudgetAtomic: usd(0.5),
    maxRequestsPerMinute: 30,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    nonce: crypto.randomUUID(),
  };
  const signedPolicy = await signer.signPolicy(policy);
  if (!(await verifyPolicySignature(policy, signedPolicy))) throw new Error("policy signature failed to verify");

  const runs = new Map([[
    "run_arc_001",
    {
      id: "run_arc_001",
      policyId: policy.id,
      agentId: policy.agentId,
      taskLabel: "arc weather",
      runBudgetAtomic: usd(0.5),
      maxRequestsPerMinute: 30,
      expiresAt: policy.expiresAt,
      status: "active",
    },
  ]]);
  const budget = createBudgetLedger({ policyDailyAtomic: policy.dailyBudgetAtomic });
  const velocityByRun = new Map();
  for (const run of runs.values()) {
    budget.registerRun(run.id, run.runBudgetAtomic);
    velocityByRun.set(run.id, createVelocityWindow({ maxRequestsPerMinute: run.maxRequestsPerMinute }));
  }

  const resourceClient = createArcResourceClient({
    buyerKey,
    vendorRegistry: { [sellerOrigin]: "weather" },
  });
  gateway = createGatewayServer({ policy, runs, budget, velocityByRun, resources: new Map(), resourceClient, signedPolicy });
  await new Promise((resolve) => gateway.server.listen(0, "127.0.0.1", resolve));
  const gatewayAddress = gateway.server.address();
  const gatewayOrigin = `http://${gatewayAddress.address}:${gatewayAddress.port}`;

  console.log("\nLedger Agent Payables Arc Scenario");
  console.log("----------------------------------");
  console.log(`Policy ${policy.id} signed with ${signedPolicy.signatureType}; per-payment cap $0.05.`);

  const response = await fetch(`${gatewayOrigin}/guarded-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId: policy.agentId,
      runId: "run_arc_001",
      resourceUrl: `${sellerOrigin}/paid/weather`,
      idempotencyKey: `arc-${crypto.randomUUID()}`,
    }),
  });
  const result = await response.json();
  console.log(`\nHTTP ${response.status} ${result.decision} (${result.reason}); status ${result.status}`);

  const tx = result.paidResource?.settlement?.transaction;
  if (tx) console.log(`Settled on Arc: ${ARCSCAN}/tx/${tx}`);
  if (result.paidResource?.body) console.log("Agent received:", JSON.stringify(result.paidResource.body));
  console.log(`Budget: $${fromAtomic(budget.policySnapshot().policySettled)} settled of $${fromAtomic(policy.dailyBudgetAtomic)}.`);
} finally {
  gateway?.server.close();
  seller?.server.close();
}
