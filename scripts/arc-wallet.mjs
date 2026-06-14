// Create or print the throwaway buyer wallet used by the Arc testnet scenario.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
const keyName = "ARC_BUYER_PRIVATE_KEY";
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const match = existing.match(new RegExp(`^${keyName}=(0x[0-9a-fA-F]{64})$`, "m"));

if (match) {
  console.log(`${keyName} already exists in .env`);
  console.log(`Buyer address: ${privateKeyToAccount(match[1]).address}`);
} else {
  const privateKey = generatePrivateKey();
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(envPath, `${existing}${prefix}${keyName}=${privateKey}\n`, { mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
  console.log(`New throwaway Arc buyer key written to .env`);
  console.log(`Buyer address: ${privateKeyToAccount(privateKey).address}`);
}

console.log("\nFund this address with Arc Testnet USDC:");
console.log("  https://faucet.circle.com");
console.log("\nThen run:");
console.log("  npm run arc:wallet:status");
console.log("  npm run demo:arc");
