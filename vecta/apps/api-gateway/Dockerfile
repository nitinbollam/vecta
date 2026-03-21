# apps/api-gateway/Dockerfile
# Multi-stage build — production Node.js image ~180MB

# ---- deps ----
FROM node:20-alpine AS deps
WORKDIR /app

# Install only production deps first (better layer caching)
COPY package.json yarn.lock ./
COPY turbo.json ./
COPY packages/types/package.json       ./packages/types/
COPY packages/auth/package.json        ./packages/auth/
COPY packages/crypto/package.json      ./packages/crypto/
COPY packages/logger/package.json      ./packages/logger/
COPY packages/database/package.json    ./packages/database/
COPY packages/storage/package.json     ./packages/storage/
COPY apps/api-gateway/package.json     ./apps/api-gateway/

RUN yarn install --frozen-lockfile --production=false

# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN yarn turbo run build --filter=api-gateway...

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Non-root user for security
RUN addgroup --system --gid 1001 vecta && \
    adduser  --system --uid 1001 vectauser

# Copy only the built artefacts + production deps
COPY --from=builder --chown=vectauser:vecta /app/apps/api-gateway/dist ./dist
COPY --from=builder --chown=vectauser:vecta /app/apps/api-gateway/package.json .
COPY --from=builder --chown=vectauser:vecta /app/node_modules ./node_modules

USER vectauser

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "dist/apps/api-gateway/src/server.js"]
