# Infrastructure

`docker/` — local development via Docker Compose (Postgres, Redis, …)  
`k8s/` — Kubernetes manifests (future)  
`render/` — Render.com blueprint (`render.yaml`) for API + workers

**Local:** from the repo `vecta/` root:

```bash
docker compose -f infrastructure/docker/docker-compose.yml up
```

**Render:** connect the Git repo → **New Blueprint** → select `infrastructure/render/render.yaml` (or the root `render.yaml` if that is what your repo uses). Match **Root Directory** to where `package.json` lives (`vecta/`).

**Migrations:** prefer `npm run db:migrate` from `vecta/`; SQL files live under `backend/shared/database/migrations/`.
