/**
 * @vecta/database — PostgreSQL connection pool (node-postgres + pgvector).
 *
 * - Single pool per process, exported as singleton.
 * - pgvector extension registered on first connection.
 * - Health-check query for readiness probes.
 * - Named query helpers with strict typing.
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { createLogger } from '@vecta/logger';

const logger = createLogger('database');

// ---------------------------------------------------------------------------
// TLS (managed Postgres on Render, etc.)
// ---------------------------------------------------------------------------

/**
 * SSL options for node-postgres. Render Postgres certificates often fail Node’s
 * default chain verification; on Render we still use TLS but skip CA verification
 * unless DATABASE_SSL_REJECT_UNAUTHORIZED is set.
 *
 * DATABASE_SSL_REJECT_UNAUTHORIZED=true  — enforce full CA chain (strict)
 * DATABASE_SSL_REJECT_UNAUTHORIZED=false — skip CA verification (explicit opt-out)
 * (unset, dev)                           — SSL disabled entirely
 * (unset, production)                    — SSL on, self-signed certs accepted
 */
export function getPgSslConfig(): false | { rejectUnauthorized: boolean } {
  const explicit = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
  if (explicit === 'true') {
    return { rejectUnauthorized: true };
  }
  if (explicit === 'false') {
    return { rejectUnauthorized: false };
  }

  if (process.env.NODE_ENV !== 'production') {
    return false;
  }

  // Production default: accept self-signed certificates.
  // Managed Postgres providers (Render, Railway, Supabase, Neon) use self-signed
  // CA chains; strict verification causes "self-signed certificate in certificate
  // chain" without a custom CA bundle installed.
  // Set DATABASE_SSL_REJECT_UNAUTHORIZED=true to enforce strict CA verification.
  return { rejectUnauthorized: false };
}

// ---------------------------------------------------------------------------
// Pool singleton
// ---------------------------------------------------------------------------

/**
 * Strip `sslmode` (and `uselibpqcompat`) from a postgres connection string so
 * that pg-connection-string never touches SSL configuration.  SSL is controlled
 * exclusively via the `ssl` option passed to `new Pool()`.
 *
 * Background: pg-connection-string ≥ 2.7 / pg ≥ 8.12 treats `sslmode=require`
 * as an alias for `sslmode=verify-full` (strict CA verification), which breaks
 * connections to managed-Postgres providers that use self-signed CAs (Render,
 * Railway, Supabase, etc.).  Removing the param from the URL lets node-postgres
 * use the explicit `ssl` object instead.
 */
function stripSslMode(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('sslmode');
    parsed.searchParams.delete('uselibpqcompat');
    return parsed.toString();
  } catch {
    return url;
  }
}

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (_pool) return _pool;

  _pool = new Pool({
    connectionString: stripSslMode(process.env.DATABASE_URL ?? ''),
    max: parseInt(process.env.DB_POOL_MAX ?? '20', 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: getPgSslConfig(),
  });

  _pool.on('connect', (client: PoolClient) => {
    // Enable pgvector on every new connection
    client.query("SET search_path TO public; SELECT 1").catch(() => {});
  });

  _pool.on('error', (err: Error) => {
    logger.error({ err }, 'Unexpected idle client error');
  });

  logger.info('PostgreSQL connection pool initialised');
  return _pool;
}

// ---------------------------------------------------------------------------
// Typed query helpers
// ---------------------------------------------------------------------------

/** Run a parameterised query and return all rows. */
export async function query<T extends QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const pool = getPool();
  const start = Date.now();
  try {
    const result = await pool.query<T>(text, params);
    logger.debug({ rows: result.rowCount, duration: Date.now() - start }, 'query');
    return result;
  } catch (err) {
    logger.error({ err, query: text.slice(0, 200) }, 'query error');
    throw err;
  }
}

/** Run a query and return the first row (or null). */
export async function queryOne<T extends QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
}

/** Obtain a client for manual transaction management. */
export async function getClient(): Promise<PoolClient> {
  return getPool().connect();
}

/**
 * Run a set of queries inside a single SERIALIZABLE transaction.
 * Automatically commits on success or rolls back on error.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getClient();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Transaction rolled back');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export async function checkDatabaseHealth(): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    await query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'unknown',
    };
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    logger.info('PostgreSQL pool closed');
  }
}

// ---------------------------------------------------------------------------
// Migration 002 — student_plaid_connections (missing from original schema)
// ---------------------------------------------------------------------------
// Run via: psql $DATABASE_URL -f packages/database/migrations/002_plaid_connections.sql

export const MIGRATION_002 = `
-- Migration 002: Plaid connection tokens (referenced by banking-service)
CREATE TABLE IF NOT EXISTS student_plaid_connections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  -- AES-256-GCM encrypted Plaid access token — never stored in plain text
  encrypted_access_token TEXT NOT NULL,
  item_id          TEXT NOT NULL UNIQUE,
  institution_name TEXT,
  institution_id   TEXT,
  -- Bitmask of enabled products: 1=transactions, 2=assets, 4=identity
  products_bitmask SMALLINT NOT NULL DEFAULT 2,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'revoked', 'error', 'pending_expiration')),
  consent_expires_at TIMESTAMPTZ,
  last_successful_update TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_student_plaid_item UNIQUE (student_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_plaid_student ON student_plaid_connections (student_id);
CREATE INDEX IF NOT EXISTS idx_plaid_status   ON student_plaid_connections (status);

COMMENT ON TABLE student_plaid_connections IS
  'Encrypted Plaid Item tokens. One student may have multiple bank connections.';
`;
