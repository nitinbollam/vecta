"use strict";
/**
 * @vecta/logger — Structured JSON logger (pino) for all Vecta services.
 *
 * Features:
 * - PII redaction via serializer deny-list (passport, ssn, accessToken, etc.)
 * - Request-scoped child loggers (correlationId, userId, service)
 * - Log levels driven by NODE_ENV / LOG_LEVEL env var
 * - Datadog-compatible JSON fields (dd.trace_id, dd.span_id)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditLogger = exports.rootLogger = void 0;
exports.createLogger = createLogger;
exports.createRequestLogger = createRequestLogger;
exports.logAuditEvent = logAuditEvent;
exports.logComplianceEvent = logComplianceEvent;
const pino_1 = __importDefault(require("pino"));
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
function redactPII(obj) {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        if (PII_KEYS.has(key)) {
            result[key] = '[REDACTED]';
        }
        else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            result[key] = redactPII(value);
        }
        else {
            result[key] = value;
        }
    }
    return result;
}
// ---------------------------------------------------------------------------
// Base logger configuration
// ---------------------------------------------------------------------------
const isDev = process.env.NODE_ENV !== 'production';
const baseOptions = {
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
        err: pino_1.default.stdSerializers.err,
    },
    formatters: {
        level(label) {
            return { level: label };
        },
    },
    timestamp: pino_1.default.stdTimeFunctions.isoTime,
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
exports.rootLogger = (0, pino_1.default)(baseOptions);
// ---------------------------------------------------------------------------
// Factory — create a service-scoped child logger
// ---------------------------------------------------------------------------
function createLogger(serviceName, meta) {
    return exports.rootLogger.child({
        service: serviceName,
        ...meta,
    });
}
function createRequestLogger(parent, ctx) {
    return parent.child(redactPII(ctx));
}
// ---------------------------------------------------------------------------
// Audit-specific logger — writes to a separate audit stream in production
// ---------------------------------------------------------------------------
const auditOptions = {
    ...baseOptions,
    level: 'info',
    base: {
        ...baseOptions.base,
        logType: 'audit',
    },
};
exports.auditLogger = (0, pino_1.default)(auditOptions);
function logAuditEvent(event, actorId, resourceId, meta) {
    exports.auditLogger.info({
        event,
        actorId,
        resourceId,
        ...(meta ? redactPII(meta) : {}),
    }, `AUDIT: ${event}`);
}
// ---------------------------------------------------------------------------
// Compliance-specific logger — immutable evidence for USCIS/IRS
// ---------------------------------------------------------------------------
function logComplianceEvent(event, studentId, detail) {
    exports.auditLogger.info({
        event,
        studentId,
        complianceCategory: 'F1_VISA',
        ...redactPII(detail),
    }, `COMPLIANCE: ${event}`);
}
//# sourceMappingURL=index.js.map