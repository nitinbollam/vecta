# services/housing-service/Dockerfile — identical pattern to identity-service
# Build: docker build --build-arg SERVICE_DIR=services/housing-service -t vecta/housing-service .
ARG SERVICE_DIR=services/housing-service

FROM node:20-alpine AS deps
ARG SERVICE_DIR
WORKDIR /app
COPY package.json yarn.lock turbo.json ./
COPY packages/types/package.json    ./packages/types/
COPY packages/auth/package.json     ./packages/auth/
COPY packages/crypto/package.json   ./packages/crypto/
COPY packages/logger/package.json   ./packages/logger/
COPY packages/database/package.json ./packages/database/
COPY packages/storage/package.json  ./packages/storage/
COPY ${SERVICE_DIR}/package.json    ./${SERVICE_DIR}/
RUN yarn install --frozen-lockfile --production=false

FROM node:20-alpine AS builder
ARG SERVICE_DIR
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn turbo run build --filter=$(basename ${SERVICE_DIR})...

FROM node:20-alpine AS runner
ARG SERVICE_DIR
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 vecta && adduser --system --uid 1001 vectauser
COPY --from=builder --chown=vectauser:vecta /app/${SERVICE_DIR}/dist ./dist
COPY --from=builder --chown=vectauser:vecta /app/${SERVICE_DIR}/package.json .
COPY --from=builder --chown=vectauser:vecta /app/node_modules ./node_modules
USER vectauser
EXPOSE ${PORT:-4002}
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3   CMD wget -qO- http://localhost:${PORT:-4002}/health || exit 1
CMD ["node", "dist/server.js"]
