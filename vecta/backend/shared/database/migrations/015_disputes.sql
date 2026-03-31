-- 015_disputes.sql — Support tickets, refunds, account flags

ALTER TABLE students DROP CONSTRAINT IF EXISTS students_kyc_status_check;
ALTER TABLE students ADD CONSTRAINT students_kyc_status_check
  CHECK (kyc_status IN ('PENDING','IN_PROGRESS','APPROVED','REJECTED','NEEDS_REVIEW','SUSPENDED'));

CREATE TABLE support_tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number   TEXT NOT NULL UNIQUE DEFAULT (
                    'VT-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 8))
                  ),
  category        TEXT NOT NULL CHECK (category IN (
                    'RIDE_DISPUTE',
                    'PAYMENT_ISSUE',
                    'DRIVER_REPORT',
                    'RIDER_REPORT',
                    'LANDLORD_DISPUTE',
                    'ACCOUNT_ISSUE',
                    'IDENTITY_ISSUE',
                    'OTHER'
                  )),
  status          TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN (
                      'OPEN', 'IN_REVIEW', 'RESOLVED',
                      'REFUNDED', 'CLOSED', 'ESCALATED'
                    )),
  priority        TEXT NOT NULL DEFAULT 'NORMAL'
                    CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),

  filed_by_student_id   UUID REFERENCES students(id),
  filed_by_driver_id    UUID REFERENCES driver_profiles(id),
  filed_by_landlord_id  UUID REFERENCES landlord_profiles(id),

  ride_id         UUID REFERENCES rides(id),
  description     TEXT NOT NULL,
  evidence_urls   JSONB DEFAULT '[]',

  resolved_by     TEXT,
  resolution_note TEXT,
  refund_amount_cents INT,
  resolved_at     TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ticket_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES support_tickets(id),
  author_type TEXT NOT NULL CHECK (author_type IN ('STUDENT','DRIVER','LANDLORD','ADMIN')),
  author_id   TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE account_flags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID REFERENCES students(id),
  driver_id   UUID REFERENCES driver_profiles(id),
  flag_type   TEXT NOT NULL CHECK (flag_type IN (
                'WARNING', 'SUSPENDED', 'BANNED',
                'FRAUD_REVIEW', 'SAFETY_REVIEW'
              )),
  reason      TEXT NOT NULL,
  flagged_by  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE refunds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       UUID NOT NULL REFERENCES support_tickets(id),
  ride_id         UUID REFERENCES rides(id),
  student_id      UUID NOT NULL REFERENCES students(id),
  amount_cents    INT NOT NULL,
  reason          TEXT NOT NULL,
  approved_by     TEXT NOT NULL,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
