/**
 * Load monorepo env files before other imports in `server.ts`.
 * `@vecta/crypto` and others read `process.env` at module load time.
 *
 * Resolution order (later files override earlier keys):
 *   vecta/.env → vecta/env/local.env → apps/api-gateway/.env
 */
import fs from "fs";
import path from "path";
import { config } from "dotenv";

const monorepoRoot = path.resolve(process.cwd(), "../..");

const layers: { path: string; override: boolean }[] = [
  { path: path.join(monorepoRoot, ".env"), override: false },
  { path: path.join(monorepoRoot, "env", "local.env"), override: true },
  { path: path.resolve(process.cwd(), ".env"), override: true },
];

for (const { path: envPath, override } of layers) {
  if (fs.existsSync(envPath)) {
    config({ path: envPath, override });
  }
}
