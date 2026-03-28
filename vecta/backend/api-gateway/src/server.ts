// apps/api-gateway/src/server.ts
// ─── Vecta API Gateway — Express (TypeScript) ────────────────────────────────
// The single external-facing entrypoint. Routes all traffic to microservices.

import "./load-env";
import { validateSecurityEnv } from "./validate-env";
validateSecurityEnv();

import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "./middleware/auth.middleware";
import { requestLogger } from "./middleware/request-logger.middleware";
import { errorHandler } from "./middleware/error-handler.middleware";
import { logger } from "./lib/logger";
import { getPool } from "@vecta/database";
import { getRedisGateway } from "./lib/redis-shared";

// ─── Infrastructure ───────────────────────────────────────────────────────────

/** Single shared pool (same instance as @vecta/database helpers). */
export const db = getPool();

export const redis = getRedisGateway();

// ─── Service Availability ─────────────────────────────────────────────────────
// Populated during bootstrap. Routes are always registered, but handlers
// can consult this map to return 503 when a dependency is unconfigured.

export interface ServiceStatus {
  available: boolean;
  reason?: string;
}

export const services: Record<string, ServiceStatus> = {
  didit:    { available: false, reason: "startup not complete" },
  unit:     { available: false, reason: "startup not complete" },
  plaid:    { available: false, reason: "startup not complete" },
  nova:     { available: false, reason: "startup not complete" },
  checkr:   { available: false, reason: "startup not complete" },
  sendgrid: { available: false, reason: "startup not complete" },
  lemonade: { available: false, reason: "startup not complete" },
  esim:     { available: false, reason: "startup not complete" },
};

/**
 * Check that all required env vars for a service are present.
 * Logs a warning and marks the service unavailable if any are missing.
 * Never throws — the server continues regardless.
 */
function checkServiceConfig(name: string, requiredVars: string[]): boolean {
  try {
    const missing = requiredVars.filter((v) => !process.env[v]);
    if (missing.length > 0) {
      throw new Error(`missing env vars: ${missing.join(", ")}`);
    }
    services[name] = { available: true };
    logger.info({ event: "SERVICE_READY", service: name });
    return true;
  } catch (err) {
    const reason = (err as Error).message;
    services[name] = { available: false, reason };
    logger.warn(
      { event: "SERVICE_UNAVAILABLE", service: name, reason },
      `${name} is unavailable — ${reason}`,
    );
    return false;
  }
}

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
    // No origin = server-to-server request or React Native mobile app.
    // React Native does not send an Origin header for fetch() calls.
    // This is intentional and required for the student mobile app to work.
    // When we add API key authentication for third parties, tighten this.
    if (!origin) {
      callback(null, true);
      return;
    }
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn({ origin }, "CORS: rejected request from unlisted origin");
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

// Stricter limiter for Vecta ID token generation
const tokenRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 10,                    // Max 10 Vecta ID tokens per hour per user
  keyGenerator: (req) => (req as any).user?.id ?? req.ip ?? "unknown",
});

app.use(globalRateLimiter);
app.use(requestLogger);

// Large payloads: university health-plan analyze (JSON or PDF) — before global 100kb JSON cap
app.use(
  "/api/v1/insurance/health-plan/analyze",
  (req, res, next) => {
    const ct = (req.headers["content-type"] ?? "").toLowerCase();
    if (ct.includes("application/pdf")) {
      return express.raw({ type: "application/pdf", limit: "20mb" })(req, res, next);
    }
    return express.json({ limit: "20mb" })(req, res, next);
  },
);

// Webhooks: raw JSON body for HMAC signature verification (must precede express.json)
app.use("/webhooks", express.raw({ type: "application/json", limit: "2mb" }));

const jsonParser = express.json({ limit: "100kb" });
const urlencodedParser = express.urlencoded({ extended: true, limit: "100kb" });

app.use((req, res, next) => {
  const p = req.path ?? "";
  if (p.startsWith("/webhooks")) {
    return next();
  }
  // Insurance analyze: first matching parser wins; skip default JSON if raw/pdf already consumed
  if (p === "/api/v1/insurance/health-plan/analyze") {
    return next();
  }
  return jsonParser(req, res, next);
});

app.use((req, res, next) => {
  const p = req.path ?? "";
  if (p.startsWith("/webhooks") || p === "/api/v1/insurance/health-plan/analyze") {
    return next();
  }
  return urlencodedParser(req, res, next);
});

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
  const dbOk    = await db.query("SELECT 1").then(() => true).catch(() => false);
  const redisOk = await redis.ping().then((r) => r === "PONG").catch(() => false);

  const status = dbOk && redisOk ? 200 : 503;
  res.status(status).json({
    status:    status === 200 ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks:    { database: dbOk, redis: redisOk },
    services,
  });
});

app.get("/ready", (_req, res) => res.json({ ready: true }));

// ─── Boot ─────────────────────────────────────────────────────────────────────

const STARTUP_ATTEMPTS = 8;
const STARTUP_DELAY_MS = 3000;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function bootstrap() {
  // ── Hard requirements — crash immediately if missing ─────────────────────
  if (!process.env.DATABASE_URL) {
    logger.error(
      { event: "MISSING_REQUIRED_ENV", var: "DATABASE_URL" },
      "DATABASE_URL is required — cannot start without a database",
    );
    process.exit(1);
  }
  if (!process.env.REDIS_URL) {
    logger.error(
      { event: "MISSING_REQUIRED_ENV", var: "REDIS_URL" },
      "REDIS_URL is required — cannot start without Redis",
    );
    process.exit(1);
  }

  // ── Optional service config checks (warn, never crash) ──────────────────
  checkServiceConfig("didit",    ["DIDIT_API_KEY", "DIDIT_API_URL"]);
  checkServiceConfig("unit",     ["UNIT_API_TOKEN", "UNIT_API_URL"]);
  checkServiceConfig("plaid",    ["PLAID_CLIENT_ID", "PLAID_SECRET", "LOC_SIGNING_KEY"]);
  checkServiceConfig("nova",     ["NOVA_CREDIT_API_KEY", "NOVA_CREDIT_API_URL"]);
  checkServiceConfig("checkr",   ["CHECKR_API_KEY", "CHECKR_WEBHOOK_SECRET"]);
  checkServiceConfig("sendgrid", ["SENDGRID_API_KEY"]);
  checkServiceConfig("lemonade", ["LEMONADE_API_KEY", "LEMONADE_PARTNER_ID", "LEMONADE_API_URL"]);
  checkServiceConfig("esim",     ["ESIM_GO_API_KEY", "ESIM_GO_API_URL"]);

  // ── Redis connection (hard-fail after retries) ───────────────────────────
  for (let i = 0; i < STARTUP_ATTEMPTS; i++) {
    try {
      await redis.connect();
      break;
    } catch (err) {
      const error = (err as Error).message;
      logger.warn(
        { event: "REDIS_CONNECT_RETRY", attempt: i + 1, error },
        "Redis connect failed, retrying",
      );
      if (i === STARTUP_ATTEMPTS - 1) {
        logger.error({ event: "REDIS_CONNECT_FAILED", error });
        process.exit(1);
      }
      await sleep(STARTUP_DELAY_MS);
    }
  }

  // ── Database connection (hard-fail after retries) ────────────────────────
  for (let i = 0; i < STARTUP_ATTEMPTS; i++) {
    try {
      await db.query("SELECT NOW()");
      break;
    } catch (err) {
      const error = (err as Error).message;
      logger.warn(
        { event: "DB_CONNECT_RETRY", attempt: i + 1, error },
        "Database connect failed, retrying",
      );
      if (i === STARTUP_ATTEMPTS - 1) {
        logger.error({ event: "DB_CONNECT_FAILED", error });
        process.exit(1);
      }
      await sleep(STARTUP_DELAY_MS);
    }
  }

  // ── Route registration ───────────────────────────────────────────────────
  // Webhooks and auth routes are always registered first (no external deps).
  try {
    const { identityWebhooksRouter } = await import("./routes/identity-webhooks.router");
    app.use("/webhooks", identityWebhooksRouter);
  } catch (err) {
    logger.warn({ event: "ROUTE_LOAD_FAILED", route: "identity-webhooks", error: (err as Error).message });
  }

  app.use("/api/v1", authMiddleware(redis));

  // Routes that may fail if their service dependencies are misconfigured.
  type RouteSpec = {
    mountPath: string;
    module: string;
    exportKey: string;
    service: string;
    extraMiddleware?: express.RequestHandler;
  };

  const routeSpecs: RouteSpec[] = [
    { mountPath: "/api/v1/identity",  module: "./routes/identity.router",    exportKey: "identityRouter",    service: "didit",    extraMiddleware: tokenRateLimiter },
    { mountPath: "/api/v1/housing",   module: "./routes/housing.router",     exportKey: "housingRouter",     service: "plaid"    },
    { mountPath: "/api/v1/mobility",  module: "./routes/mobility.router",    exportKey: "mobilityRouter",    service: "unit"     },
    { mountPath: "/api/v1/banking",   module: "./routes/banking.router",     exportKey: "bankingRouter",     service: "unit"     },
    { mountPath: "/api/v1",           module: "./routes/token.router",       exportKey: "tokenRouter",       service: "didit"    },
    { mountPath: "/api/v1",           module: "./routes/auth.router",        exportKey: "authRouter",        service: "sendgrid" },
    { mountPath: "/api/v1",           module: "./routes/insurance.router",   exportKey: "insuranceRouter",   service: "lemonade" },
    { mountPath: "/api/v1",           module: "./routes/certificate.router", exportKey: "certificateRouter", service: "didit"    },
    { mountPath: "/api/v1",           module: "./routes/compliance.router",  exportKey: "complianceRouter",  service: "checkr"   },
    { mountPath: "/api/v1",           module: "./routes/protocol.router",    exportKey: "protocolRouter",    service: "plaid"    },
    { mountPath: "/api/v1",           module: "./routes/landlord.router",    exportKey: "landlordRouter",    service: "checkr"   },
    { mountPath: "/webhooks",         module: "./routes/landlord.router",    exportKey: "landlordRouter",    service: "checkr"   },
  ];

  for (const spec of routeSpecs) {
    try {
      const mod = await import(spec.module);
      const router = mod[spec.exportKey] as express.Router;
      if (!router) throw new Error(`export '${spec.exportKey}' not found in ${spec.module}`);
      if (spec.extraMiddleware) {
        app.use(spec.mountPath, spec.extraMiddleware, router);
      } else {
        app.use(spec.mountPath, router);
      }
      logger.info({ event: "ROUTE_REGISTERED", mount: spec.mountPath, module: spec.module });
    } catch (err) {
      const error = (err as Error).message;
      logger.warn(
        { event: "ROUTE_LOAD_FAILED", mount: spec.mountPath, module: spec.module, service: spec.service, error },
        `Route ${spec.mountPath} (${spec.service}) failed to load — those endpoints will return 503`,
      );
      // Attach a fallback 503 so the route doesn't silently 404
      const svc = spec.service;
      app.use(spec.mountPath, (_req: express.Request, res: express.Response) => {
        res.status(503).json({
          error: "FEATURE_UNAVAILABLE",
          service: svc,
          reason: services[svc]?.reason ?? error,
        });
      });
    }
  }

  // ── Catch-all 404 (must come after all routes) ───────────────────────────
  app.use((req, res) => {
    res.status(404).json({
      error: "NOT_FOUND",
      message: `Route ${req.method} ${req.path} does not exist.`,
    });
  });

  // ── Error Handler (must be last) ─────────────────────────────────────────
  app.use(errorHandler);

  // ── Listen ───────────────────────────────────────────────────────────────
  const PORT = Number(process.env.PORT) || 4000;
  app.listen(PORT, "0.0.0.0", () => {
    logger.info({ event: "SERVER_STARTED", port: PORT, services });
    console.log(`Server running on port ${PORT}`);
  });

  // ── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ event: "GRACEFUL_SHUTDOWN", signal });
    await db.end();
    await redis.quit();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}

bootstrap().catch((err) => {
  logger.error({ event: "BOOTSTRAP_ERROR", error: (err as Error).message });
  process.exit(1);
});

export { app };
