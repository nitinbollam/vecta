-- =============================================================================
-- Migration 002 — Plaid connections table
-- Depends on: 001_initial_schema.sql (students table must exist)
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS student_plaid_connections (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id             UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,

  -- AES-256-GCM encrypted Plaid access token — never stored in plain text
  encrypted_access_token TEXT        NOT NULL,
  item_id                TEXT        NOT NULL,
  institution_name       TEXT,
  institution_id         TEXT,

  -- Bitmask of Plaid products enabled on this item
  -- 1 = transactions, 2 = assets, 4 = identity
  products_bitmask       SMALLINT    NOT NULL DEFAULT 2,

  status                 TEXT        NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'revoked', 'error', 'pending_expiration')),

  -- Plaid re-consent deadline (items expire after 12 months without re-auth)
  consent_expires_at     TIMESTAMPTZ,
  last_successful_update TIMESTAMPTZ,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_student_plaid_item UNIQUE (student_id, item_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_plaid_connections_student
  ON student_plaid_connections (student_id);

CREATE INDEX IF NOT EXISTS idx_plaid_connections_status
  ON student_plaid_connections (status)
  WHERE status != 'revoked';

-- ---------------------------------------------------------------------------
-- Auto-update trigger for updated_at
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plaid_updated_at ON student_plaid_connections;
CREATE TRIGGER trg_plaid_updated_at
  BEFORE UPDATE ON student_plaid_connections
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

COMMENT ON TABLE student_plaid_connections IS
  'Encrypted Plaid Item access tokens. One student may link multiple institutions.
   The raw access token is NEVER stored — only AES-256-GCM encrypted form.';

COMMENT ON COLUMN student_plaid_connections.encrypted_access_token IS
  'AES-256-GCM token. Format: iv_b64url:authTag_b64url:ciphertext_b64url';

COMMENT ON COLUMN student_plaid_connections.products_bitmask IS
  'Bitmask: 1=transactions, 2=assets, 4=identity. Default 2 (assets only for LoC).';

COMMIT;
