# Render: api-gateway build (debug `dist/`)

Paste this as the service **Build Command** when the Render **Root Directory** is the `vecta/` folder (or adjust the `cd` to match your layout):

```bash
cd backend/api-gateway && npm install && npm run build && ls -la dist/ && find dist -type f | head -80
```

After `npm run build`, the script also runs `scripts/write-render-entry.cjs`; the gateway entry is **`dist/server.js`** (shim that loads the compiled `server` module). For a quick sanity check you should see at least:

- `dist/server.js`

On environments without `find`/`head`, use:

```bash
cd backend/api-gateway && npm install && npm run build && ls -laR dist/
```

## Why `rootDir` is not `./src`

`tsconfig.json` sets `rootDir` to `../..` (the `backend/` directory) because **`include`** pulls in `src/**/*` from the gateway plus `../shared/**/*` and `../services/**/*`. TypeScript requires every emitted file to sit under a single `rootDir`, so it is widened to the common ancestor under `backend/`. Output paths under `dist/` mirror that layout (e.g. `dist/api-gateway/src/...`, `dist/shared/...`).

Set **Start Command** to `node dist/server.js` after `cd` into `backend/api-gateway`:

- **Render root = monorepo `vecta/` folder**:

```bash
cd backend/api-gateway && node dist/server.js
```

- **Render root = Git repo root** (parent of `vecta/`):

```bash
cd vecta/backend/api-gateway && node dist/server.js
```

You can also use `npm start`, which runs the same path.

## Common failures

1. **`cd vecta/backend/api-gateway` with Root Directory = `vecta`** — path becomes `vecta/vecta/...`. Use **`cd backend/api-gateway`** when Root Directory is already `vecta`.

2. **`Cannot find module ... @vecta/types/dist/index.js`** — workspace `main` must stay **`./dist/index.js`**, and the build must run **`npm ci --include=dev && npx turbo run build --filter=@vecta/api-gateway...`** from the `vecta/` folder so every `@vecta/*` package runs `tsc` first. Do not point `main` at `src/*.ts` for packages consumed as dependencies.

3. **`VECTA_JWT_PUBLIC_KEY`** — set in Render **Environment** for any route using JWT auth. The server can boot without it; protected routes return **503** until it is set.
