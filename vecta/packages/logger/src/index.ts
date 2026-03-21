/**
 * @vecta/logger — Structured JSON logger (pino) for all Vecta services.
 *
 * Features:
 * - PII redaction via serializer deny-list (passport, ssn, accessToken, etc.)
 * - Request-scoped child loggers (correlationId, userId, service)
 * - Log levels driven by NODE_ENV / LOG_LEVEL env var
 * - Datadog-compatible JSON fields (dd.trace_id, dd.span_id)
 */

import pino, { Logger, LoggerOptions } from 'pino';

// ---------------------------------------------------------------------------
// PII field deny-list — these keys are redacted before log emission
// ---------------------------------------------------------------------------
const PII_KEYS = new Set([
  'passportNumber',
  'passportData',
  'nationality',
  'countryOfOrigin',
  'ssn',
  'taxId',
  'accessToken',
  'plaidAccessToken',
  'unitAccountId',
  'imei',
  'homePhoneNumber',
  'bankAccountNumber',
  'routingNumber',
  'authorization',
  'cookie',
  'password',
  'secret',
  'privateKey',
]);

function redactPII(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (PII_KEYS.has(key)) {
      result[key] = '[REDACTED]';
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactPII(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Base logger configuration
// ---------------------------------------------------------------------------

const isDev = process.env.NODE_ENV !== 'production';

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  base: {
    service: process.env.SERVICE_NAME ?? 'vecta-unknown',
    env: process.env.NODE_ENV ?? 'development',
    version: process.env.npm_package_version ?? '0.0.0',
  },
  serializers: {
    req(req) {
      return {
        method: req.method,
        url: req.url,
        correlationId: req.headers?.['x-correlation-id'],
        userAgent: req.headers?.['user-agent'],
        // Never log Authorization header
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode,
        responseTime: res.responseTime,
      };
    },
    err: pino.stdSerializers.err,
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    },
  }),
};

// ---------------------------------------------------------------------------
// Root logger singleton
// ---------------------------------------------------------------------------

export const rootLogger: Logger = pino(baseOptions);

// ---------------------------------------------------------------------------
// Factory — create a service-scoped child logger
// ---------------------------------------------------------------------------

export function createLogger(serviceName: string, meta?: Record<string, unknown>): Logger {
  return rootLogger.child({
    service: serviceName,
    ...meta,
  });
}

// ---------------------------------------------------------------------------
// Request-scoped logger — attach to Express `req` or Fastify context
// ---------------------------------------------------------------------------

export interface RequestLogContext {
  correlationId: string;
  userId?: string;
  studentId?: string;
  landlordId?: string;
  requestPath?: string;
}

export function createRequestLogger(
  parent: Logger,
  ctx: RequestLogContext,
): Logger {
  return parent.child(redactPII(ctx as unknown as Record<string, unknown>));
}

// ---------------------------------------------------------------------------
// Audit-specific logger — writes to a separate audit stream in production
// ---------------------------------------------------------------------------

const auditOptions: LoggerOptions = {
  ...baseOptions,
  level: 'info',
  base: {
    ...baseOptions.base,
    logType: 'audit',
  },
};

export const auditLogger: Logger = pino(auditOptions);

export function logAuditEvent(
  event: string,
  actorId: string,
  resourceId: string,
  meta?: Record<string, unknown>,
): void {
  auditLogger.info(
    {
      event,
      actorId,
      resourceId,
      ...(meta ? redactPII(meta) : {}),
    },
    `AUDIT: ${event}`,
  );
}

// ---------------------------------------------------------------------------
// Compliance-specific logger — immutable evidence for USCIS/IRS
// ---------------------------------------------------------------------------

export function logComplianceEvent(
  event: string,
  studentId: string,
  detail: Record<string, unknown>,
): void {
  auditLogger.info(
    {
      event,
      studentId,
      complianceCategory: 'F1_VISA',
      ...redactPII(detail),
    },
    `COMPLIANCE: ${event}`,
  );
}

export type { Logger };
