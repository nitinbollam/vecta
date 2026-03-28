# Vecta Secrets Rotation Procedure

## VECTA_FIELD_ENCRYPTION_KEY rotation

This key encrypts PII in the database (passport numbers, DOBs, nationalities). If compromised, all encrypted fields must be re-encrypted.

Rotation procedure:

1. Generate a new key: `openssl rand -hex 32`
2. Add `NEW_VECTA_FIELD_ENCRYPTION_KEY` to the environment (or follow your dual-key strategy in `@vecta/crypto` if implemented).
3. Run migration script: `npm run scripts:reencrypt-pii` (from the monorepo root).
4. Verify: run application health checks and spot-check decrypted fields in a secure environment.
5. Rename `NEW_VECTA_FIELD_ENCRYPTION_KEY` to `VECTA_FIELD_ENCRYPTION_KEY` (or swap active key in code).
6. Remove the old key from the environment.
7. Restart all services.

The script at `apps/api-gateway/scripts/reencrypt-pii.ts` reads encrypted columns, decrypts with the current key, and writes back with `encryptField` (assumes a single active key in env). Extend `@vecta/crypto` for true dual-key rotation if you need zero-downtime transitions.

## INTERNAL_SERVICE_SECRET rotation

1. Generate new: `openssl rand -hex 48`
2. Rolling restart: update env, restart services one at a time.
3. The internal request verifier allows a 5-minute timestamp skew; brief overlap of old and new secrets requires dual-verify middleware if you need hitless rotation (not implemented by default).

## VECTA_JWT_PRIVATE_KEY rotation

1. Generate new RS256 keypair:

   ```bash
   openssl genrsa -out private.pem 2048
   openssl rsa -in private.pem -pubout -out public.pem
   ```

2. Add new keys as `VECTA_JWT_PRIVATE_KEY_NEW` and `VECTA_JWT_PUBLIC_KEY_NEW`.
3. Update middleware to accept both old and new public keys temporarily.
4. Deploy: new tokens signed with the new key; old tokens remain valid until expiry.
5. Wait for old token TTL to expire (default 24h in student JWT config).
6. Remove old key support.
7. Rename `_NEW` variables to primary names.
