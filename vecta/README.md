# Vecta Platform — Life-as-a-Service for F-1 International Students

> Full-stack monorepo for the Vecta platform. Turborepo · TypeScript · Python · React Native · Next.js

---

## Overview

Vecta solves the "Day 0 problem" for F-1 international students — arriving in the US with no credit history, no Social Security Number, and no US banking. The platform provides:

| Module | What it does |
|--------|-------------|
| **Identity** | NFC passport chip verification via Didit — RS256 Vecta ID token |
| **Banking** | US DDA bank account + debit card via Unit.co — no SSN required |
| **Connectivity** | Instant US eSIM provisioning via eSIM Go — activates on landing |
| **Housing Guarantee** | Plaid solvency check → Letter of Credit PDF — no co-signer needed |
| **International Credit** | Nova Credit translates home-country history to 300–850 US score |
| **AI Roommate Finder** | OpenAI embeddings + pgvector cosine similarity matching |
| **Mobility / Fleet** | Vehicle lease-back program with F-1 Schedule E compliance |
| **Insurance** | Renters + auto insurance via Lemonade — no US history required |

---

## Architecture

```
vecta/
├── apps/
│   ├── student-app/          # React Native (Expo) — iOS/Android
│   ├── landlord-portal/      # Next.js — landlord identity verification
│   ├── api-gateway/          # Node.js (Express) — unified API entry point
│   └── compliance-ai/        # Python (FastAPI) — Claude Vision + pgvector
├── packages/
│   ├── types/                # Zod schemas + TypeScript interfaces (shared)
│   ├── auth/                 # RBAC + Express JWT middleware
│   ├── crypto/               # AES-256-GCM field encryption + HMAC
│   ├── logger/               # Structured pino logger with PII redaction
│   ├── database/             # pg Pool + typed helpers + migrations
│   └── storage/              # S3 wrapper (selfies, LoC PDFs, audit exports)
├── services/
│   ├── identity-service/     # Didit NFC + Unit.co BaaS
│   ├── banking-service/      # Plaid solvency + Letter of Credit
│   ├── housing-service/      # Connectivity (eSIM) + Nova Credit + LoC PDF
│   ├── mobility-service/     # Flight Recorder + DSO memo + F-1 compliance
│   └── audit-service/        # Append-only hash-chain audit log (USCIS/IRS)
└── docker-compose.yml
```

---

## F-1 Visa Compliance Architecture

The platform enforces F-1 compliance at **four independent layers**:

### 1. Database constraints (hardest to bypass)
```sql
-- In flight_recorder:
CONSTRAINT chk_driver_ne_lessor CHECK (driver_user_id != lessor_student_id)

-- Append-only rules (immutable audit chain):
CREATE RULE no_update_flight_recorder AS ON UPDATE TO flight_recorder DO INSTEAD NOTHING;
CREATE RULE no_delete_flight_recorder AS ON DELETE TO flight_recorder DO INSTEAD NOTHING;
```

### 2. RBAC dead-end routes
```typescript
// packages/auth/src/rbac.ts
PERMISSION_MAP['mobility:accept_ride']     = [];  // Empty = no role can do this
PERMISSION_MAP['mobility:go_online_as_driver'] = [];
```

### 3. Runtime validation (ScheduleEValidator)
Before every ride log:
```typescript
if (lease.lessorStudentId === driverUserId) throw F1ComplianceError
```

### 4. Cryptographic audit chain
Each `flight_recorder` entry includes `SHA-256(previousHash + rideData + pepper)` — tampering breaks the chain, detected before USCIS/IRS export.

---

## Privacy Architecture (Fair Housing Act)

Fields that are **always vaulted** (AES-256-GCM encrypted, never in JWTs, never in landlord views):

- `country_of_origin` — nationality from passport
- `passport_number` — used only for Didit + Unit.co API calls
- `bank_account_numbers` — exact balance never exposed; only guarantee statement
- `imei` — used for eSIM provisioning only, excluded from all logs
- `home_address`, `tax_id` — never collected

---

## Quick Start

### Prerequisites
- Node.js ≥ 20
- Python 3.12
- Docker + Docker Compose
- npm 10+ (see `packageManager` in root `package.json`)

### 1. Clone and install
```bash
git clone https://github.com/vecta-io/vecta.git
cd vecta
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Fill in API keys for: Didit, Unit.co, Plaid, Nova Credit, eSIM Go, Lemonade, OpenAI, Anthropic
# Generate RSA keypair for JWT:
openssl genrsa -out private.pem 4096
openssl rsa -in private.pem -pubout -out public.pem
```

### 3. Start infrastructure
```bash
docker compose up -d postgres redis
```

### 4. Run migrations
```bash
npm run db:migrate
```

### 5. Start all services
```bash
npm run dev
```

Services start at:
| Service | URL |
|---------|-----|
| API Gateway | http://localhost:4000 |
| Compliance AI | http://localhost:8000 |
| Landlord Portal | http://localhost:3000 |
| Student App (Expo) | http://localhost:8081 |

---

## Key Integrations

| Service | Purpose | Docs |
|---------|---------|------|
| [Didit](https://didit.me) | NFC passport + liveness | docs.didit.me |
| [Unit.co](https://unit.co) | US banking (DDA + debit) | docs.unit.co |
| [Plaid](https://plaid.com) | Bank solvency + asset reports | plaid.com/docs |
| [Nova Credit](https://novacredit.com) | International credit translation | docs.novacredit.com |
| [eSIM Go](https://esim.com) | US eSIM provisioning | docs.esim-go.com |
| [Lemonade](https://lemonade.com) | Renters + auto insurance | developers.lemonade.com |
| [OpenAI](https://openai.com) | `text-embedding-ada-002` for roommate matching | platform.openai.com |
| [Anthropic](https://anthropic.com) | Claude Vision for insurance PDF analysis | docs.anthropic.com |

---

## Tax Classification (IRS Schedule E)

The mobility module is engineered specifically around **passive rental income** classification:

- Income → `1099-MISC Box 1: Rents` (NOT `1099-NEC`)
- Classification → `Schedule E` (NOT `Schedule C`)
- This distinction preserves F-1 student status (students cannot earn active income)
- The DSO Compliance Memo explains this to Designated School Officials
- Four consent clauses required before enrollment (see `enroll.tsx`)

---

## Deployment (Vercel + Render)

See [docs/DEPLOY_VERCEL_RENDER.md](docs/DEPLOY_VERCEL_RENDER.md) for landlord portal on **Vercel**, API + Compliance AI + Redis on **Render** (`render.yaml` blueprint), and optional **Supabase** for Postgres + **pgvector**.

---

## Development Notes

- All PII fields use `encryptField()` from `@vecta/crypto` before DB insert
- Selfie URLs are **never cached** — fetched fresh (15-min signed S3 URLs) on each page load
- IMEI is passed directly to eSIM Go API and **never stored**
- The `flight_recorder` table has PostgreSQL `RULE` objects that make it append-only at the DB level
- Redis stores JWT revocation set — checked on every authenticated request

---

## License

Proprietary. © 2025 Vecta ( Fastflyrr LLC) . All rights reserved.
