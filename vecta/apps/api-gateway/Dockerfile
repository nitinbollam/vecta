# apps/api-gateway/Dockerfile
# Multi-stage build — production Node.js image ~180MB
# Build context must be the monorepo root (folder that contains package.json + package-lock.json).

# ---- deps ----
FROM node:20-alpine AS deps
WORKDIR /app

# npm workspaces: every workspace path must exist with a package.json for `npm ci`
COPY package.json package-lock.json turbo.json ./
COPY apps/api-gateway/package.json ./apps/api-gateway/
COPY apps/compliance-ai/package.json ./apps/compliance-ai/
COPY apps/landlord-portal/package.json ./apps/landlord-portal/
COPY apps/student-app/package.json ./apps/student-app/
COPY packages/types/package.json ./packages/types/
COPY packages/auth/package.json ./packages/auth/
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/logger/package.json ./packages/logger/
COPY packages/database/package.json ./packages/database/
COPY packages/storage/package.json ./packages/storage/
COPY services/audit-service/package.json ./services/audit-service/
COPY services/banking-service/package.json ./services/banking-service/
COPY services/housing-service/package.json ./services/housing-service/
COPY services/identity-service/package.json ./services/identity-service/
COPY services/mobility-service/package.json ./services/mobility-service/

RUN npm ci

# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx turbo run build --filter=api-gateway...

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

CMD ["node", "dist/server.js"]
