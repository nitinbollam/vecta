# Vecta — Financial Embassy & Life-as-a-Service

Financial infrastructure for F-1 international students in the US: NFC identity, banking, housing trust, insurance (Vecta MGA + paper carrier), mobility, and compliance.

## Repository structure

```
frontend/
  student-app/       Expo / React Native — student mobile app
  driver-app/        Expo / React Native — driver app (fleet / rides)
  landlord-portal/   Next.js — landlord verification & portal

backend/
  api-gateway/       Express — public HTTP API, auth, routing to services
  services/
    identity-service/    KYC flows, email, push; legacy Lemonade orchestration where configured
    banking-service/     Vecta Ledger, Vecta Connect, Plaid fallback, LoC generation
    housing-service/     Vecta Credit Bridge (bureau + alternative scoring), eSIM, trust engine
    mobility-service/    Rides, fleet, driver onboarding, audit-friendly ride data
    compliance-service/  AML/OFAC surfaces, underwriting, insurance policy binding (uses @vecta/providers)
    audit-service/       Append-only audit chain
    compliance-ai/       Python — vision / embeddings (optional)
  shared/
    auth/          JWT, RBAC, signing, certificate protocol
    crypto/        Field encryption helpers
    database/      PostgreSQL pool, migrations under shared/database/migrations
    logger/        Pino logging, PII redaction
    providers/     Vendor adapters + registry (Vecta ID/Ledger/Connect/Bridge/MGA, fallbacks)
    storage/       S3 wrapper
    types/         Shared TypeScript types

infrastructure/
  docker/          docker-compose — local Postgres, Redis, etc.
  k8s/             Kubernetes (future)
  render/          render.yaml — Render blueprint
```

## Quick start

```bash
npm install
cp .env.example .env
# Fill in secrets and API keys (see docs/DEPLOYMENT.md)

docker compose -f infrastructure/docker/docker-compose.yml up -d postgres redis

npm run db:migrate

npm run dev
```

**Focused dev:**

- `npm run dev:frontend` — frontend workspaces
- `npm run dev:backend` — backend workspaces
- `npm run dev:gateway` — api-gateway only

**Shared packages:** build order matters for TypeScript. Example: `@vecta/providers` runs `tsc` after building `@vecta/logger` and `@vecta/types` (see `backend/shared/providers/package.json`).

## Service ports (local)

| Service            | Port | Role                                      |
|--------------------|------|-------------------------------------------|
| api-gateway        | 4000 | Public API                                |
| identity-service   | 3001 | Identity / ancillary services             |
| banking-service    | 3002 | Banking / connectors                      |
| housing-service    | 3003 | Credit bridge, trust, eSIM                |
| mobility-service   | 3004 | Rides / fleet                             |
| compliance-service | 3005 | Compliance, underwriting, insurance bind  |
| audit-service      | 3006 | Audit chain                               |
| compliance-ai      | 3007 | Python AI (if used)                       |
| landlord-portal    | 3000 | Next.js                                   |
| student-app        | 8081 | Expo (typical)                            |

## Branches

| Branch            | Purpose                                                |
|-------------------|--------------------------------------------------------|
| main              | Production-oriented line                               |
| vertical-fortress | In-house stack: Vecta ID, Vecta Ledger, Connect, MGA, etc. |

## Deployment

- **Frontend:** Vercel (see `docs/DEPLOY_VERCEL_RENDER.md`)
- **Backend:** Render (`infrastructure/render/render.yaml`)
- **Database:** Supabase PostgreSQL (or any Postgres; use `DATABASE_URL` + `npm run db:migrate`)
- **Cache:** Redis-compatible (e.g. Render Key Value)

## Documentation

| Doc | Contents |
|-----|----------|
| `docs/DEPLOYMENT.md` | Secrets, DB, S3, Redis checklist |
| `docs/DEPLOY_VERCEL_RENDER.md` | Vercel + Render wiring |
| `docs/SECRETS_ROTATION.md` | Secret rotation notes |
| `docs/ADRs.md` | Architecture decision records |
| `SECURITY.md` | Vulnerability reporting |
| `backend/api-gateway/RENDER_BUILD.md` | Gateway `tsc` / Render paths |

## Insurance & providers (vertical-fortress)

- **Default insurance integration key:** `INSURANCE_PROVIDER=vecta-mga` (see `backend/shared/providers/src/registry.ts`).
- **Vecta MGA** (`vecta-mga.adapter.ts`) owns the in-app binding path; **Boost** is the paper-carrier adapter where configured.
- **Legacy:** Lemonade remains in the codebase for optional redirects and tests; it is not the primary bind path when MGA is enabled.
