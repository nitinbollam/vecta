-- Persist full signed certificate JSON for W3C VC export and reputation wrapping.
ALTER TABLE tenant_trust_certificates
  ADD COLUMN IF NOT EXISTS certificate_json JSONB;
