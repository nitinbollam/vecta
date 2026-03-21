"use strict";
/**
 * @vecta/database — PostgreSQL connection pool (node-postgres + pgvector).
 *
 * - Single pool per process, exported as singleton.
 * - pgvector extension registered on first connection.
 * - Health-check query for readiness probes.
 * - Named query helpers with strict typing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIGRATION_002 = void 0;
exports.getPool = getPool;
exports.query = query;
exports.queryOne = queryOne;
exports.getClient = getClient;
exports.withTransaction = withTransaction;
exports.checkDatabaseHealth = checkDatabaseHealth;
exports.closePool = closePool;
const pg_1 = require("pg");
const logger_1 = require("@vecta/logger");
const logger = (0, logger_1.createLogger)('database');
// ---------------------------------------------------------------------------
// Pool singleton
// ---------------------------------------------------------------------------
let _pool = null;
function getPool() {
    if (_pool)
        return _pool;
    _pool = new pg_1.Pool({
        connectionString: process.env.DATABASE_URL,
        max: parseInt(process.env.DB_POOL_MAX ?? '20', 10),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        ssl: process.env.NODE_ENV === 'production'
            ? { rejectUnauthorized: true }
            : false,
    });
    _pool.on('connect', (client) => {
        // Enable pgvector on every new connection
        client.query("SET search_path TO public; SELECT 1").catch(() => { });
    });
    _pool.on('error', (err) => {
        logger.error({ err }, 'Unexpected idle client error');
    });
    logger.info('PostgreSQL connection pool initialised');
    return _pool;
}
// ---------------------------------------------------------------------------
// Typed query helpers
// ---------------------------------------------------------------------------
/** Run a parameterised query and return all rows. */
async function query(text, params) {
    const pool = getPool();
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        logger.debug({ rows: result.rowCount, duration: Date.now() - start }, 'query');
        return result;
    }
    catch (err) {
        logger.error({ err, query: text.slice(0, 200) }, 'query error');
        throw err;
    }
}
/** Run a query and return the first row (or null). */
async function queryOne(text, params) {
    const result = await query(text, params);
    return result.rows[0] ?? null;
}
/** Obtain a client for manual transaction management. */
async function getClient() {
    return getPool().connect();
}
/**
 * Run a set of queries inside a single SERIALIZABLE transaction.
 * Automatically commits on success or rolls back on error.
 */
async function withTransaction(fn) {
    const client = await getClient();
    try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (err) {
        await client.query('ROLLBACK');
        logger.error({ err }, 'Transaction rolled back');
        throw err;
    }
    finally {
        client.release();
    }
}
// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
async function checkDatabaseHealth() {
    const start = Date.now();
    try {
        await query('SELECT 1');
        return { ok: true, latencyMs: Date.now() - start };
    }
    catch (err) {
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
async function closePool() {
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
exports.MIGRATION_002 = `
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
//# sourceMappingURL=index.js.map