// Print the Arc testnet buyer address, wallet balance, and Gateway balance.
import { createPublicClient, erc20Abi, formatUnits, http as viemHttp } from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

import { getGatewayBalances } from "../core/arc-client.mjs";
import { ARC_TESTNET_RPC, ARC_TESTNET_USDC } from "../core/arc-config.mjs";
import { readEnv } from "./env.mjs";

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
