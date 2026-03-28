# Render: api-gateway build (debug `dist/`)

Paste this as the service **Build Command** when the Render **Root Directory** is the repo root (or adjust the `cd` to match your layout):

```bash
cd vecta/apps/api-gateway && npm install && npm run build && ls -la dist/ && find dist -type f | head -80
```

After `npm run build`, `dist/server.js` is generated (shim → `dist/apps/api-gateway/src/server.js`). For `ls` sanity check you should see both:

- `dist/server.js`
- `dist/apps/api-gateway/src/server.js`

On environments without `find`/`head`, use:

```bash
cd vecta/apps/api-gateway && npm install && npm run build && ls -laR dist/
```

## Why `rootDir` is not `./src`

This package’s `tsc` program includes `../../services/**/*.ts` and `../../packages/providers/**/*.ts`. TypeScript requires every emitted file to sit under `rootDir`, so `rootDir` is set to `../..` (the monorepo folder that contains `apps/`, `services/`, and `packages/`). The gateway entrypoint ends up at:

`dist/apps/api-gateway/src/server.js`

Set **Start Command** to `node dist/server.js` (after `cd` into `apps/api-gateway`):

- **Render root = monorepo `vecta/` folder** (matches `render.yaml` `rootDir: vecta`):

```bash
cd apps/api-gateway && node dist/server.js
```

- **Render root = Git repo root** (parent of `vecta/`):

```bash
cd vecta/apps/api-gateway && node dist/server.js
```

You can also use `npm start`, which runs the same path.

## Common failures

1. **`cd vecta/apps/api-gateway` with Root Directory = `vecta`** — path becomes `vecta/vecta/...`. Use **`cd apps/api-gateway`** when Root Directory is already `vecta`.

2. **`Cannot find module ... @vecta/types/dist/index.js`** — workspace `main` must stay **`./dist/index.js`**, and the build must run **`npm ci --include=dev && npx turbo run build --filter=api-gateway...`** from the `vecta/` folder so every `@vecta/*` package runs `tsc` (`^build`). Do not point `main` at `src/*.ts` (Node will try to load TS and fail on `enum`, etc.).

3. **`VECTA_JWT_PUBLIC_KEY`** — set in Render **Environment** for any route using JWT auth. The server can boot without it; protected routes return **503** until it is set.
