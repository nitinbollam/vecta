-- =============================================================================
-- 005_vecta_ledger.sql
-- Vecta Core Banking Ledger — replaces Unit.co
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Ledger accounts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id          UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  account_number      TEXT NOT NULL UNIQUE,
  routing_number      TEXT NOT NULL DEFAULT '021000021',  -- sponsor bank routing
  account_type        TEXT NOT NULL DEFAULT 'CHECKING'
                        CHECK (account_type IN ('CHECKING', 'SAVINGS')),
  status              TEXT NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'FROZEN', 'CLOSED')),
  currency            TEXT NOT NULL DEFAULT 'USD',
  sponsor_bank        TEXT NOT NULL DEFAULT 'column',     -- column | clearbank
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at           TIMESTAMPTZ
);

CREATE INDEX idx_ledger_accounts_student ON ledger_accounts(student_id);

-- ---------------------------------------------------------------------------
-- Double-entry ledger entries — append-only, no updates, no deletes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ledger_entries (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id       UUID NOT NULL,          -- links debit and credit sides
  account_id           UUID NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  entry_type           TEXT NOT NULL CHECK (entry_type IN ('DEBIT', 'CREDIT')),
  amount_cents         BIGINT NOT NULL CHECK (amount_cents > 0),
  currency             TEXT NOT NULL DEFAULT 'USD',
  balance_after_cents  BIGINT NOT NULL,         -- running balance after this entry
  description          TEXT NOT NULL,
  category             TEXT,                    -- RENT | FOOD | TRANSFER | FEE | ...
  merchant_name        TEXT,
  merchant_category    TEXT,
  status               TEXT NOT NULL DEFAULT 'POSTED'
                         CHECK (status IN ('PENDING', 'POSTED', 'REVERSED')),
  reversal_of          UUID REFERENCES ledger_entries(id),  -- for reversals
  value_date           DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ledger_entries_account   ON ledger_entries(account_id, created_at DESC);
CREATE INDEX idx_ledger_entries_txn       ON ledger_entries(transaction_id);
CREATE INDEX idx_ledger_entries_date      ON ledger_entries(value_date DESC);

-- Prevent negative balances at the database level
CREATE OR REPLACE FUNCTION check_balance_non_negative()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.balance_after_cents < 0 THEN
    RAISE EXCEPTION
      'INSUFFICIENT_FUNDS: account % would have negative balance of %',
      NEW.account_id, NEW.balance_after_cents;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_non_negative_balance
  BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION check_balance_non_negative();

-- Make ledger_entries append-only — no modifications to financial history
CREATE RULE no_update_ledger_entries AS
  ON UPDATE TO ledger_entries DO INSTEAD NOTHING;

CREATE RULE no_delete_ledger_entries AS
  ON DELETE TO ledger_entries DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- Virtual debit cards
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS virtual_cards (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID NOT NULL REFERENCES ledger_accounts(id),
  card_number_enc      TEXT NOT NULL,     -- AES-256-GCM encrypted PAN
  last_four            TEXT NOT NULL,     -- plaintext for display
  expiry_month         SMALLINT NOT NULL CHECK (expiry_month BETWEEN 1 AND 12),
  expiry_year          SMALLINT NOT NULL,
  cvv_enc              TEXT NOT NULL,     -- AES-256-GCM encrypted CVV
  network              TEXT NOT NULL DEFAULT 'VISA',
  status               TEXT NOT NULL DEFAULT 'ACTIVE'
                         CHECK (status IN ('ACTIVE', 'FROZEN', 'CANCELLED')),
  daily_limit_cents    BIGINT NOT NULL DEFAULT 50000,     -- $500
  monthly_limit_cents  BIGINT NOT NULL DEFAULT 500000,    -- $5,000
  bin_prefix           TEXT NOT NULL DEFAULT '453201',    -- sponsor bank BIN
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_virtual_cards_account ON virtual_cards(account_id)
  WHERE status != 'CANCELLED';  -- one active card per account

-- ---------------------------------------------------------------------------
-- ACH transfers (to/from sponsor bank)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ach_transfers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID NOT NULL REFERENCES ledger_accounts(id),
  direction            TEXT NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  amount_cents         BIGINT NOT NULL CHECK (amount_cents > 0),
  currency             TEXT NOT NULL DEFAULT 'USD',

  -- External bank details (account number encrypted)
  external_bank_name   TEXT NOT NULL,
  external_routing     TEXT NOT NULL,             -- plaintext (routing numbers are public)
  external_account_enc TEXT NOT NULL,             -- AES-256-GCM encrypted

  -- Processing
  status               TEXT NOT NULL DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING', 'PROCESSING', 'SETTLED', 'RETURNED', 'CANCELLED')),
  return_code          TEXT,                      -- NACHA return code if returned
  sponsor_bank_ref     TEXT,                      -- Column/Clearbank reference number
  description          TEXT NOT NULL DEFAULT 'ACH Transfer',

  initiated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_at        TIMESTAMPTZ,
  settled_at           TIMESTAMPTZ,
  returned_at          TIMESTAMPTZ
);

CREATE INDEX idx_ach_transfers_account ON ach_transfers(account_id, initiated_at DESC);
CREATE INDEX idx_ach_transfers_status  ON ach_transfers(status) WHERE status IN ('PENDING', 'PROCESSING');

-- ---------------------------------------------------------------------------
-- Ledger account snapshot view (materialized for performance)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW ledger_balances AS
  SELECT
    a.id            AS account_id,
    a.student_id,
    a.account_number,
    a.routing_number,
    a.currency,
    a.status        AS account_status,
    COALESCE(
      (SELECT balance_after_cents FROM ledger_entries
       WHERE account_id = a.id AND status = 'POSTED'
       ORDER BY created_at DESC LIMIT 1),
      0
    )               AS available_balance_cents,
    COALESCE(
      (SELECT SUM(amount_cents) FROM ledger_entries
       WHERE account_id = a.id AND entry_type = 'DEBIT' AND status = 'PENDING'),
      0
    )               AS pending_debit_cents
  FROM ledger_accounts a;

-- ---------------------------------------------------------------------------
-- Audit trigger: log every ledger entry creation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_ledger_entry()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_events (
    event_type, actor_id, resource_type, resource_id, metadata, created_at
  ) VALUES (
    'LEDGER_ENTRY_CREATED',
    NEW.account_id::TEXT,
    'ledger_entry',
    NEW.id::TEXT,
    jsonb_build_object(
      'entry_type',   NEW.entry_type,
      'amount_cents', NEW.amount_cents,
      'balance_after', NEW.balance_after_cents,
      'description',  NEW.description,
      'status',       NEW.status
    ),
    NOW()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entry_audit
  AFTER INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION audit_ledger_entry();
