-- =============================================================================
-- Migration 004 — Compliance Operations & Landlord Network
-- Depends on: 001, 002, 003
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Compliance cases (human review queue)
-- =============================================================================

CREATE TABLE IF NOT EXISTS compliance_cases (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID        REFERENCES students(id) ON DELETE SET NULL,
  type          TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'OPEN'
                CHECK (status IN ('OPEN','IN_REVIEW','RESOLVED_PASS','RESOLVED_FAIL','ESCALATED')),
  priority      TEXT        NOT NULL
                CHECK (priority IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  triggered_by  TEXT        NOT NULL,    -- rule name that created this case
  rule_version  TEXT        NOT NULL,    -- semver — links to policy doc version
  evidence      JSONB       NOT NULL DEFAULT '{}',
  assigned_to   TEXT,                   -- compliance officer email
  resolution    TEXT,                   -- free-text rationale for the decision
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cases_status    ON compliance_cases(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_cases_student   ON compliance_cases(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_type      ON compliance_cases(type, status);
CREATE INDEX IF NOT EXISTS idx_cases_open      ON compliance_cases(priority, created_at)
  WHERE status IN ('OPEN','IN_REVIEW','ESCALATED');

DROP TRIGGER IF EXISTS trg_cases_updated_at ON compliance_cases;
CREATE TRIGGER trg_cases_updated_at
  BEFORE UPDATE ON compliance_cases
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Compliance cases are immutable once resolved — prevent backdating
CREATE RULE no_reopen_resolved_cases AS
  ON UPDATE TO compliance_cases
  WHERE OLD.status IN ('RESOLVED_PASS','RESOLVED_FAIL')
    AND NEW.status NOT IN ('RESOLVED_PASS','RESOLVED_FAIL','ESCALATED')
  DO INSTEAD NOTHING;

COMMENT ON TABLE compliance_cases IS
  'Human review queue for compliance exceptions.
   Every case links to a policy rule (rule_version) and a compliance officer decision.
   CRITICAL/HIGH priority cases trigger immediate Slack/email alerts.
   Used to demonstrate regulatory accountability (BSA, FCRA, KYC).';

-- =============================================================================
-- 2. AML policy log — every policy evaluation recorded for audit
-- =============================================================================

CREATE TABLE IF NOT EXISTS aml_policy_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID        REFERENCES students(id) ON DELETE SET NULL,
  case_id       UUID        REFERENCES compliance_cases(id) ON DELETE SET NULL,
  rule_name     TEXT        NOT NULL,
  rule_version  TEXT        NOT NULL,
  outcome       TEXT        NOT NULL CHECK (outcome IN ('PASS','FAIL','REVIEW')),
  evidence_hash TEXT        NOT NULL,   -- SHA-256 of evidence JSON (not PII)
  evaluated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aml_student   ON aml_policy_log(student_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_aml_outcome   ON aml_policy_log(rule_name, outcome);
CREATE INDEX IF NOT EXISTS idx_aml_non_pass  ON aml_policy_log(outcome, evaluated_at DESC)
  WHERE outcome != 'PASS';

COMMENT ON TABLE aml_policy_log IS
  'Immutable record of every AML/KYC policy rule evaluation.
   evidence_hash allows auditors to verify the input data without exposing PII.
   Regulators use this to confirm the platform ran required checks.';

-- =============================================================================
-- 3. Landlord network — the distribution solution
-- =============================================================================

CREATE TABLE IF NOT EXISTS landlord_network (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_profile_id    UUID        REFERENCES landlord_profiles(id) ON DELETE CASCADE,
  -- Network tiers determine what marketing and support they receive
  network_tier           TEXT        NOT NULL DEFAULT 'STANDARD'
                         CHECK (network_tier IN ('STANDARD','PREFERRED','PARTNER')),
  -- Aggregated metrics (updated by cron)
  total_applications     INT         NOT NULL DEFAULT 0,
  accepted_applications  INT         NOT NULL DEFAULT 0,
  avg_decision_seconds   INT,           -- median time to accept/decline
  -- Properties managed
  property_count         INT         NOT NULL DEFAULT 0,
  cities_served          TEXT[],        -- e.g. {'Boston', 'Cambridge'}
  -- Referral
  referral_code          TEXT        UNIQUE,   -- landlord's referral code
  referred_by            UUID        REFERENCES landlord_network(id),
  referred_count         INT         NOT NULL DEFAULT 0,
  -- Onboarding
  onboarding_completed   BOOLEAN     NOT NULL DEFAULT FALSE,
  orientation_watched_at TIMESTAMPTZ,
  first_acceptance_at    TIMESTAMPTZ,
  joined_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_network_tier    ON landlord_network(network_tier);
CREATE INDEX IF NOT EXISTS idx_network_ref     ON landlord_network(referred_by);
CREATE INDEX IF NOT EXISTS idx_network_cities  ON landlord_network USING GIN (cities_served);

DROP TRIGGER IF EXISTS trg_network_updated_at ON landlord_network;
CREATE TRIGGER trg_network_updated_at
  BEFORE UPDATE ON landlord_network
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMENT ON TABLE landlord_network IS
  'Landlord network membership and tier tracking.
   PREFERRED landlords receive: priority matching, co-marketing, compliance support.
   PARTNER landlords receive: dedicated account manager, bulk pricing, API access.
   Referral tracking drives viral growth.';

-- =============================================================================
-- 4. Social proof events — track acceptance rates for credibility
-- =============================================================================

CREATE TABLE IF NOT EXISTS trust_signal_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT        NOT NULL
                  CHECK (event_type IN (
                    'CERTIFICATE_ACCEPTED',    -- landlord accepted a cert
                    'LANDLORD_TESTIMONIAL',    -- landlord submitted a review
                    'REPEAT_ACCEPTANCE',       -- landlord accepted 2+ students
                    'PARTNER_ENDORSEMENT',     -- partner property manager endorsed
                    'UNIVERSITY_INTEGRATION'   -- university added Vecta to portal
                  )),
  landlord_id     UUID        REFERENCES landlord_network(id),
  student_id      UUID        REFERENCES students(id) ON DELETE SET NULL,
  cert_id         TEXT        REFERENCES tenant_trust_certificates(cert_id),
  university_name TEXT,
  city            TEXT,
  state           TEXT,
  metadata        JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tse_type     ON trust_signal_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tse_landlord ON trust_signal_events(landlord_id);
CREATE INDEX IF NOT EXISTS idx_tse_city     ON trust_signal_events(city, state);

COMMENT ON TABLE trust_signal_events IS
  'Social proof events. Used to:
   1. Display acceptance rate stats on the landlord portal ("847 landlords accepted")
   2. Target outreach to cities with high acceptance density
   3. Prove market traction to regulators and investors';

COMMIT;

-- =============================================================================
-- 5. Liability ledger — every compliance decision + who owned it
-- =============================================================================

CREATE TABLE IF NOT EXISTS liability_ledger (
  event_id         TEXT        PRIMARY KEY,
  sop_id           TEXT        NOT NULL,       -- e.g. 'SOP-KYC-001'
  sop_version      TEXT        NOT NULL,       -- semver — pinned to policy doc version
  student_id       UUID        REFERENCES students(id) ON DELETE SET NULL,
  decision_made_by TEXT        NOT NULL,       -- VECTA | UNIT_CO | PLAID | etc.
  decision_type    TEXT        NOT NULL,       -- OFAC_SCREEN | KYC_APPROVE | CTR_FILE
  outcome          TEXT        NOT NULL,       -- CLEAR | BLOCK | REVIEW | PASS | FAIL
  delegated_from   TEXT,                      -- if Vecta acting under Unit.co delegation
  evidence_hash    TEXT        NOT NULL,       -- SHA-256 of inputs (no PII stored)
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No UPDATE, no DELETE — append-only. This is the legal evidence trail.
CREATE RULE no_update_liability AS ON UPDATE TO liability_ledger DO INSTEAD NOTHING;
CREATE RULE no_delete_liability AS ON DELETE TO liability_ledger DO INSTEAD NOTHING;

CREATE INDEX IF NOT EXISTS idx_liability_student  ON liability_ledger(student_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_liability_sop      ON liability_ledger(sop_id, outcome);
CREATE INDEX IF NOT EXISTS idx_liability_type     ON liability_ledger(decision_type, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_liability_outcome  ON liability_ledger(outcome, recorded_at DESC)
  WHERE outcome IN ('BLOCK','REVIEW');

COMMENT ON TABLE liability_ledger IS
  'Append-only legal defensibility record.
   Every compliance decision is recorded here with: who made it (decision_made_by),
   under which legal authority (delegated_from), which SOP version was in effect,
   and a hash of the decision inputs.
   Used to answer: "Who approved this KYC? Under which policy? Based on what data?"
   Immutable — no UPDATE or DELETE permitted at the DB layer.';

-- =============================================================================
-- 6. Regulatory reports (CTR / SAR drafts)
-- =============================================================================

CREATE TABLE IF NOT EXISTS regulatory_reports (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type            TEXT        NOT NULL CHECK (type IN ('CTR', 'SAR')),
  student_id      UUID        REFERENCES students(id) ON DELETE SET NULL,
  transaction_ref TEXT,
  payload         JSONB       NOT NULL,   -- pre-filled report shell (no PII beyond name)
  status          TEXT        NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT','SUBMITTED','FILED')),
  due_date        DATE        NOT NULL,
  submitted_at    TIMESTAMPTZ,
  filed_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reg_reports_due    ON regulatory_reports(due_date, status)
  WHERE status IN ('DRAFT','SUBMITTED');
CREATE INDEX IF NOT EXISTS idx_reg_reports_student ON regulatory_reports(student_id);

DROP TRIGGER IF EXISTS trg_reg_updated_at ON regulatory_reports;
CREATE TRIGGER trg_reg_updated_at
  BEFORE UPDATE ON regulatory_reports
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMENT ON TABLE regulatory_reports IS
  'CTR and SAR drafts. Due dates enforced:
   CTR: 15 calendar days from transaction (BSA).
   SAR: 30 calendar days from detection.
   DRAFT → ops team reviews → SUBMITTED → FinCEN acknowledges → FILED.
   A cron job alerts the compliance team when due_date < NOW() + 3 days.';

-- =============================================================================
-- 7. Liquidity pool — forced first liquidity for cold-start
-- =============================================================================

CREATE TABLE IF NOT EXISTS liquidity_pool (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_type          TEXT        NOT NULL
                     CHECK (pool_type IN (
                       'GUARANTEED_RENT',    -- Vecta guarantees rent directly
                       'UNIVERSITY_BACKED',  -- university provides guarantee fund
                       'CORPORATE_PARTNER'   -- corporate housing partner covers first month
                     )),
  sponsor_name       TEXT        NOT NULL,
  sponsor_type       TEXT        NOT NULL CHECK (sponsor_type IN ('VECTA','UNIVERSITY','CORPORATE')),
  total_capacity_usd NUMERIC(12,2) NOT NULL,
  deployed_usd       NUMERIC(12,2) NOT NULL DEFAULT 0,
  reserve_ratio      NUMERIC(4,3) NOT NULL DEFAULT 0.200,  -- 20% held in reserve
  target_city        TEXT,
  target_university  TEXT,
  active             BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS liquidity_allocations (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id            UUID        NOT NULL REFERENCES liquidity_pool(id),
  student_id         UUID        NOT NULL REFERENCES students(id),
  lease_application_id UUID      REFERENCES lease_applications(id),
  allocated_usd      NUMERIC(10,2) NOT NULL,
  months_covered     SMALLINT    NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('ACTIVE','REPAID','DEFAULTED','CANCELLED')),
  allocated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_liq_pool_city ON liquidity_pool(target_city, active);
CREATE INDEX IF NOT EXISTS idx_liq_alloc_student ON liquidity_allocations(student_id, status);

COMMENT ON TABLE liquidity_pool IS
  'Forced first liquidity pools that break the cold-start deadlock.
   GUARANTEED_RENT: Vecta covers first month, landlord sees zero risk.
   UNIVERSITY_BACKED: MIT Housing Office funds pool for MIT students.
   CORPORATE_PARTNER: Greystar, AvalonBay etc. pre-commit to accepting certificates.
   The pool reduces the landlord risk to zero for initial adoptions.';

-- =============================================================================
-- 8. Public anchor log — externally verifiable hash chain
-- =============================================================================

CREATE TABLE IF NOT EXISTS public_anchor_log (
  anchor_id       TEXT        PRIMARY KEY,
  cert_id         TEXT,
  chain_tip_hash  TEXT        NOT NULL,
  anchor_type     TEXT        NOT NULL CHECK (anchor_type IN ('CERTIFICATE','FLIGHT_RECORDER','GLOBAL_CHECKPOINT')),
  manifest_url    TEXT        NOT NULL,
  gist_line       INT,
  anchored_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only: these are public trust records
CREATE RULE no_update_public_anchors AS ON UPDATE TO public_anchor_log DO INSTEAD NOTHING;
CREATE RULE no_delete_public_anchors AS ON DELETE TO public_anchor_log DO INSTEAD NOTHING;

CREATE INDEX IF NOT EXISTS idx_anchors_type ON public_anchor_log(anchor_type, anchored_at DESC);
CREATE INDEX IF NOT EXISTS idx_anchors_cert ON public_anchor_log(cert_id) WHERE cert_id IS NOT NULL;

COMMENT ON TABLE public_anchor_log IS
  'Public record of all trust chain anchors. Feeds /.well-known/vecta-anchors.json.
   Mirrored to S3 public bucket and GitHub gist for external verifiability.
   Anyone can verify a certificate chain without contacting Vecta.';
