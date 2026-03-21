# Render: api-gateway build (debug `dist/`)

Paste this as the service **Build Command** when the Render **Root Directory** is the repo root (or adjust the `cd` to match your layout):

```bash
cd vecta/apps/api-gateway && npm install && npm run build && ls -la dist/ && find dist -type f | head -80
```

Expected gateway entry (for `ls` sanity check):

`dist/apps/api-gateway/src/server.js`

On environments without `find`/`head`, use:

```bash
cd vecta/apps/api-gateway && npm install && npm run build && ls -laR dist/
```

## Why `rootDir` is not `./src`

This package’s `tsc` program includes `../../services/**/*.ts` and `../../packages/providers/**/*.ts`. TypeScript requires every emitted file to sit under `rootDir`, so `rootDir` is set to `../..` (the monorepo folder that contains `apps/`, `services/`, and `packages/`). The gateway entrypoint ends up at:

`dist/apps/api-gateway/src/server.js`

Set **Start Command** accordingly, e.g.:

```bash
node apps/api-gateway/dist/apps/api-gateway/src/server.js
```

(if your process runs from the `vecta` directory on Render).
