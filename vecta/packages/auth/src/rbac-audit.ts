/**
 * packages/auth/src/rbac-audit.ts
 *
 * Writes every RBAC decision — ALLOWED and BLOCKED — to the rbac_audit_log table.
 *
 * Why log ALLOWED too?
 *   Regulators don't just want to see that violations were blocked.
 *   They want a complete picture: what was attempted, what was permitted,
 *   and that the system behaved consistently.
 *
 * During a USCIS/IRS audit you can produce:
 *   "SELECT * FROM rbac_audit_log WHERE actor_id = $studentId AND result = 'BLOCKED'"
 *   → proves the student never successfully accepted a ride or drove.
 *
 * The table is append-only by policy (enforced in application layer — no UPDATE/DELETE
 * exposed via any API route). A companion DB RULE can be added if required.
 */

import { query } from '@vecta/database';
import { createLogger } from '@vecta/logger';

const logger = createLogger('rbac-audit');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RBACDecision {
  actorId:         string;
  actorRole:       string;
  attemptedAction: string;
  result:          'ALLOWED' | 'BLOCKED';
  blockReason?:    string;
  ipAddress?:      string;
  userAgent?:      string;
  correlationId?:  string;
}

// ---------------------------------------------------------------------------
// Fire-and-forget audit write
// Errors are logged but never allowed to block the request path.
// ---------------------------------------------------------------------------

export function auditRBACDecision(decision: RBACDecision): void {
  // Async, non-blocking — do not await in request handler
  void writeAuditRecord(decision);
}

async function writeAuditRecord(decision: RBACDecision): Promise<void> {
  try {
    await query(
      `INSERT INTO rbac_audit_log
         (actor_id, actor_role, attempted_action, result, block_reason,
          ip_address, user_agent, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        decision.actorId,
        decision.actorRole,
        decision.attemptedAction,
        decision.result,
        decision.blockReason ?? null,
        decision.ipAddress   ?? null,
        decision.userAgent   ?? null,
        decision.correlationId ?? null,
      ],
    );
  } catch (err) {
    // Log but swallow — audit failure must never break auth
    logger.error({ err, decision }, 'RBAC audit write failed');
  }
}

// ---------------------------------------------------------------------------
// Query helpers for compliance exports
// ---------------------------------------------------------------------------

export interface RBACAuditQuery {
  actorId?:        string;
  attemptedAction?: string;
  result?:         'ALLOWED' | 'BLOCKED';
  from?:           Date;
  to?:             Date;
  limit?:          number;
}

export async function queryRBACLog(params: RBACAuditQuery): Promise<Array<{
  id:              string;
  actorId:         string;
  actorRole:       string;
  attemptedAction: string;
  result:          string;
  blockReason:     string | null;
  createdAt:       Date;
}>> {
  const conditions: string[] = [];
  const values: unknown[]    = [];
  let idx = 1;

  if (params.actorId)        { conditions.push(`actor_id = $${idx++}`);         values.push(params.actorId); }
  if (params.attemptedAction){ conditions.push(`attempted_action = $${idx++}`); values.push(params.attemptedAction); }
  if (params.result)         { conditions.push(`result = $${idx++}`);           values.push(params.result); }
  if (params.from)           { conditions.push(`created_at >= $${idx++}`);      values.push(params.from); }
  if (params.to)             { conditions.push(`created_at <= $${idx++}`);      values.push(params.to); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  values.push(params.limit ?? 500);

  const result = await query<{
    id: string; actor_id: string; actor_role: string;
    attempted_action: string; result: string;
    block_reason: string | null; created_at: string;
  }>(
    `SELECT id, actor_id, actor_role, attempted_action, result, block_reason, created_at
     FROM rbac_audit_log ${where}
     ORDER BY created_at DESC
     LIMIT $${idx}`,
    values,
  );

  return result.rows.map((r) => ({
    id:              r.id,
    actorId:         r.actor_id,
    actorRole:       r.actor_role,
    attemptedAction: r.attempted_action,
    result:          r.result,
    blockReason:     r.block_reason,
    createdAt:       new Date(r.created_at),
  }));
}

// ---------------------------------------------------------------------------
// Convenience: count F-1 violation blocks for a student (USCIS evidence)
// ---------------------------------------------------------------------------

export async function getF1ViolationBlockCount(studentId: string): Promise<{
  totalBlocks:         number;
  byAction:            Record<string, number>;
  earliestAttempt:     Date | null;
  mostRecentAttempt:   Date | null;
}> {
  const result = await query<{
    attempted_action: string;
    count: string;
    first_at: string;
    last_at: string;
  }>(
    `SELECT attempted_action,
            COUNT(*)::text    AS count,
            MIN(created_at)::text AS first_at,
            MAX(created_at)::text AS last_at
     FROM rbac_audit_log
     WHERE actor_id = $1
       AND result = 'BLOCKED'
       AND block_reason = 'F1_VISA_COMPLIANCE_VIOLATION'
     GROUP BY attempted_action`,
    [studentId],
  );

  const byAction: Record<string, number> = {};
  let totalBlocks = 0;
  let earliestAttempt: Date | null = null;
  let mostRecentAttempt: Date | null = null;

  for (const row of result.rows) {
    const count = parseInt(row.count, 10);
    byAction[row.attempted_action] = count;
    totalBlocks += count;

    const first = new Date(row.first_at);
    const last  = new Date(row.last_at);
    if (!earliestAttempt || first < earliestAttempt) earliestAttempt = first;
    if (!mostRecentAttempt || last > mostRecentAttempt) mostRecentAttempt = last;
  }

  return { totalBlocks, byAction, earliestAttempt, mostRecentAttempt };
}
