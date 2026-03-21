/**
 * @vecta/logger — Structured JSON logger (pino) for all Vecta services.
 *
 * Features:
 * - PII redaction via serializer deny-list (passport, ssn, accessToken, etc.)
 * - Request-scoped child loggers (correlationId, userId, service)
 * - Log levels driven by NODE_ENV / LOG_LEVEL env var
 * - Datadog-compatible JSON fields (dd.trace_id, dd.span_id)
 */
import { Logger } from 'pino';
export declare const rootLogger: Logger;
export declare function createLogger(serviceName: string, meta?: Record<string, unknown>): Logger;
export interface RequestLogContext {
    correlationId: string;
    userId?: string;
    studentId?: string;
    landlordId?: string;
    requestPath?: string;
}
export declare function createRequestLogger(parent: Logger, ctx: RequestLogContext): Logger;
export declare const auditLogger: Logger;
export declare function logAuditEvent(event: string, actorId: string, resourceId: string, meta?: Record<string, unknown>): void;
export declare function logComplianceEvent(event: string, studentId: string, detail: Record<string, unknown>): void;
export type { Logger };
//# sourceMappingURL=index.d.ts.map