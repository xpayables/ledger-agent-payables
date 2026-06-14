import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from the repo root over process.env, without a dependency.
export function readEnv() {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
  const env = { ...process.env };
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !(match[1] in process.env)) env[match[1]] = match[2];
  }
  return env;
}
