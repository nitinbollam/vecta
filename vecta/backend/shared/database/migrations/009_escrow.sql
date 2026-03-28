CREATE TABLE IF NOT EXISTS escrow_accounts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        UUID        NOT NULL REFERENCES students(id),
  landlord_id       UUID        REFERENCES landlord_profiles(id),
  lease_app_id      UUID        REFERENCES lease_applications(id),
  amount_cents      BIGINT      NOT NULL CHECK (amount_cents > 0),
  currency          TEXT        NOT NULL DEFAULT 'USD',
  purpose           TEXT        NOT NULL DEFAULT 'FIRST_MONTH_RENT',
  status            TEXT        NOT NULL DEFAULT 'HELD'
                    CHECK (status IN ('HELD','RELEASED','REFUNDED','DISPUTED')),
  release_condition TEXT        NOT NULL,
  release_date      DATE,
  held_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at       TIMESTAMPTZ,
  released_to       TEXT,
  release_note      TEXT
);

DROP RULE IF EXISTS no_delete_escrow ON escrow_accounts;
CREATE RULE no_delete_escrow AS ON DELETE TO escrow_accounts DO INSTEAD NOTHING;

CREATE INDEX IF NOT EXISTS idx_escrow_student ON escrow_accounts (student_id);
CREATE INDEX IF NOT EXISTS idx_escrow_status ON escrow_accounts (status);
