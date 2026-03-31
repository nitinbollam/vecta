-- 014_revenue.sql — Platform revenue ledger account, subscriptions, revenue events, payouts
-- Vecta Ledger only — no third-party money APIs in schema.

-- Allow platform / system ledger accounts without a student
ALTER TABLE ledger_accounts
  ALTER COLUMN student_id DROP NOT NULL;

ALTER TABLE ledger_accounts DROP CONSTRAINT IF EXISTS ledger_accounts_account_type_check;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_account_type_check
  CHECK (account_type IN ('CHECKING', 'SAVINGS', 'PLATFORM_REVENUE'));

-- Platform account can go negative on refunds (ops makes whole); student accounts still enforced
CREATE OR REPLACE FUNCTION check_balance_non_negative()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.account_id = '00000000-0000-0000-0000-000000000001'::uuid THEN
    RETURN NEW;
  END IF;
  IF NEW.balance_after_cents < 0 THEN
    RAISE EXCEPTION
      'INSUFFICIENT_FUNDS: account % would have negative balance of %',
      NEW.account_id, NEW.balance_after_cents;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

INSERT INTO ledger_accounts (
  id, student_id, account_number, routing_number,
  account_type, status, currency
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  NULL,
  'VECTA-PLATFORM-REVENUE',
  '021000021',
  'PLATFORM_REVENUE',
  'ACTIVE',
  'USD'
) ON CONFLICT (id) DO NOTHING;

-- TNC commercial auto policies (driver rides)
ALTER TABLE insurance_policies DROP CONSTRAINT IF EXISTS insurance_policies_policy_type_check;
ALTER TABLE insurance_policies ADD CONSTRAINT insurance_policies_policy_type_check
  CHECK (policy_type IN ('RENTERS', 'AUTO', 'HEALTH', 'AUTO_TNC'));

ALTER TABLE insurance_quotes DROP CONSTRAINT IF EXISTS insurance_quotes_policy_type_check;
ALTER TABLE insurance_quotes ADD CONSTRAINT insurance_quotes_policy_type_check
  CHECK (policy_type IN ('RENTERS', 'AUTO', 'HEALTH', 'AUTO_TNC'));

-- Driver TNC policy linkage (Vecta MGA / Boost paper carrier)
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS tnc_policy_id UUID REFERENCES insurance_policies(id),
  ADD COLUMN IF NOT EXISTS tnc_policy_number TEXT,
  ADD COLUMN IF NOT EXISTS tnc_policy_status TEXT NOT NULL DEFAULT 'PENDING';

-- Personal insurance proof optional (TNC coverage is primary for rides)
ALTER TABLE driver_profiles
  ALTER COLUMN insurance_doc_url DROP NOT NULL,
  ALTER COLUMN insurance_expiry DROP NOT NULL;

CREATE TABLE subscription_plans (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  price_cents  INT NOT NULL,
  interval     TEXT NOT NULL CHECK (interval IN ('MONTHLY','ANNUAL')),
  features     JSONB NOT NULL DEFAULT '[]',
  active       BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO subscription_plans (id, name, description, price_cents, interval, features, active) VALUES
  ('student_basic',   'Vecta Basic',    'Identity + eSIM + Rides',              0,    'MONTHLY', '["identity","esim","rides"]'::jsonb, TRUE),
  ('student_pro',     'Vecta Pro',      'Basic + Housing Guarantee + Insurance', 1999, 'MONTHLY', '["identity","esim","rides","housing","insurance"]'::jsonb, TRUE),
  ('student_annual',  'Vecta Annual',   'Pro plan billed annually',              19999,'ANNUAL',  '["identity","esim","rides","housing","insurance"]'::jsonb, TRUE),
  ('landlord_basic',  'Landlord Basic', 'Verify tenants',                        0,    'MONTHLY', '["verify"]'::jsonb, TRUE),
  ('landlord_pro',    'Landlord Pro',   'Verify + LoC + Background checks',      2900, 'MONTHLY', '["verify","loc","background"]'::jsonb, TRUE)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE student_subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        UUID NOT NULL REFERENCES students(id),
  plan_id           TEXT NOT NULL REFERENCES subscription_plans(id),
  status            TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE','CANCELLED','PAST_DUE','TRIALING')),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  trial_ends_at     TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
  cancelled_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE landlord_subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id       UUID NOT NULL REFERENCES landlord_profiles(id),
  plan_id           TEXT NOT NULL REFERENCES subscription_plans(id),
  status            TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE','CANCELLED','PAST_DUE','TRIALING')),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  cancelled_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE revenue_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT NOT NULL CHECK (event_type IN (
                    'RIDE_PLATFORM_FEE',
                    'SUBSCRIPTION_CHARGE',
                    'LOC_GENERATION_FEE',
                    'INSURANCE_PREMIUM_MARGIN',
                    'ESIM_MARGIN',
                    'FLEET_MANAGEMENT_FEE',
                    'BANKING_INTERCHANGE'
                  )),
  student_id      UUID REFERENCES students(id),
  landlord_id     UUID REFERENCES landlord_profiles(id),
  ride_id         UUID REFERENCES rides(id),
  amount_cents    INT NOT NULL,
  description     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE RULE no_delete_revenue AS ON DELETE TO revenue_events DO INSTEAD NOTHING;
CREATE RULE no_update_revenue AS ON UPDATE TO revenue_events DO INSTEAD NOTHING;

CREATE TABLE driver_payout_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       UUID NOT NULL REFERENCES driver_profiles(id),
  amount_cents    INT NOT NULL,
  method          TEXT NOT NULL DEFAULT 'ACH'
                    CHECK (method IN ('ACH','INSTANT')),
  status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED')),
  column_ref      TEXT,
  initiated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  failure_reason  TEXT
);
