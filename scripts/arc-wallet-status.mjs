// Print the Arc testnet buyer address, wallet balance, and Gateway balance.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, erc20Abi, formatUnits, http as viemHttp } from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

import { getGatewayBalances } from "../core/arc-client.mjs";
import { ARC_TESTNET_RPC, ARC_TESTNET_USDC } from "../core/arc-seller.mjs";

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

const { address } = privateKeyToAccount(buyerKey);
const publicClient = createPublicClient({ chain: arcTestnet, transport: viemHttp(ARC_TESTNET_RPC) });

console.log(`Arc buyer address: ${address}`);

const [nativeBalance, usdcBalance] = await Promise.all([
  publicClient.getBalance({ address }),
  publicClient.readContract({
    address: ARC_TESTNET_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  }),
]);

console.log(`Native USDC balance: ${formatUnits(nativeBalance, 18)}`);
console.log(`Token USDC balance : ${formatUnits(usdcBalance, 6)}`);

try {
  const balances = await getGatewayBalances({ buyerKey });
  console.log(`Gateway available : ${balances.gateway.formattedAvailable}`);
} catch (error) {
  console.log(`Gateway balance   : unavailable (${error.message})`);
}
