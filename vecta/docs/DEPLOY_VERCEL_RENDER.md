# Deploy Vecta on Vercel + Render

This guide splits the stack the usual way: **Next.js landlord portal on Vercel**, **API + Compliance AI + Postgres + Redis on Render**.

For **PostgreSQL with pgvector** (roommate embeddings, compliance-ai), [Supabase](https://supabase.com) is a good fit: use it as `DATABASE_URL` for the API gateway and compliance-ai instead of Render Postgres (see [§ Supabase](#supabase-postgresql--pgvector) below).

## Prerequisites

1. **Git repository** with the `vecta` monorepo pushed to GitHub/GitLab/Bitbucket.
2. **Lockfile** — the Dockerfiles expect `yarn.lock` at the repo root. From `vecta/` run `yarn install` and commit `yarn.lock` so CI and hosts resolve identical dependency trees.
3. **Node 20** — both platforms use Node 20 for the Node apps.

---

## 1. Render (backend)

### Option A — Blueprint (recommended)

1. In [Render](https://render.com): **New** → **Blueprint**.
2. Connect the repo and select **`render.yaml`** at the monorepo root (`vecta/render.yaml`).
3. Apply the blueprint. It provisions:
   - PostgreSQL (`vecta-db`)
   - Redis (`vecta-redis`)
   - **vecta-api-gateway** (Node)
   - **vecta-compliance-ai** (Python / FastAPI)

### After the first deploy

1. **Migrations** — Run SQL migrations against the Render database (from your machine or a one-off job), same order as `package.json` `db:migrate`:

   ```bash
   psql "$DATABASE_URL" -f packages/database/migrations/001_initial_schema.sql
   psql "$DATABASE_URL" -f packages/database/migrations/002_plaid_connections.sql
   psql "$DATABASE_URL" -f packages/database/migrations/003_compliance_trust.sql
   psql "$DATABASE_URL" -f packages/database/migrations/004_compliance_network.sql
   ```

   Use the **External Database URL** from the Render Postgres dashboard as `DATABASE_URL`.

2. **Link services** — In **vecta-api-gateway** → **Environment**, set:
   - `COMPLIANCE_AI_URL` = `https://<vecta-compliance-ai-service-name>.onrender.com` (no trailing slash).
   - `ALLOWED_ORIGINS` = comma-separated browser origins that call the API, e.g. `https://your-portal.vercel.app,https://app.yourdomain.com`.

3. **Secrets** — Copy the rest from `.env.example` into Render env (JWT keys, `VECTA_FIELD_ENCRYPTION_KEY`, `VECTA_HMAC_SECRET`, `INTERNAL_SERVICE_SECRET`, Didit, Unit, Plaid, S3, etc.). Use the same values for any service that needs them.

4. **pgvector** — Prefer **Supabase** (below) or another Postgres that ships **pgvector**. If you use Supabase, skip provisioning Render Postgres in the blueprint (remove the `databases:` block and `fromDatabase` `DATABASE_URL` entries, then set `DATABASE_URL` manually on each web service), or keep Render Postgres for non-vector workloads only.

### Option B — Docker Web Service (API gateway only)

The repo includes `apps/api-gateway/Dockerfile`, which must be built with **repository root** as Docker context (the file copies `packages/*` and runs Turbo). On Render: **New Web Service** → **Docker**, root directory `.`, Dockerfile path `apps/api-gateway/Dockerfile`. You still need Postgres, Redis, and env vars as above.

---

## Supabase (PostgreSQL + pgvector)

Use [Supabase](https://supabase.com) when you want managed Postgres with **pgvector** enabled (recommended for Vecta’s embedding / roommate flows and compliance-ai).

### 1. Create a project

1. New project in the [Supabase dashboard](https://supabase.com/dashboard).
2. Note the **database password** you set at creation.

### 2. Connection string → `DATABASE_URL`

1. **Project Settings** → **Database** → connection parameters / URI.
2. Copy a Postgres URI. For **Render** (long-lived Node + Python), the **direct** connection (port **5432**) or **session pooler** is usually appropriate. For **many short-lived** clients, Supabase documents **transaction pooling** (port **6543**); some drivers have limits with transaction mode—test your stack.
3. Ensure the URL requests TLS, e.g. `?sslmode=require` if not already present.
4. If the password contains special characters, use the **URI-encoded** form Supabase shows in the dashboard.

Set **the same** `DATABASE_URL` on **vecta-api-gateway** and **vecta-compliance-ai** in Render (or in `.env` locally).

### 3. Enable `pgvector`

In Supabase: **SQL Editor** (or any `psql` session against this DB):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Then run Vecta’s migrations (same order as `yarn db:migrate`), pointing `DATABASE_URL` at Supabase:

```bash
psql "$DATABASE_URL" -f packages/database/migrations/001_initial_schema.sql
psql "$DATABASE_URL" -f packages/database/migrations/002_plaid_connections.sql
psql "$DATABASE_URL" -f packages/database/migrations/003_compliance_trust.sql
psql "$DATABASE_URL" -f packages/database/migrations/004_compliance_network.sql
```

### 4. Render blueprint without Render Postgres

If Supabase is your only database, do **not** create `vecta-db` in `render.yaml` (remove the `databases:` section and the `fromDatabase` blocks for `DATABASE_URL`). Add `DATABASE_URL` as a **secret** on both web services in the Render dashboard instead.

Supabase is **only** Postgres + Auth/Storage/etc. as you choose; Vecta still uses **Render Key Value** (or any Redis) for `REDIS_URL` unless you add a separate Redis provider.

### 5. Further reading

- [Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)  
- [pgvector](https://supabase.com/docs/guides/database/extensions/pgvector)

---

## 2. Vercel (landlord portal)

1. Import the **same** Git repository into [Vercel](https://vercel.com).
2. **Root Directory**: `apps/landlord-portal`  
   (Vercel will use `apps/landlord-portal/vercel.json`, which installs and builds from the monorepo root.)
3. **Framework**: Next.js (auto-detected).
4. **Environment variables** (Production / Preview as needed):

   | Variable | Purpose |
   |----------|---------|
   | `API_GATEWAY_URL` | Public base URL of the Render API **without** trailing slash, e.g. `https://vecta-api-gateway.onrender.com`. Enables **rewrites** so browser calls to `/api/v1/*` hit the gateway. |
   | `VECTA_INTERNAL_API_URL` | Same URL as above for **server-side** `fetch` (SSR, Route Handlers, `verify` flows). |
   | `NEXT_PUBLIC_APP_URL` | Canonical portal URL, e.g. `https://your-app.vercel.app` (used in emails / links). |
   | `VECTA_JWT_PUBLIC_KEY` | PEM public key (same as gateway) for server-side verification when the portal needs it. |

5. Redeploy after changing env vars.

### CORS

The gateway reads `ALLOWED_ORIGINS` (comma-separated). Every Vercel deployment URL you use (production + preview) must be listed if the browser talks to the API **directly**. With **`API_GATEWAY_URL` rewrites**, the browser only talks to the Vercel origin for `/api/v1/*`, so production/staging portal URLs must still be allowed if anything calls the API origin directly; for pure rewrite usage, include at least your production portal origin.

---

## 3. Wire-up checklist

- [ ] Database: migrations applied on **Render Postgres** or **Supabase** (`DATABASE_URL` identical on gateway + compliance-ai).
- [ ] Render: `COMPLIANCE_AI_URL` and `ALLOWED_ORIGINS` set on **vecta-api-gateway**.
- [ ] Render: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` on **vecta-compliance-ai** if you use those features.
- [ ] Vercel: `API_GATEWAY_URL` and `VECTA_INTERNAL_API_URL` set to the gateway URL.
- [ ] Gateway health: `GET https://<gateway>/health` returns `ok`.
- [ ] Compliance health: `GET https://<compliance>/health` returns OK.

---

## 4. Student app (Expo) and microservices

- **Student app** is not deployed by this doc. Point `EXPO_PUBLIC_API_URL` at your public **gateway** URL when building EAS/production binaries.
- **Docker Compose** can run separate Node microservices (`identity-service`, etc.). The current **api-gateway** bundles many routes in-process; only URLs like `COMPLIANCE_AI_URL` are required for features that call **compliance-ai**. If you later split services behind the gateway, add their public URLs to Render and to optional env vars documented in the landlord **admin** dashboard section below.

---

## 5. Optional: admin dashboard service URLs

The landlord **admin** page can ping **Compliance AI** and optional microservices if you set:

- `COMPLIANCE_AI_INTERNAL_URL` or `COMPLIANCE_AI_URL` — full URL including `https://`.
- `IDENTITY_SERVICE_URL`, `BANKING_SERVICE_URL`, `HOUSING_SERVICE_URL`, `MOBILITY_SERVICE_URL`, `AUDIT_SERVICE_URL` — only if those services are deployed and reachable from Vercel’s SSR runtime (public HTTPS URLs).

If unset, only **API Gateway** (and Compliance when URL is set) appear in the health list.
