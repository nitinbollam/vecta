-- =============================================================================
-- Migration 003 — Compliance & Trust Infrastructure
-- Depends on: 001_initial_schema.sql, 002_plaid_connections.sql
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Landlord profiles + verification tiers
-- =============================================================================

CREATE TABLE IF NOT EXISTS landlord_profiles (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email                    TEXT        NOT NULL UNIQUE,
  full_name                TEXT,
  company_name             TEXT,
  phone                    TEXT,
  email_verified           BOOLEAN     NOT NULL DEFAULT FALSE,
  email_verified_at        TIMESTAMPTZ,
  email_verification_token TEXT,        -- HMAC(rawToken):expiresAt ISO string
  background_check_status  TEXT        DEFAULT 'PENDING'
                           CHECK (background_check_status IN ('PENDING','APPROVED','REJECTED','SKIPPED')),
  background_check_provider TEXT,       -- e.g. 'Checkr'
  background_check_id      TEXT,        -- Checkr report ID
  properties_count         INT         NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_landlord_email    ON landlord_profiles(email);
CREATE INDEX IF NOT EXISTS idx_landlord_verified ON landlord_profiles(email_verified)
  WHERE email_verified = TRUE;
CREATE INDEX IF NOT EXISTS idx_landlord_bgcheck  ON landlord_profiles(background_check_status)
  WHERE background_check_status = 'APPROVED';

DROP TRIGGER IF EXISTS trg_landlord_updated_at ON landlord_profiles;
CREATE TRIGGER trg_landlord_updated_at
  BEFORE UPDATE ON landlord_profiles
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMENT ON TABLE landlord_profiles IS
  'Landlords who register to use the Vecta verification portal.
   Tier: ANONYMOUS (unverified) → VERIFIED (email) → TRUSTED (background check).
   email_verified=TRUE unlocks LoC download.
   background_check_status=APPROVED unlocks lease initiation.';

COMMENT ON COLUMN landlord_profiles.email_verification_token IS
  'HMAC-SHA256(rawToken):expiresAt — raw token never stored, only hash.
   Cleared after successful verification to prevent reuse.';

-- =============================================================================
-- 2. Single-use landlord verification token registry
-- =============================================================================

CREATE TABLE IF NOT EXISTS landlord_verification_tokens (
  jti               TEXT        PRIMARY KEY,    -- JWT ID claim
  student_id        UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  landlord_ip       INET,
  landlord_user_agent TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL,
  used_at           TIMESTAMPTZ,               -- NULL = not yet consumed
  used_by_ip        INET
);

CREATE INDEX IF NOT EXISTS idx_lvt_student ON landlord_verification_tokens(student_id);
CREATE INDEX IF NOT EXISTS idx_lvt_expires ON landlord_verification_tokens(expires_at)
  WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lvt_unused  ON landlord_verification_tokens(student_id, used_at)
  WHERE used_at IS NULL;

COMMENT ON TABLE landlord_verification_tokens IS
  'One-time-use registry for Vecta ID sharing tokens.
   Once a landlord opens the link, used_at is atomically stamped.
   Subsequent requests for the same JTI return 409 ALREADY_USED.
   Prevents link forwarding and replay attacks.';

-- =============================================================================
-- 3. RBAC audit trail
-- =============================================================================

CREATE TABLE IF NOT EXISTS rbac_audit_log (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id          UUID        NOT NULL,
  actor_role        TEXT        NOT NULL,
  attempted_action  TEXT        NOT NULL,
  result            TEXT        NOT NULL CHECK (result IN ('ALLOWED', 'BLOCKED')),
  block_reason      TEXT,                      -- e.g. 'F1_VISA_COMPLIANCE_VIOLATION'
  ip_address        INET,
  user_agent        TEXT,
  correlation_id    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rbac_actor   ON rbac_audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rbac_action  ON rbac_audit_log(attempted_action, result);
CREATE INDEX IF NOT EXISTS idx_rbac_blocked ON rbac_audit_log(actor_id, result, created_at DESC)
  WHERE result = 'BLOCKED';
CREATE INDEX IF NOT EXISTS idx_rbac_f1      ON rbac_audit_log(actor_id, block_reason)
  WHERE block_reason = 'F1_VISA_COMPLIANCE_VIOLATION';

COMMENT ON TABLE rbac_audit_log IS
  'Immutable log of every RBAC permission check (ALLOWED and BLOCKED).
   F1_VISA_COMPLIANCE_VIOLATION entries are primary evidence for USCIS/IRS audits.
   Never deleted — no UPDATE/DELETE API exposed.';

-- Prevent updates and deletes (append-only enforcement)
CREATE RULE no_update_rbac_audit AS
  ON UPDATE TO rbac_audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_rbac_audit AS
  ON DELETE TO rbac_audit_log DO INSTEAD NOTHING;

-- =============================================================================
-- 4. Hash chain external anchors
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_chain_anchors (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        UUID        REFERENCES students(id) ON DELETE SET NULL,
  anchor_type       TEXT        NOT NULL CHECK (anchor_type IN ('S3_SIGNED', 'INTERNAL_CHECKPOINT')),
  chain_tip_hash    TEXT        NOT NULL,   -- SHA-256 of last flight_recorder entry at anchor time
  entry_count       INT         NOT NULL,
  tax_year          INT,
  s3_key            TEXT,                  -- path in vecta-compliance bucket
  s3_etag           TEXT,                  -- S3 ETag — mismatch = tampering
  anchored_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anchor_student ON audit_chain_anchors(student_id, anchored_at DESC);
CREATE INDEX IF NOT EXISTS idx_anchor_year    ON audit_chain_anchors(student_id, tax_year);

COMMENT ON TABLE audit_chain_anchors IS
  'External hash anchors for the flight_recorder chain.
   Each anchor stores the chain tip hash in S3 (versioned bucket + HMAC-signed manifest).
   Tampering with the flight_recorder table breaks the anchor verification, detectable
   by comparing chain_tip_hash here vs re-computing from flight_recorder rows.';

-- =============================================================================
-- 5. Add verified_balance_usd to student_plaid_connections (referenced by trust engine)
-- =============================================================================

ALTER TABLE student_plaid_connections
  ADD COLUMN IF NOT EXISTS verified_balance_usd NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_currency     TEXT          DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS balance_verified_at  TIMESTAMPTZ;

COMMENT ON COLUMN student_plaid_connections.verified_balance_usd IS
  'Most recent verified liquid balance from Plaid Asset Report.
   Used by trust engine (liquidity factor) — NEVER exposed directly to landlords.
   Landlords see only the balance tier range label.';

-- =============================================================================
-- 6. Push notification tokens (Expo push tokens)
-- =============================================================================

CREATE TABLE IF NOT EXISTS student_push_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  expo_token  TEXT        NOT NULL UNIQUE,  -- ExponentPushToken[xxxxx]
  device_type TEXT        NOT NULL CHECK (device_type IN ('ios', 'android')),
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_student ON student_push_tokens(student_id)
  WHERE is_active = TRUE;

COMMENT ON TABLE student_push_tokens IS
  'Expo push notification tokens for student app.
   Used to notify students when: landlord views their Vecta ID,
   KYC approved/rejected, LoC generated, flight recorder entry logged.';

COMMIT;

-- =============================================================================
-- 7. Student magic links (for passwordless auth)
-- =============================================================================

CREATE TABLE IF NOT EXISTS student_magic_links (
  student_id  UUID        PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL,    -- HMAC-SHA256(rawToken) — raw never stored
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_magic_links_token ON student_magic_links(token_hash)
  WHERE used_at IS NULL;

COMMENT ON TABLE student_magic_links IS
  'Passwordless sign-in tokens for student app.
   One active link per student (upserted on each request).
   token_hash = HMAC-SHA256(rawToken) — raw token emailed, never stored.
   15-minute TTL, single-use.';

-- =============================================================================
-- 8. Tenant trust certificates (issued by certificate.router.ts)
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenant_trust_certificates (
  cert_id        TEXT        PRIMARY KEY,                 -- UUID from signCertificate
  student_id     UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  cert_status    TEXT        NOT NULL
                 CHECK (cert_status IN ('FULL','CONTINGENT','PARTIAL','INVALID')),
  canonical_hash TEXT        NOT NULL,                    -- SHA-256 hex
  signature      TEXT        NOT NULL,                    -- Ed25519 hex (128 chars)
  public_key_hex TEXT        NOT NULL,                    -- SPKI DER hex
  issued_at      TIMESTAMPTZ NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  landlord_ip    INET,
  landlord_email TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_certs_student   ON tenant_trust_certificates(student_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_certs_status    ON tenant_trust_certificates(cert_status);
CREATE INDEX IF NOT EXISTS idx_certs_expires   ON tenant_trust_certificates(expires_at)
  WHERE expires_at > NOW();

COMMENT ON TABLE tenant_trust_certificates IS
  'Ed25519-signed Trust Certificates. Each row = one certificate issuance.
   canonical_hash + signature enable offline verification by landlords.
   cert_id is embedded in Letters of Credit PDFs.';

-- =============================================================================
-- 9. Lease applications (created by /certificate/:certId/accept)
-- =============================================================================

CREATE TABLE IF NOT EXISTS lease_applications (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cert_id               TEXT        NOT NULL REFERENCES tenant_trust_certificates(cert_id),
  student_id            UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  landlord_email        TEXT        NOT NULL,
  property_address      TEXT        NOT NULL,
  monthly_rent          NUMERIC(10,2) NOT NULL,
  lease_start_date      DATE        NOT NULL,
  lease_duration_months SMALLINT    NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'PENDING_SIGNATURE'
                        CHECK (status IN ('PENDING_SIGNATURE','SIGNED','CANCELLED','EXPIRED')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lease_app_student  ON lease_applications(student_id);
CREATE INDEX IF NOT EXISTS idx_lease_app_cert     ON lease_applications(cert_id);
CREATE INDEX IF NOT EXISTS idx_lease_app_landlord ON lease_applications(landlord_email);

DROP TRIGGER IF EXISTS trg_lease_app_updated_at ON lease_applications;
CREATE TRIGGER trg_lease_app_updated_at
  BEFORE UPDATE ON lease_applications
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMENT ON TABLE lease_applications IS
  'Lease applications initiated by verified landlords via the Trust Certificate portal.
   Each application references a cert_id — the certificate proves the student is verified.';
