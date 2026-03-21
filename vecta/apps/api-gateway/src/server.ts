// apps/api-gateway/src/server.ts
// ─── Vecta API Gateway — Express (TypeScript) ────────────────────────────────
// The single external-facing entrypoint. Routes all traffic to microservices.

import "./load-env";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { Pool } from "pg";
import Redis from "ioredis";
import { identityRouter } from "./routes/identity.router";
import { bankingRouter } from "./routes/banking.router";
import { housingRouter } from "./routes/housing.router";
import { mobilityRouter } from "./routes/mobility.router";
import { tokenRouter }    from "./routes/token.router";
import { landlordRouter } from "./routes/landlord.router";
import { authRouter }      from "./routes/auth.router";
import { insuranceRouter }   from "./routes/insurance.router";
import { certificateRouter } from "./routes/certificate.router";
import { complianceRouter }  from "./routes/compliance.router";
import { protocolRouter }    from "./routes/protocol.router";
import { webhookRouter } from "./routes/webhook.router";
import { authMiddleware } from "./middleware/auth.middleware";
import { requestLogger } from "./middleware/request-logger.middleware";
import { errorHandler } from "./middleware/error-handler.middleware";
import { logger } from "./lib/logger";

// ─── Infrastructure ───────────────────────────────────────────────────────────

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express();

// ─── Security Headers ─────────────────────────────────────────────────────────
app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000,http://localhost:8081").split(",");

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
}));

// ─── Rate Limiting ────────────────────────────────────────────────────────────

const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "unknown",
  handler: (req, res) => {
    res.status(429).json({ error: "RATE_LIMIT_EXCEEDED", retryAfter: 900 });
  },
});

// Stricter limiter for auth endpoints
// Stricter limiter for Vecta ID token generation
const tokenRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 10,                    // Max 10 Vecta ID tokens per hour per user
  keyGenerator: (req) => (req as any).user?.id ?? req.ip ?? "unknown",
});

app.use(globalRateLimiter);
app.use(requestLogger);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ─── Health & Readiness ───────────────────────────────────────────────────────

// OpenAPI docs (dev only)
if (process.env.NODE_ENV !== "production") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs   = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("path") as typeof import("path");
  const specPath = path.join(__dirname, "../../../docs/openapi.yaml");

  app.get("/docs", (_req, res) => {
    res.send(`<!DOCTYPE html><html><head><title>Vecta API Docs</title>
      <meta charset="utf-8"/>
      <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
      <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
      </head><body><div id="swagger-ui"></div>
      <script>SwaggerUIBundle({url:"/docs/openapi.yaml",dom_id:"#swagger-ui",presets:[SwaggerUIBundle.presets.apis,SwaggerUIBundle.SwaggerUIStandalonePreset],layout:"StandaloneLayout"})</script>
    </body></html>`);
  });

  app.get("/docs/openapi.yaml", (_req, res) => {
    if (fs.existsSync(specPath)) {
      res.setHeader("Content-Type", "application/yaml");
      res.send(fs.readFileSync(specPath, "utf8"));
    } else {
      res.status(404).json({ error: "openapi.yaml not found" });
    }
  });
}

app.get("/health", async (_req, res) => {
  const dbOk = await db.query("SELECT 1").then(() => true).catch(() => false);
  const redisOk = await redis.ping().then((r) => r === "PONG").catch(() => false);

  const status = dbOk && redisOk ? 200 : 503;
  res.status(status).json({
    status: status === 200 ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks: { database: dbOk, redis: redisOk },
  });
});

app.get("/ready", (req, res) => res.json({ ready: true }));

// ─── Public Routes (no auth) ──────────────────────────────────────────────────

// Webhooks — authenticate via HMAC, not JWT
app.use("/webhooks", webhookRouter);

// ─── Protected Routes (JWT required) ─────────────────────────────────────────

app.use("/api/v1", authMiddleware(redis));

app.use("/api/v1/identity", tokenRateLimiter, identityRouter);
app.use("/api/v1/banking", bankingRouter(db, redis));
app.use("/api/v1/housing", housingRouter);
app.use("/api/v1/mobility", mobilityRouter);
app.use("/api/v1",          tokenRouter);
app.use("/api/v1",          authRouter);
app.use("/api/v1",          insuranceRouter);
app.use("/api/v1",          certificateRouter);
app.use("/api/v1",          complianceRouter);
app.use("/api/v1",          protocolRouter);
app.use("/api/v1",          landlordRouter);
app.use("/webhooks",        landlordRouter);

// ─── Catch-all 404 ───────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({
    error: "NOT_FOUND",
    message: `Route ${req.method} ${req.path} does not exist.`,
  });
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function bootstrap() {
  await redis.connect().catch((err) => {
    logger.error({ event: "REDIS_CONNECT_ERROR", error: err.message });
    process.exit(1);
  });

  await db.query("SELECT NOW()").catch((err) => {
    logger.error({ event: "DB_CONNECT_ERROR", error: err.message });
    process.exit(1);
  });

  const port = parseInt(process.env.PORT ?? "4000", 10);
  app.listen(port, "0.0.0.0", () => {
    logger.info({ event: "SERVER_STARTED", port, env: process.env.NODE_ENV });
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ event: "GRACEFUL_SHUTDOWN", signal });
    await db.end();
    await redis.quit();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((err) => {
  logger.error({ event: "BOOTSTRAP_ERROR", error: err.message });
  process.exit(1);
});

export { app };
