import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// Load the .env file at the repo root, wherever the command is run from.
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: resolve(repoRoot, ".env"), quiet: true });

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Add it to ${resolve(repoRoot, ".env")}`);
  return value;
}
