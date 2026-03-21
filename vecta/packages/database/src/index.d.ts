/**
 * @vecta/database — PostgreSQL connection pool (node-postgres + pgvector).
 *
 * - Single pool per process, exported as singleton.
 * - pgvector extension registered on first connection.
 * - Health-check query for readiness probes.
 * - Named query helpers with strict typing.
 */
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
export declare function getPool(): Pool;
/** Run a parameterised query and return all rows. */
export declare function query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
/** Run a query and return the first row (or null). */
export declare function queryOne<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<T | null>;
/** Obtain a client for manual transaction management. */
export declare function getClient(): Promise<PoolClient>;
/**
 * Run a set of queries inside a single SERIALIZABLE transaction.
 * Automatically commits on success or rolls back on error.
 */
export declare function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
export declare function checkDatabaseHealth(): Promise<{
    ok: boolean;
    latencyMs: number;
    error?: string;
}>;
export declare function closePool(): Promise<void>;
export declare const MIGRATION_002 = "\n-- Migration 002: Plaid connection tokens (referenced by banking-service)\nCREATE TABLE IF NOT EXISTS student_plaid_connections (\n  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  student_id       UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,\n  -- AES-256-GCM encrypted Plaid access token \u2014 never stored in plain text\n  encrypted_access_token TEXT NOT NULL,\n  item_id          TEXT NOT NULL UNIQUE,\n  institution_name TEXT,\n  institution_id   TEXT,\n  -- Bitmask of enabled products: 1=transactions, 2=assets, 4=identity\n  products_bitmask SMALLINT NOT NULL DEFAULT 2,\n  status           TEXT NOT NULL DEFAULT 'active'\n                   CHECK (status IN ('active', 'revoked', 'error', 'pending_expiration')),\n  consent_expires_at TIMESTAMPTZ,\n  last_successful_update TIMESTAMPTZ,\n  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n  CONSTRAINT uq_student_plaid_item UNIQUE (student_id, item_id)\n);\n\nCREATE INDEX IF NOT EXISTS idx_plaid_student ON student_plaid_connections (student_id);\nCREATE INDEX IF NOT EXISTS idx_plaid_status   ON student_plaid_connections (status);\n\nCOMMENT ON TABLE student_plaid_connections IS\n  'Encrypted Plaid Item tokens. One student may have multiple bank connections.';\n";
//# sourceMappingURL=index.d.ts.map