'use strict';

/**
 * Applies SQL files in backend/shared/database/migrations in sorted order.
 *
 * Env:
 *   DATABASE_URL (required)
 *   DATABASE_SSL_REJECT_UNAUTHORIZED=true — strict TLS (default off for managed Postgres)
 *
 *   MIGRATION_MARK_BASELINE_UNTIL=007_tenant_trust_certificate_json.sql
 *     One-time on a DB that already has schema: mark all earlier files as applied
 *     without running them, then run this file and everything after it.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function stripSslMode(url) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('sslmode');
    parsed.searchParams.delete('uselibpqcompat');
    return parsed.toString();
  } catch {
    return url;
  }
}

function clientSsl(url) {
  const local = /localhost|127\.0\.0\.1/i.test(url);
  if (local) return false;
  const strict = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true';
  return { rejectUnauthorized: strict };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const migrationsDir = path.join(__dirname, '..', 'backend', 'shared', 'database', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const connectionString = stripSslMode(url);
  const client = new Client({
    connectionString,
    ssl: clientSsl(url),
  });
  await client.connect();

  const baselineUntil = process.env.MIGRATION_MARK_BASELINE_UNTIL;

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS vecta_schema_migrations (
        filename     TEXT PRIMARY KEY,
        applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    if (baselineUntil) {
      const idx = files.indexOf(baselineUntil);
      if (idx === -1) {
        console.error(
          'MIGRATION_MARK_BASELINE_UNTIL must match a migration filename exactly. Got:',
          baselineUntil,
        );
        process.exit(1);
      }
      for (let i = 0; i < idx; i++) {
        await client.query(
          `INSERT INTO vecta_schema_migrations (filename) VALUES ($1)
           ON CONFLICT (filename) DO NOTHING`,
          [files[i]],
        );
        console.log('Marked baseline (skipped SQL):', files[i]);
      }
    }

    for (const file of files) {
      const seen = await client.query(
        'SELECT 1 FROM vecta_schema_migrations WHERE filename = $1',
        [file],
      );
      if (seen.rowCount > 0) {
        console.log('Skip (already applied):', file);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO vecta_schema_migrations (filename) VALUES ($1)
           ON CONFLICT (filename) DO NOTHING`,
          [file],
        );
        await client.query('COMMIT');
        console.log('Applied', file);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
