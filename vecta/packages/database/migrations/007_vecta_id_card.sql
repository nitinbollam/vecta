-- =============================================================================
-- Migration 007: Vecta ID Card fields and verification log
-- =============================================================================

-- Add ID card columns to students table
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS vecta_id_number    TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS id_card_pdf_url    TEXT,
  ADD COLUMN IF NOT EXISTS id_card_front_url  TEXT,
  ADD COLUMN IF NOT EXISTS id_card_back_url   TEXT,
  ADD COLUMN IF NOT EXISTS id_card_issued_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS id_card_expires_at TIMESTAMPTZ;

-- Index on vecta_id_number for fast public lookups
CREATE INDEX IF NOT EXISTS idx_students_vecta_id_number
  ON students(vecta_id_number)
  WHERE vecta_id_number IS NOT NULL;

-- =============================================================================
-- Vecta ID verification log (public verify endpoint audit trail)
-- =============================================================================

CREATE TABLE IF NOT EXISTS vecta_id_verifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  vecta_id_number TEXT NOT NULL,
  verified_by_ip  INET,
  verified_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result          TEXT NOT NULL CHECK (result IN ('VALID', 'EXPIRED', 'REVOKED')),
  user_agent      TEXT
);

-- Index for audit queries
CREATE INDEX IF NOT EXISTS idx_vecta_id_verifications_student
  ON vecta_id_verifications(student_id);

CREATE INDEX IF NOT EXISTS idx_vecta_id_verifications_number
  ON vecta_id_verifications(vecta_id_number);
