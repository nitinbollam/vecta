# Vecta Production Deployment Guide

## Pre-Deployment Checklist

### Secrets & Keys
- [ ] Generate RSA-4096 keypair: `openssl genrsa -out private.pem 4096 && openssl rsa -in private.pem -pubout -out public.pem`
- [ ] Store private key in AWS Secrets Manager or HashiCorp Vault — **never in environment variables**
- [ ] Set `VECTA_FIELD_ENCRYPTION_KEY` to a 48-char random base64 string: `openssl rand -base64 48`
- [ ] Set `VECTA_HMAC_SECRET` to a 64-char random string: `openssl rand -base64 64`
- [ ] Set `INTERNAL_SERVICE_SECRET` — shared secret for service-to-service HMAC auth
- [ ] Set all integration API keys (Didit, Unit.co, Plaid, Nova Credit, eSIM Go, Lemonade, OpenAI, Anthropic)

### Database
- [ ] Run migration 001: `psql $DATABASE_URL -f packages/database/migrations/001_initial_schema.sql`
- [ ] Run migration 002: `psql $DATABASE_URL -f packages/database/migrations/002_plaid_connections.sql`
- [ ] Verify pgvector extension: `psql $DATABASE_URL -c "SELECT extname FROM pg_extension WHERE extname='vector'"`
- [ ] Verify append-only rules on `flight_recorder`: `psql $DATABASE_URL -c "\d+ flight_recorder"`
- [ ] Enable SSL: set `DATABASE_URL` with `?sslmode=require`
- [ ] Set up automated backups (RDS: enable automated backups, 35-day retention)

### S3 Buckets
- [ ] Create three buckets: `vecta-identity`, `vecta-housing`, `vecta-compliance`
- [ ] Enable SSE-KMS on all buckets
- [ ] Block all public access on all buckets
- [ ] Enable versioning on `vecta-compliance` (audit exports)
- [ ] Set lifecycle rules: identity (90 days → Glacier), compliance (7 years → Glacier Deep Archive)

### Redis
- [ ] Enable Redis AUTH: set `requirepass` in redis.conf
- [ ] Enable TLS: `tls-port 6380`, `tls-cert-file`, `tls-key-file`
- [ ] Set `maxmemory-policy allkeys-lru` to prevent OOM

### Service Configuration
- [ ] Set `NODE_ENV=production` on all Node.js services
- [ ] Set `LOG_LEVEL=info` (not `debug` in production — reduces PII exposure in logs)
- [ ] Set `CORS_ORIGINS` to production domain only (no `localhost`)
- [ ] Set `VERIFICATION_BASE_URL=https://verify.vecta.io`

---

## Infrastructure Layout (AWS)

```
                    ┌─────────────────────────────────┐
                    │          CloudFront CDN           │
                    │   landlord-portal.vecta.io        │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │         ALB (HTTPS only)         │
                    └──────┬──────────────┬───────────┘
                           │              │
             ┌─────────────▼──┐  ┌───────▼──────────┐
             │ Landlord Portal│  │   API Gateway     │
             │   (Next.js)    │  │   (Express)       │
             │  ECS Fargate   │  │  ECS Fargate      │
             └────────────────┘  └──────┬────────────┘
                                        │  (internal VPC only)
                    ┌───────────────────┼──────────────────┐
                    │                   │                   │
          ┌─────────▼──┐  ┌────────────▼──┐  ┌────────────▼──┐
          │ Identity   │  │  Banking      │  │  Mobility     │
          │ Service    │  │  Service      │  │  Service      │
          │ :4001      │  │  :4002        │  │  :4004        │
          └─────────┬──┘  └─────────┬────┘  └─────────┬────┘
                    │               │                  │
          ┌─────────▼───────────────▼──────────────────▼───┐
          │              RDS PostgreSQL (pgvector)          │
          │              ElastiCache Redis                  │
          │              S3 (3 buckets)                     │
          └────────────────────────────────────────────────┘
```

---

## Zero-Downtime Deployment

```bash
# Build all images
docker buildx build --platform linux/amd64 \
  -f apps/api-gateway/Dockerfile \
  -t $ECR_REGISTRY/vecta/api-gateway:$VERSION \
  --push .

# ECS rolling update (no downtime)
aws ecs update-service \
  --cluster vecta-prod \
  --service api-gateway \
  --force-new-deployment

# Verify health
aws ecs wait services-stable \
  --cluster vecta-prod \
  --services api-gateway
```

---

## Secrets Rotation Procedure

### Quarterly: Encryption Key Rotation

```bash
# 1. Generate new key
NEW_KEY=$(openssl rand -base64 48)

# 2. Run re-encryption migration (reads with old key, writes with new key)
VECTA_FIELD_ENCRYPTION_KEY_OLD=$OLD_KEY \
VECTA_FIELD_ENCRYPTION_KEY=$NEW_KEY \
  node scripts/rotate-encryption-key.js

# 3. Update Secrets Manager
aws secretsmanager put-secret-value \
  --secret-id vecta/prod/field-encryption-key \
  --secret-string "$NEW_KEY"

# 4. Restart all services (pick up new key)
aws ecs update-service --cluster vecta-prod --service identity-service --force-new-deployment
# ... repeat for all services
```

### On Breach: JWT Keypair Rotation

```bash
# 1. Generate new RSA keypair
openssl genrsa -out private_new.pem 4096
openssl rsa -in private_new.pem -pubout -out public_new.pem

# 2. Revoke ALL existing tokens (nuclear option — all users re-auth)
redis-cli FLUSHDB  # Clears revocation set + all caches

# 3. Update key in Secrets Manager
aws secretsmanager put-secret-value \
  --secret-id vecta/prod/jwt-private-key \
  --secret-string "$(cat private_new.pem)"

# 4. Deploy new public key to all verifying services
# 5. Shred old private key
shred -vzu private_old.pem
```

---

## Monitoring & Alerting

### Critical Alerts (PagerDuty — immediate)
| Alert | Threshold | Meaning |
|-------|-----------|---------|
| `F1_VISA_COMPLIANCE_VIOLATION` log line | Any occurrence | Attempted compliance bypass |
| `CHAIN_INTEGRITY_FAILED` error | Any occurrence | Flight recorder tampered |
| `TOKEN_REVOKED` rate > 100/min | > 100/min | Possible credential compromise |
| Database `flight_recorder` UPDATE/DELETE rule fires | Any occurrence | Tampering attempt |

### Warning Alerts (Slack — business hours)
| Alert | Threshold |
|-------|-----------|
| Didit webhook HMAC failures | > 5/min |
| KYC rejection rate | > 20% over 1 hour |
| LoC generation failures | > 10% |
| Redis connection errors in production | Any occurrence |

### Dashboards
- Compliance Audit Stream: `GET /stream` on audit-service (SSE) → Grafana dashboard
- KYC funnel: Didit sessions → APPROVED rate by university
- Fleet enrollment: STUDENT → LESSOR conversion rate
- LoC generation: Plaid connection success → LoC generated

---

## USCIS / IRS Audit Response Procedure

If USCIS or IRS requests records for a student:

```bash
# 1. Export flight recorder audit chain (cryptographically verified)
curl -X GET \
  -H "x-internal-signature: $SIG" \
  -H "x-timestamp: $TS" \
  "https://api-internal.vecta.io/mobility/audit/chain?studentId=$STUDENT_ID&year=$TAX_YEAR" \
  > audit_chain_${STUDENT_ID}_${TAX_YEAR}.json

# 2. Verify chain integrity before submission
node scripts/verify-chain.js audit_chain_${STUDENT_ID}_${TAX_YEAR}.json

# 3. Generate DSO compliance memo
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"studentId": "$STUDENT_ID"}' \
  "https://api-internal.vecta.io/mobility/dso-memo/generate"

# 4. Export audit events from audit-service
curl -X GET \
  "https://api-internal.vecta.io/events?actorId=$STUDENT_ID&from=2024-01-01" \
  > audit_events_${STUDENT_ID}.json
```

All exports are HMAC-signed and include the genesis hash for independent verification.
