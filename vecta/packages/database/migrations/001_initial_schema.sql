-- packages/database/migrations/001_initial_schema.sql
-- Vecta Platform — Initial Schema
-- Run order: this file only. Subsequent files are numbered 002_, 003_, etc.

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";        -- pgvector for AI embeddings

-- ─── Students ─────────────────────────────────────────────────────────────────
CREATE TABLE students (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vecta_id_status         TEXT NOT NULL DEFAULT 'UNVERIFIED'
                                CHECK (vecta_id_status IN ('UNVERIFIED','IDENTITY_VERIFIED','BANKING_PROVISIONED','FULLY_ACTIVE')),
    roles                   TEXT[] NOT NULL DEFAULT '{STUDENT}',
    verified_email          TEXT UNIQUE NOT NULL,
    us_phone_number         TEXT,
    legal_name              TEXT,
    visa_type               TEXT CHECK (visa_type IN ('F1_ACTIVE','F1_OPT','F1_CPT','F1_GRACE','F2_DEPENDENT')),
    visa_expiry_year        INT,
    university_id           UUID,
    university_name         TEXT,
    university_enrollment_verified BOOLEAN DEFAULT FALSE,
    face_photo_s3_key       TEXT,             -- Didit liveness selfie

    -- ─── Vaulted PII — AES-256-GCM encrypted at app layer ───────────────────
    passport_number_enc     BYTEA,            -- Encrypted passport number
    country_of_origin_enc   BYTEA,            -- Encrypted (Fair Housing protection)
    i20_s3_key_enc          BYTEA,            -- Encrypted path to I-20 in S3
    sevis_id_enc            BYTEA,            -- Encrypted SEVIS ID

    -- ─── Unit.co ─────────────────────────────────────────────────────────────
    unit_customer_id        TEXT,             -- Unit.co customer ID
    unit_account_id_enc     BYTEA,            -- Encrypted Unit account ID
    kyc_status              TEXT NOT NULL DEFAULT 'PENDING'
                                CHECK (kyc_status IN ('PENDING','IN_PROGRESS','APPROVED','REJECTED','NEEDS_REVIEW')),

    -- ─── Nova Credit ─────────────────────────────────────────────────────────
    nova_credit_report_id   TEXT,
    vecta_trust_score       INT CHECK (vecta_trust_score BETWEEN 300 AND 850),
    trust_score_tier        TEXT CHECK (trust_score_tier IN ('EXCELLENT','GOOD','FAIR','BUILDING')),
    nova_credit_fetched_at  TIMESTAMPTZ,

    -- ─── eSIM ────────────────────────────────────────────────────────────────
    esim_iccid              TEXT,             -- SIM card ID
    esim_activated_at       TIMESTAMPTZ,
    -- device_imei is NEVER stored per privacy design

    -- ─── Timestamps ──────────────────────────────────────────────────────────
    didit_verified_at       TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_students_email ON students(verified_email);
CREATE INDEX idx_students_kyc_status ON students(kyc_status);
CREATE INDEX idx_students_vecta_id_status ON students(vecta_id_status);

-- ─── Didit Verification Sessions ─────────────────────────────────────────────
CREATE TABLE didit_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    session_id      TEXT NOT NULL UNIQUE,     -- Didit's session ID
    liveness_score  DECIMAL(5,4) NOT NULL,
    facial_match    DECIMAL(5,4) NOT NULL,
    chip_verified   BOOLEAN NOT NULL,
    mrz_surname     TEXT NOT NULL,
    mrz_given_names TEXT NOT NULL,
    -- Sensitive fields encrypted
    mrz_doc_number_enc  BYTEA NOT NULL,
    mrz_nationality_enc BYTEA NOT NULL,
    mrz_expiry_date     TEXT NOT NULL,        -- Non-sensitive (just a date)
    raw_response_enc    BYTEA,                -- Full Didit response, encrypted
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Vecta ID Tokens (JWT registry for revocation) ───────────────────────────
CREATE TABLE vecta_id_tokens (
    jti             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked         BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at      TIMESTAMPTZ,
    revoke_reason   TEXT
);

CREATE INDEX idx_vecta_id_tokens_student ON vecta_id_tokens(student_id);
CREATE INDEX idx_vecta_id_tokens_jti ON vecta_id_tokens(jti) WHERE NOT revoked;

-- ─── Letters of Credit ────────────────────────────────────────────────────────
CREATE TABLE letters_of_credit (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id          UUID NOT NULL REFERENCES students(id),
    plaid_report_id     TEXT NOT NULL,
    guaranteed_months   INT NOT NULL,
    total_balance_usd   INT NOT NULL,       -- In cents — never expose raw
    crypto_hash         TEXT NOT NULL,
    signature_key_id    TEXT NOT NULL,
    s3_pdf_key          TEXT NOT NULL,
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL
);

-- ─── Student Lifestyle Profiles (for AI roommate matching) ───────────────────
CREATE TABLE student_lifestyle_profiles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id      UUID NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
    major           TEXT NOT NULL,
    university_id   UUID,
    sleep_schedule  TEXT CHECK (sleep_schedule IN ('EARLY_BIRD','NIGHT_OWL','FLEXIBLE')),
    study_env       TEXT CHECK (study_env IN ('SILENT','BACKGROUND_NOISE','SOCIAL')),
    guest_frequency TEXT CHECK (guest_frequency IN ('NEVER','RARELY','SOMETIMES','OFTEN')),
    cleanliness     INT CHECK (cleanliness BETWEEN 1 AND 5),
    dietary         TEXT[],
    languages       TEXT[],
    hobbies         TEXT[],
    move_in_date    DATE,
    budget_min      INT NOT NULL,
    budget_max      INT NOT NULL,
    -- pgvector: 1536-dim OpenAI ada-002 embedding of lifestyle profile
    embedding       vector(1536),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lifestyle_embedding ON student_lifestyle_profiles
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ─── Vehicle Leases ───────────────────────────────────────────────────────────
CREATE TABLE vehicle_leases (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id          UUID NOT NULL REFERENCES students(id),
    vehicle_vin         TEXT NOT NULL,
    vehicle_make        TEXT NOT NULL,
    vehicle_model       TEXT NOT NULL,
    vehicle_year        INT NOT NULL,
    tos_version         TEXT NOT NULL,
    -- Consent clauses — each stored with timestamp for legal record
    passive_acknowledged        BOOLEAN NOT NULL DEFAULT FALSE,
    tax_acknowledged            BOOLEAN NOT NULL DEFAULT FALSE,
    flight_recorder_consented   BOOLEAN NOT NULL DEFAULT FALSE,
    counsel_waiver_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    -- Binding metadata
    consent_timestamp   TIMESTAMPTZ NOT NULL,
    consent_ip          INET NOT NULL,
    consent_user_agent  TEXT NOT NULL,
    signature_hash      TEXT NOT NULL,   -- SHA-256 of all above
    -- Legal validity check: all 4 must be TRUE before lease is active
    lease_active        BOOLEAN GENERATED ALWAYS AS (
        passive_acknowledged AND tax_acknowledged AND
        flight_recorder_consented AND counsel_waiver_acknowledged
    ) STORED,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CRITICAL: When lease becomes active, student role is updated to LESSOR
-- This is handled in the application layer + the trigger below

CREATE OR REPLACE FUNCTION update_student_to_lessor()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.lease_active = TRUE AND OLD.lease_active = FALSE THEN
        UPDATE students
        SET roles = array_append(
            array_remove(roles, 'STUDENT'),  -- Remove base STUDENT
            'LESSOR'                          -- Add LESSOR
        )
        WHERE id = NEW.student_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_activate_lessor_role
    AFTER UPDATE ON vehicle_leases
    FOR EACH ROW EXECUTE FUNCTION update_student_to_lessor();

-- ─── Flight Recorder (Immutable Audit Chain) ──────────────────────────────────
CREATE TABLE flight_recorder (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    block_index         BIGINT NOT NULL UNIQUE,  -- Monotonically increasing
    ride_id             UUID NOT NULL UNIQUE,
    vehicle_vin         TEXT NOT NULL,
    lessor_student_id   UUID NOT NULL REFERENCES students(id),
    driver_user_id      UUID NOT NULL,           -- NON-F1 driver
    start_ts            TIMESTAMPTZ NOT NULL,
    end_ts              TIMESTAMPTZ NOT NULL,
    start_lat           DECIMAL(10,7) NOT NULL,
    start_lng           DECIMAL(10,7) NOT NULL,
    end_lat             DECIMAL(10,7) NOT NULL,
    end_lng             DECIMAL(10,7) NOT NULL,
    distance_miles      DECIMAL(8,2) NOT NULL,
    fare_amount_cents   INT NOT NULL,
    rental_income_cents INT NOT NULL,
    crypto_hash         TEXT NOT NULL,           -- SHA-256 of this row's data
    previous_hash       TEXT NOT NULL,           -- Links to previous block
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- CRITICAL: This table is append-only. No updates or deletes.
    CONSTRAINT chk_driver_ne_lessor CHECK (driver_user_id != lessor_student_id)
);

-- Prevent any UPDATE or DELETE on flight_recorder (immutable audit log)
CREATE RULE no_update_flight_recorder AS ON UPDATE TO flight_recorder DO INSTEAD NOTHING;
CREATE RULE no_delete_flight_recorder AS ON DELETE TO flight_recorder DO INSTEAD NOTHING;

CREATE INDEX idx_fr_lessor ON flight_recorder(lessor_student_id);
CREATE INDEX idx_fr_vehicle ON flight_recorder(vehicle_vin);

-- ─── Landlord Verification Logs ───────────────────────────────────────────────
CREATE TABLE landlord_verification_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id      UUID NOT NULL REFERENCES students(id),
    token_jti       UUID NOT NULL,
    landlord_ip     INET,
    user_agent      TEXT,
    verified_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Audit Events ─────────────────────────────────────────────────────────────
CREATE TABLE audit_events (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id  UUID REFERENCES students(id),
    event_type  TEXT NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}',
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_student ON audit_events(student_id, created_at DESC);
CREATE INDEX idx_audit_type ON audit_events(event_type, created_at DESC);

-- ─── Updated-at trigger for key tables ───────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_students_updated_at
    BEFORE UPDATE ON students
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_lifestyle_updated_at
    BEFORE UPDATE ON student_lifestyle_profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- Addendum: Single-use landlord verification tokens
-- =============================================================================

CREATE TABLE IF NOT EXISTS landlord_verification_tokens (
  jti               TEXT        PRIMARY KEY,          -- JWT ID claim
  student_id        UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  landlord_ip       INET,
  landlord_user_agent TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL,
  used_at           TIMESTAMPTZ,                      -- NULL = not yet consumed
  used_by_ip        INET
);

CREATE INDEX IF NOT EXISTS idx_lvt_student ON landlord_verification_tokens(student_id);
CREATE INDEX IF NOT EXISTS idx_lvt_expires ON landlord_verification_tokens(expires_at)
  WHERE used_at IS NULL;

COMMENT ON TABLE landlord_verification_tokens IS
  'One-time-use registry for Vecta ID sharing tokens. Once a landlord opens the link,
   used_at is stamped and subsequent requests for the same JTI are rejected.';

-- =============================================================================
-- Addendum: RBAC audit trail
-- =============================================================================

CREATE TABLE IF NOT EXISTS rbac_audit_log (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id          UUID        NOT NULL,
  actor_role        TEXT        NOT NULL,
  attempted_action  TEXT        NOT NULL,
  result            TEXT        NOT NULL CHECK (result IN ('ALLOWED', 'BLOCKED')),
  block_reason      TEXT,                             -- e.g. 'F1_VISA_COMPLIANCE_VIOLATION'
  ip_address        INET,
  user_agent        TEXT,
  correlation_id    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rbac_actor   ON rbac_audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rbac_action  ON rbac_audit_log(attempted_action, result);
CREATE INDEX IF NOT EXISTS idx_rbac_blocked ON rbac_audit_log(result, created_at DESC)
  WHERE result = 'BLOCKED';

COMMENT ON TABLE rbac_audit_log IS
  'Immutable log of every permission check. BLOCKED rows are primary evidence
   for USCIS/IRS audits showing the system actively prevented F-1 violations.';

-- =============================================================================
-- Addendum: Hash chain external anchors
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_chain_anchors (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        UUID        REFERENCES students(id) ON DELETE SET NULL,
  anchor_type       TEXT        NOT NULL CHECK (anchor_type IN ('S3_SIGNED', 'INTERNAL_CHECKPOINT')),
  chain_tip_hash    TEXT        NOT NULL,             -- SHA-256 of last entry at anchor time
  entry_count       INT         NOT NULL,
  tax_year          INT,
  s3_key            TEXT,                             -- path in vecta-compliance bucket
  s3_etag           TEXT,                             -- S3 ETag proves object not modified
  anchored_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anchor_student ON audit_chain_anchors(student_id, anchored_at DESC);

-- =============================================================================
-- Addendum: Landlord profiles + verification tiers
-- =============================================================================

CREATE TABLE IF NOT EXISTS landlord_profiles (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email                    TEXT        NOT NULL UNIQUE,
  full_name                TEXT,
  company_name             TEXT,
  phone                    TEXT,
  email_verified           BOOLEAN     NOT NULL DEFAULT FALSE,
  email_verified_at        TIMESTAMPTZ,
  email_verification_token TEXT,                            -- bcrypt hash of magic-link token
  background_check_status  TEXT        DEFAULT 'PENDING'
                           CHECK (background_check_status IN ('PENDING','APPROVED','REJECTED','SKIPPED')),
  background_check_provider TEXT,                           -- e.g. 'Checkr'
  background_check_id      TEXT,
  properties_count         INT         NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_landlord_email ON landlord_profiles(email);
CREATE INDEX IF NOT EXISTS idx_landlord_verified ON landlord_profiles(email_verified)
  WHERE email_verified = TRUE;

COMMENT ON TABLE landlord_profiles IS
  'Landlords who register to use the Vecta verification portal.
   email_verified=TRUE → VERIFIED tier (can download LoC).
   background_check_status=APPROVED → TRUSTED tier (can initiate lease).';

-- auto-update updated_at
CREATE TRIGGER trg_landlord_updated_at
  BEFORE UPDATE ON landlord_profiles
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
