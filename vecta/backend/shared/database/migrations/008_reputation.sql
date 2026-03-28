-- Reputation events — every verifiable positive action
CREATE TABLE IF NOT EXISTS reputation_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  event_type      TEXT        NOT NULL CHECK (event_type IN (
    'RENT_PAYMENT_ONTIME',
    'RENT_PAYMENT_LATE',
    'LEASE_COMPLETED',
    'IDENTITY_VERIFIED',
    'BANK_ACCOUNT_MAINTAINED',
    'INSURANCE_MAINTAINED',
    'VISA_RENEWED',
    'UNIVERSITY_ENROLLED',
    'ESIM_ACTIVE',
    'REFERRAL_PLACED'
  )),
  verified_by     TEXT        NOT NULL,
  amount_cents    BIGINT,
  landlord_id     UUID        REFERENCES landlord_profiles(id),
  property_addr   TEXT,
  metadata        JSONB       NOT NULL DEFAULT '{}',
  event_date      DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP RULE IF EXISTS no_update_reputation ON reputation_events;
DROP RULE IF EXISTS no_delete_reputation ON reputation_events;
CREATE RULE no_update_reputation AS ON UPDATE TO reputation_events DO INSTEAD NOTHING;
CREATE RULE no_delete_reputation AS ON DELETE TO reputation_events DO INSTEAD NOTHING;

CREATE TABLE IF NOT EXISTS reputation_scores (
  student_id          UUID        PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  score               INT         NOT NULL DEFAULT 300 CHECK (score BETWEEN 300 AND 850),
  on_time_payments    INT         NOT NULL DEFAULT 0,
  total_payments      INT         NOT NULL DEFAULT 0,
  repayment_rate      NUMERIC(4,3) NOT NULL DEFAULT 0,
  months_of_history   INT         NOT NULL DEFAULT 0,
  tier                TEXT        NOT NULL DEFAULT 'BUILDING',
  last_calculated     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  anchor_hash         TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reputation_anchors (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  anchor_date      DATE        NOT NULL UNIQUE DEFAULT CURRENT_DATE,
  student_count    INT         NOT NULL,
  scores_hash      TEXT        NOT NULL,
  github_gist_line INT,
  s3_url           TEXT,
  anchored_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP RULE IF EXISTS no_update_anchors ON reputation_anchors;
DROP RULE IF EXISTS no_delete_anchors ON reputation_anchors;
CREATE RULE no_update_anchors AS ON UPDATE TO reputation_anchors DO INSTEAD NOTHING;
CREATE RULE no_delete_anchors AS ON DELETE TO reputation_anchors DO INSTEAD NOTHING;

CREATE INDEX IF NOT EXISTS idx_reputation_events_student ON reputation_events (student_id);
