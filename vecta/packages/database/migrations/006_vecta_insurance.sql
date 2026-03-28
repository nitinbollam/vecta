-- =============================================================================
-- 006_vecta_insurance.sql
-- Vecta MGA Insurance Schema — replaces Lemonade, ISO, PSI
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Insurance quotes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS insurance_quotes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  policy_type           TEXT NOT NULL CHECK (policy_type IN ('RENTERS', 'AUTO', 'HEALTH')),
  plan_tier             TEXT CHECK (plan_tier IN ('BASIC', 'STANDARD', 'PREMIUM')),  -- for HEALTH only

  -- Pricing
  monthly_premium_cents BIGINT NOT NULL CHECK (monthly_premium_cents > 0),
  annual_premium_cents  BIGINT NOT NULL,
  coverage_amount_cents BIGINT NOT NULL,
  deductible_cents      BIGINT NOT NULL DEFAULT 0,
  liability_cents       BIGINT DEFAULT 0,

  -- Quote metadata
  underwriting_data     JSONB NOT NULL DEFAULT '{}',
  paper_provider        TEXT NOT NULL DEFAULT 'boost',   -- boost | state-national
  status                TEXT NOT NULL DEFAULT 'ACTIVE'
                          CHECK (status IN ('ACTIVE', 'EXPIRED', 'CONVERTED')),
  converted_to_policy   UUID,   -- FK added after insurance_policies is created

  expires_at            TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_insurance_quotes_student ON insurance_quotes(student_id, created_at DESC);
CREATE INDEX idx_insurance_quotes_active  ON insurance_quotes(student_id, status)
  WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- Insurance policies (bound quotes)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS insurance_policies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  quote_id              UUID REFERENCES insurance_quotes(id),
  policy_type           TEXT NOT NULL CHECK (policy_type IN ('RENTERS', 'AUTO', 'HEALTH')),
  policy_number         TEXT NOT NULL UNIQUE,    -- VECTA-[TYPE]-[YEAR]-[8RANDOM]
  plan_tier             TEXT,                    -- for HEALTH policies

  status                TEXT NOT NULL DEFAULT 'ACTIVE'
                          CHECK (status IN ('ACTIVE', 'CANCELLED', 'EXPIRED', 'PENDING_PAYMENT')),

  -- Coverage
  coverage_amount_cents BIGINT NOT NULL,
  deductible_cents      BIGINT NOT NULL,
  liability_cents       BIGINT DEFAULT 0,
  monthly_premium_cents BIGINT NOT NULL,
  annual_premium_cents  BIGINT NOT NULL,

  -- Policy dates
  effective_date        DATE NOT NULL,
  expiry_date           DATE NOT NULL,

  -- Paper provider details
  paper_provider        TEXT NOT NULL,           -- boost | state-national
  paper_policy_ref      TEXT,                    -- their reference number
  paper_status          TEXT DEFAULT 'PENDING',  -- pending | bound | cancelled

  -- Digital assets
  card_url              TEXT,                    -- S3 URL to PDF insurance card
  certificate_url       TEXT,                    -- S3 URL to certificate of insurance

  -- Underwriting snapshot at time of binding
  underwriting_data     JSONB NOT NULL DEFAULT '{}',

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at          TIMESTAMPTZ,
  cancellation_reason   TEXT
);

-- Add FK from quotes to policies now that policies table exists
ALTER TABLE insurance_quotes
  ADD CONSTRAINT fk_quotes_policy
  FOREIGN KEY (converted_to_policy)
  REFERENCES insurance_policies(id);

CREATE INDEX idx_insurance_policies_student ON insurance_policies(student_id, created_at DESC);
CREATE INDEX idx_insurance_policies_active  ON insurance_policies(student_id, status)
  WHERE status = 'ACTIVE';
CREATE INDEX idx_insurance_policies_expiry  ON insurance_policies(expiry_date)
  WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- Claims
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS insurance_claims (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id             UUID NOT NULL REFERENCES insurance_policies(id) ON DELETE RESTRICT,
  student_id            UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  claim_type            TEXT NOT NULL,      -- theft | damage | medical | liability | other
  description           TEXT NOT NULL,
  incident_date         DATE NOT NULL,
  incident_location     TEXT,
  amount_claimed_cents  BIGINT,
  amount_paid_cents     BIGINT,

  status                TEXT NOT NULL DEFAULT 'SUBMITTED'
                          CHECK (status IN (
                            'SUBMITTED', 'UNDER_REVIEW', 'APPROVED',
                            'PARTIALLY_APPROVED', 'DENIED', 'CLOSED'
                          )),

  -- Paper provider claim reference
  paper_claim_ref       TEXT,
  adjuster_notes        TEXT,
  resolution_notes      TEXT,

  -- Evidence attachments (S3 URLs)
  attachments           JSONB NOT NULL DEFAULT '[]',

  submitted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at           TIMESTAMPTZ,
  resolved_at           TIMESTAMPTZ
);

CREATE INDEX idx_insurance_claims_policy  ON insurance_claims(policy_id);
CREATE INDEX idx_insurance_claims_student ON insurance_claims(student_id, submitted_at DESC);

-- ---------------------------------------------------------------------------
-- Premium payment ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS insurance_premium_payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id             UUID NOT NULL REFERENCES insurance_policies(id),
  amount_cents          BIGINT NOT NULL,
  billing_period_start  DATE NOT NULL,
  billing_period_end    DATE NOT NULL,
  status                TEXT NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED')),
  payment_method        TEXT,     -- vecta-ledger | external | waived
  ledger_txn_id         UUID,     -- reference to ledger_entries if paid via VectaLedger
  due_date              DATE NOT NULL,
  paid_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Auto-update updated_at
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_insurance_policy_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER insurance_policy_updated_at
  BEFORE UPDATE ON insurance_policies
  FOR EACH ROW EXECUTE FUNCTION update_insurance_policy_timestamp();

-- ---------------------------------------------------------------------------
-- View: active coverage summary per student
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW student_insurance_summary AS
  SELECT
    p.student_id,
    bool_or(p.policy_type = 'HEALTH')  AS has_health,
    bool_or(p.policy_type = 'RENTERS') AS has_renters,
    bool_or(p.policy_type = 'AUTO')    AS has_auto,
    SUM(p.monthly_premium_cents)       AS total_monthly_premium_cents,
    MIN(p.expiry_date)                 AS soonest_expiry
  FROM insurance_policies p
  WHERE p.status = 'ACTIVE'
  GROUP BY p.student_id;
