-- =============================================================================
-- 016_scheduled_rides.sql — Scheduled rides, driver referrals, offer config
-- =============================================================================

ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_scheduled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS scheduled_no_driver_notified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_rides_scheduled
  ON rides (scheduled_for, status)
  WHERE is_scheduled = TRUE AND status = 'REQUESTED';

ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS referred_by_invite_code TEXT;

CREATE TABLE IF NOT EXISTS referral_offer_config (
  key        TEXT PRIMARY KEY,
  value_int  INT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO referral_offer_config (key, value_int)
VALUES
  ('driver_referral_referrer_cents', 1000),
  ('driver_referral_referee_cents', 1000)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS driver_referrals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_student_id   UUID NOT NULL REFERENCES students (id),
  referee_student_id    UUID REFERENCES students (id),
  referee_email         TEXT NOT NULL,
  invite_code           TEXT NOT NULL UNIQUE
                          DEFAULT UPPER (SUBSTRING (gen_random_uuid()::TEXT, 1, 8)),
  status                TEXT NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN (
                            'PENDING',
                            'SIGNED_UP',
                            'COMPLETED',
                            'CREDITED'
                          )),
  referrer_credited_at  TIMESTAMPTZ,
  referee_credited_at   TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_referrals_referrer
  ON driver_referrals (referrer_student_id, created_at DESC);
