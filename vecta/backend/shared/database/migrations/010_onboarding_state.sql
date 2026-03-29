-- 010_onboarding_state.sql — explicit onboarding progress + failure tracking
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS onboarding_step   TEXT DEFAULT 'EMAIL_VERIFIED',
  ADD COLUMN IF NOT EXISTS onboarding_status TEXT DEFAULT 'IN_PROGRESS',
  ADD COLUMN IF NOT EXISTS onboarding_error  TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_students_onboarding_status ON students(onboarding_status);
