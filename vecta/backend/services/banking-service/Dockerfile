# Build context: monorepo root (vecta/).
ARG SERVICE_DIR=backend/services/banking-service

FROM node:20-alpine AS deps
ARG SERVICE_DIR
WORKDIR /app
COPY package.json package-lock.json turbo.json ./
COPY frontend/student-app/package.json ./frontend/student-app/
COPY frontend/landlord-portal/package.json ./frontend/landlord-portal/
COPY backend/api-gateway/package.json ./backend/api-gateway/
COPY backend/services/identity-service/package.json ./backend/services/identity-service/
COPY backend/services/banking-service/package.json ./backend/services/banking-service/
COPY backend/services/housing-service/package.json ./backend/services/housing-service/
COPY backend/services/mobility-service/package.json ./backend/services/mobility-service/
COPY backend/services/compliance-service/package.json ./backend/services/compliance-service/
COPY backend/services/audit-service/package.json ./backend/services/audit-service/
COPY backend/shared/auth/package.json ./backend/shared/auth/
COPY backend/shared/crypto/package.json ./backend/shared/crypto/
COPY backend/shared/database/package.json ./backend/shared/database/
COPY backend/shared/logger/package.json ./backend/shared/logger/
COPY backend/shared/providers/package.json ./backend/shared/providers/
COPY backend/shared/storage/package.json ./backend/shared/storage/
COPY backend/shared/types/package.json ./backend/shared/types/
RUN npm ci

FROM node:20-alpine AS builder
ARG SERVICE_DIR
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx turbo run build --filter=@vecta/banking-service...

FROM node:20-alpine AS runner
ARG SERVICE_DIR
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 vecta && adduser --system --uid 1001 vectauser
COPY --from=builder --chown=vectauser:vecta /app/${SERVICE_DIR}/dist ./dist
COPY --from=builder --chown=vectauser:vecta /app/${SERVICE_DIR}/package.json .
COPY --from=builder --chown=vectauser:vecta /app/node_modules ./node_modules
USER vectauser
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3002/health || exit 1
CMD ["node", "dist/server.js"]
