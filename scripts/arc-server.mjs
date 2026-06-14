// Long-running Arc testnet gateway for the browser console. Uses throwaway testnet wallets only.
import { createPublicClient, erc20Abi, formatUnits, http as viemHttp } from "viem";
import { arcTestnet } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { createArcResourceClient, ensureGatewayDeposit } from "../core/arc-client.mjs";
import { ARC_TESTNET_RPC, ARC_TESTNET_USDC } from "../core/arc-config.mjs";
import { createArcSeller } from "../core/arc-seller.mjs";
import { createGatewayServer } from "../core/gateway.mjs";
import { usd } from "../core/money.mjs";
import { readEnv } from "./env.mjs";

const env = readEnv();
const buyerKey = env.ARC_BUYER_PRIVATE_KEY;
if (!buyerKey) {
  console.error("No ARC_BUYER_PRIVATE_KEY. Run: npm run arc:wallet");
  process.exit(1);
}

const buyerAccount = privateKeyToAccount(buyerKey);
const sellerAccount = env.ARC_SELLER_PRIVATE_KEY
  ? privateKeyToAccount(env.ARC_SELLER_PRIVATE_KEY)
  : privateKeyToAccount(generatePrivateKey());
const payTo = env.ARC_PAY_TO ?? sellerAccount.address;
if (payTo.toLowerCase() === buyerAccount.address.toLowerCase()) {
  console.error("ARC_PAY_TO must be different from the buyer address.");
  process.exit(1);
}

const publicClient = createPublicClient({ chain: arcTestnet, transport: viemHttp(ARC_TESTNET_RPC) });
const balance = await publicClient.readContract({
  address: ARC_TESTNET_USDC,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [buyerAccount.address],
});
console.log(`Buyer ${buyerAccount.address} has ${formatUnits(balance, 6)} Arc Testnet USDC`);
if (balance < BigInt(usd(0.1))) {
  console.error("Fund the buyer address with Arc Testnet USDC at https://faucet.circle.com, then rerun.");
  process.exit(1);
}

console.log("Ensuring Circle Gateway testnet deposit...");
const { balances, deposited, depositTxHash } = await ensureGatewayDeposit({
  buyerKey,
  minAvailableUsd: 0.05,
  depositUsd: 0.5,
});
console.log(`Gateway available: ${balances.gateway.formattedAvailable}${deposited ? ` (deposit tx ${depositTxHash})` : ""}`);

const weatherPort = Number(env.ARC_SELLER_PORT ?? 4031);
const marketPort = Number(env.ARC_MARKET_SELLER_PORT ?? 4032);
const gatewayPort = Number(env.PORT ?? 4020);

const weatherSeller = createArcSeller({
  payTo,
  routes: {
    "GET /paid/weather": {
      priceUsd: 0.001,
      description: "Current weather for New York City",
      vendorId: "weather",
      handler: async () => {
        const response = await fetch("https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&current_weather=true");
        const data = await response.json();
        return {
          vendorId: "weather",
          source: "open-meteo",
          location: "New York, NY",
          current: data.current_weather,
        };
      },
    },
    "GET /paid/weather-premium": {
      priceUsd: 0.1,
      description: "Premium weather analysis for New York City",
      vendorId: "weather",
      handler: async () => ({
        vendorId: "weather",
        product: "premium forecast",
        location: "New York, NY",
        summary: "High-resolution forecast package for agent planning.",
      }),
    },
  },
});

const marketSeller = createArcSeller({
  payTo,
  routes: {
    "GET /paid/market": {
      priceUsd: 0.01,
      description: "Market quote from a vendor outside the default allowlist",
      vendorId: "market",
      handler: async () => ({
        vendorId: "market",
        pair: "ETH/USD",
        price: "testnet-demo",
        updatedAt: new Date().toISOString(),
      }),
    },
  },
});

await weatherSeller.listen(weatherPort);
await marketSeller.listen(marketPort);

const weatherOrigin = `http://127.0.0.1:${weatherPort}`;
const marketOrigin = `http://127.0.0.1:${marketPort}`;
const resourceClient = createArcResourceClient({
  buyerKey,
  vendorRegistry: {
    [weatherOrigin]: "weather",
    [marketOrigin]: "market",
  },
});

const demoTargets = [
  { label: "Weather data $0.001", resourceUrl: `${weatherOrigin}/paid/weather`, kind: "allowed" },
  { label: "Premium weather $0.10", resourceUrl: `${weatherOrigin}/paid/weather-premium`, kind: "overcap" },
  { label: "Market quote $0.01", resourceUrl: `${marketOrigin}/paid/market`, kind: "unknown" },
];

const { server } = createGatewayServer({
  resources: new Map(),
  resourceClient,
  demoTargets,
});

server.listen(gatewayPort, "127.0.0.1", () => {
  console.log(`Gateway listening on http://127.0.0.1:${gatewayPort}`);
  console.log(`Weather paid resource: ${weatherOrigin}/paid/weather`);
  console.log(`Market paid resource:  ${marketOrigin}/paid/market`);
  console.log("Open the console with: npm run console");
});

function close() {
  server.close();
  weatherSeller.server.close();
  marketSeller.server.close();
}

process.on("SIGINT", () => {
  close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  close();
  process.exit(0);
});
