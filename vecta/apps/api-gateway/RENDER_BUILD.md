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
