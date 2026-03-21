# services/audit-service/Dockerfile
ARG SERVICE_DIR=services/audit-service
FROM node:20-alpine AS deps
ARG SERVICE_DIR
WORKDIR /app
COPY package.json yarn.lock turbo.json ./
COPY packages/crypto/package.json   ./packages/crypto/
COPY packages/logger/package.json   ./packages/logger/
COPY packages/database/package.json ./packages/database/
COPY packages/types/package.json    ./packages/types/
COPY ${SERVICE_DIR}/package.json    ./${SERVICE_DIR}/
RUN yarn install --frozen-lockfile --production=false

FROM node:20-alpine AS builder
ARG SERVICE_DIR
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn turbo run build --filter=audit-service...

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 vecta && adduser --system --uid 1001 vectauser
COPY --from=builder --chown=vectauser:vecta /app/services/audit-service/dist ./dist
COPY --from=builder --chown=vectauser:vecta /app/services/audit-service/package.json .
COPY --from=builder --chown=vectauser:vecta /app/node_modules ./node_modules
USER vectauser
EXPOSE 4005
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4005/health || exit 1
CMD ["node", "dist/server.js"]
