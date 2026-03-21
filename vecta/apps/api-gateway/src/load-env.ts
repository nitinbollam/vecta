/**
 * Load monorepo `.env` before any other imports in `server.ts`.
 * `@vecta/crypto` and others read `process.env` at module load time.
 */
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';

const candidates = [
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(process.cwd(), '.env'),
];

for (const envPath of candidates) {
  if (fs.existsSync(envPath)) {
    config({ path: envPath });
    break;
  }
}
