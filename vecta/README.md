# Vecta — Financial Embassy & Life-as-a-Service

Complete financial infrastructure for F-1 international students in the US.
NFC passport verification · US banking · Housing guarantee · Insurance · Fleet income

## Repository Structure

frontend/
  student-app/          React Native (Expo) — iOS & Android
  landlord-portal/      Next.js — Landlord verification portal

backend/
  api-gateway/          Express — Public entry point, auth, request routing
  services/
    identity-service/   KYC, NFC passport, Unit.co banking, email, push
    banking-service/    Plaid, Vecta Ledger, Letter of Credit generation
    housing-service/    Nova Credit, eSIM, trust score engine
    mobility-service/   Fleet recorder, F-1 compliance, audit chain
    compliance-service/ AML, OFAC, liquidity engine, underwriting
    audit-service/      Append-only hash chain, public anchor log
    compliance-ai/      Python — Claude Vision, OpenAI embeddings
  shared/
    auth/               JWT, RBAC, Ed25519 signing, CSCA registry
    crypto/             AES-256-GCM field encryption (600k PBKDF2)
    database/           PostgreSQL pool, migrations, typed helpers
    logger/             Pino structured logging with PII redaction
    providers/          Vendor abstraction — swap APIs without code changes
    storage/            AWS S3 wrapper
    types/              Shared TypeScript types and enums

infrastructure/
  docker/               docker-compose.yml — local development
  k8s/                  Kubernetes manifests (future)
  render/               render.yaml — production deployment blueprint

## Quick Start

# Install all dependencies
npm install

# Copy environment variables
cp .env.example .env
# Fill in your API keys

# Start infrastructure (postgres + redis)
docker compose -f infrastructure/docker/docker-compose.yml up -d postgres redis

# Run database migrations
npm run db:migrate

# Start everything
npm run dev

# Or start individual layers
npm run dev:frontend    # landlord-portal + student-app
npm run dev:backend     # all backend services
npm run dev:gateway     # api-gateway only

## Service Ports (local development)

| Service            | Port | Description                    |
|--------------------|------|--------------------------------|
| api-gateway        | 4000 | Public entry point             |
| identity-service   | 3001 | KYC, auth, banking             |
| banking-service    | 3002 | Plaid, Letter of Credit        |
| housing-service    | 3003 | Credit, eSIM, trust            |
| mobility-service   | 3004 | Fleet, audit chain             |
| compliance-service | 3005 | AML, liquidity, insurance      |
| audit-service      | 3006 | Hash chain, public anchors     |
| compliance-ai      | 3007 | Python AI service              |
| landlord-portal    | 3000 | Next.js frontend               |
| student-app        | 8081 | Expo dev server                |

## Branches

| Branch                  | Purpose                              |
|-------------------------|--------------------------------------|
| main                    | Live — deployed to Render + Vercel   |
| vertical-fortress       | In-house APIs — Vecta ID, Ledger, MGA|
| restructure/production  | This branch — clean repo structure   |

## Deployment

Frontend:   Vercel (auto-deploys from main)
Backend:    Render (blueprint: infrastructure/render/render.yaml)
Database:   Supabase PostgreSQL
Cache:      Render Key Value (Redis)
