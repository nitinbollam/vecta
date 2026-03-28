/**
 * services/compliance-service/src/compliance-ops.service.ts
 *
 * Compliance Operations — the "who is accountable" layer.
 *
 * This service answers the regulator's question:
 *   "Your system enforces rules — but who reviews exceptions?"
 *
 * Three components:
 *
 * 1. Human Review Queue
 *    Cases that the automated system cannot resolve are queued here.
 *    A compliance officer works the queue via the admin dashboard.
 *    Every decision is logged with officer ID, rationale, and timestamp.
 *
 * 2. AML / KYC Policy Engine
 *    Implements the written policies that a BSA officer would sign.
 *    Each rule is a named, versioned function that returns PASS/FAIL/REVIEW.
 *    Rules are auditable — the exact rule version that ran is recorded per case.
 *
 * 3. Escalation Flows
 *    Defines what happens at each KYC outcome and dollar threshold.
 *    Ties automated actions (block, freeze, notify) to human workflows.
 *
 * Written policies are in docs/COMPLIANCE_POLICIES.md.
 * This file is the machine-enforceable equivalent.
 */

import { query, queryOne, withTransaction } from '@vecta/database';
import { createLogger, logAuditEvent, logComplianceEvent } from '@vecta/logger';

const logger = createLogger('compliance-ops');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CaseType =
  | 'KYC_MANUAL_REVIEW'          // Didit liveness < threshold
  | 'KYC_DOCUMENT_MISMATCH'      // Passport data inconsistency
  | 'HIGH_VALUE_TRANSACTION'     // Single transaction > $10K (BSA trigger)
  | 'VISA_EXPIRY_WARNING'        // I-20 expires within 90 days
  | 'SUSPICIOUS_ACTIVITY'        // AML rule triggered
  | 'CHECKR_ADVERSE_ACTION'      // Background check failed — notice required
  | 'PLAID_CONNECTION_ERROR'     // Bank link error during LoC generation
  | 'PROVIDER_FAILOVER';         // Primary vendor switched to fallback

export type CaseStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED_PASS' | 'RESOLVED_FAIL' | 'ESCALATED';
export type CasePriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface ComplianceCase {
  id:           string;
  studentId:    string;
  type:         CaseType;
  status:       CaseStatus;
  priority:     CasePriority;
  triggeredBy:  string;        // system rule name that created this case
  ruleVersion:  string;        // semver — links to the policy doc
  evidence:     Record<string, unknown>;
  assignedTo?:  string;        // compliance officer email
  resolution?:  string;
  resolvedAt?:  string;
  createdAt:    string;
}

// ---------------------------------------------------------------------------
// AML / KYC policy rules
// Each rule is versioned — changing a rule creates a new version, not an edit.
// ---------------------------------------------------------------------------

interface PolicyRule {
  name:        string;
  version:     string;
  description: string;
  evaluate(evidence: Record<string, unknown>): 'PASS' | 'FAIL' | 'REVIEW';
}

const POLICY_RULES: PolicyRule[] = [
  {
    name:        'KYC_LIVENESS_THRESHOLD',
    version:     '1.0.0',
    description: 'Liveness score must be ≥ 0.92 (Didit threshold).',
    evaluate: (e) => {
      const score = e['livenessScore'] as number | undefined;
      if (score === undefined) return 'REVIEW';
      return score >= 0.92 ? 'PASS' : (score >= 0.80 ? 'REVIEW' : 'FAIL');
    },
  },
  {
    name:        'KYC_FACIAL_MATCH_THRESHOLD',
    version:     '1.0.0',
    description: 'Facial match score must be ≥ 0.90.',
    evaluate: (e) => {
      const score = e['facialMatchScore'] as number | undefined;
      if (score === undefined) return 'REVIEW';
      return score >= 0.90 ? 'PASS' : (score >= 0.75 ? 'REVIEW' : 'FAIL');
    },
  },
  {
    name:        'BSA_HIGH_VALUE_TRANSACTION',
    version:     '1.0.0',
    description: 'Transactions ≥ $10,000 require BSA Currency Transaction Report filing.',
    evaluate: (e) => {
      const amountUsd = e['amountUsd'] as number | undefined;
      if (!amountUsd) return 'PASS';
      if (amountUsd >= 10_000) return 'REVIEW';  // CTR filing required
      return 'PASS';
    },
  },
  {
    name:        'VISA_ACTIVE_CHECK',
    version:     '1.0.0',
    description: 'F-1 visa expiry year must be current year or future.',
    evaluate: (e) => {
      const expiryYear = e['visaExpiryYear'] as number | undefined;
      if (!expiryYear) return 'REVIEW';
      const thisYear = new Date().getFullYear();
      if (expiryYear < thisYear) return 'FAIL';
      if (expiryYear === thisYear) return 'REVIEW';  // expires this year
      return 'PASS';
    },
  },
  {
    name:        'ADVERSE_ACTION_NOTICE',
    version:     '1.0.0',
    description: 'Checkr adverse action requires written notice to applicant (FCRA §615).',
    evaluate: (e) => {
      const checkrStatus = e['checkrStatus'] as string | undefined;
      return checkrStatus === 'REJECTED' ? 'REVIEW' : 'PASS';
    },
  },
  {
    name:        'SOLVENCY_FLOOR',
    version:     '1.0.0',
    description: 'Verified balance must cover at least 3 months of target rent.',
    evaluate: (e) => {
      const balance     = e['verifiedBalanceUsd'] as number | undefined;
      const monthlyRent = e['monthlyRentTarget']  as number | undefined;
      if (!balance || !monthlyRent) return 'REVIEW';
      const months = balance / monthlyRent;
      if (months < 3)   return 'FAIL';
      if (months < 6)   return 'REVIEW';
      return 'PASS';
    },
  },
];

// ---------------------------------------------------------------------------
// Policy evaluation
// ---------------------------------------------------------------------------

export interface PolicyEvaluationResult {
  outcome:     'PASS' | 'FAIL' | 'REVIEW';
  ruleResults: Array<{ rule: string; version: string; outcome: 'PASS' | 'FAIL' | 'REVIEW' }>;
  triggeredRules: string[];   // rules that returned REVIEW or FAIL
}

export function evaluatePolicies(
  evidence: Record<string, unknown>,
  rulesToRun?: string[],   // if undefined, runs all rules
): PolicyEvaluationResult {
  const rules = rulesToRun
    ? POLICY_RULES.filter((r) => rulesToRun.includes(r.name))
    : POLICY_RULES;

  const ruleResults = rules.map((rule) => ({
    rule:    rule.name,
    version: rule.version,
    outcome: rule.evaluate(evidence),
  }));

  const triggeredRules = ruleResults
    .filter((r) => r.outcome !== 'PASS')
    .map((r) => r.rule);

  // Any FAIL → overall FAIL. Any REVIEW → overall REVIEW. All PASS → PASS.
  let outcome: 'PASS' | 'FAIL' | 'REVIEW' = 'PASS';
  for (const r of ruleResults) {
    if (r.outcome === 'FAIL')   { outcome = 'FAIL';   break; }
    if (r.outcome === 'REVIEW') { outcome = 'REVIEW'; }
  }

  return { outcome, ruleResults, triggeredRules };
}

// ---------------------------------------------------------------------------
// Case management
// ---------------------------------------------------------------------------

export async function openCase(params: {
  studentId:   string;
  type:        CaseType;
  priority:    CasePriority;
  triggeredBy: string;
  ruleVersion: string;
  evidence:    Record<string, unknown>;
}): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO compliance_cases
       (student_id, type, status, priority, triggered_by, rule_version, evidence)
     VALUES ($1,$2,'OPEN',$3,$4,$5,$6)
     RETURNING id`,
    [
      params.studentId,
      params.type,
      params.priority,
      params.triggeredBy,
      params.ruleVersion,
      JSON.stringify(params.evidence),
    ],
  );

  const caseId = result!.id;

  logComplianceEvent('COMPLIANCE_CASE_OPENED', params.studentId, {
    caseId,
    type:       params.type,
    priority:   params.priority,
    triggeredBy: params.triggeredBy,
  });

  logger.info({ caseId, type: params.type, priority: params.priority }, 'Compliance case opened');

  // Auto-assign to compliance queue and trigger notification
  await notifyComplianceTeam(caseId, params.type, params.priority);

  return caseId;
}

export async function resolveCase(params: {
  caseId:       string;
  officerEmail: string;
  decision:     'RESOLVED_PASS' | 'RESOLVED_FAIL' | 'ESCALATED';
  rationale:    string;
}): Promise<void> {
  await withTransaction(async (client) => {
    const updated = await client.query<{ student_id: string; type: string }>(
      `UPDATE compliance_cases
       SET status      = $2,
           assigned_to = $3,
           resolution  = $4,
           resolved_at = NOW(),
           updated_at  = NOW()
       WHERE id = $1
         AND status NOT IN ('RESOLVED_PASS','RESOLVED_FAIL')
       RETURNING student_id, type`,
      [params.caseId, params.decision, params.officerEmail, params.rationale],
    );

    if (updated.rowCount === 0) {
      throw new Error(`Case ${params.caseId} not found or already resolved`);
    }

    const row = updated.rows[0]!;

    logAuditEvent('COMPLIANCE_CASE_RESOLVED', params.officerEmail, params.caseId, {
      decision:  params.decision,
      rationale: params.rationale,
      studentId: row.student_id,
      caseType:  row.type,
    });
  });

  logger.info({ caseId: params.caseId, decision: params.decision }, 'Compliance case resolved');
}

export async function getOpenCases(options: {
  priority?:    CasePriority;
  type?:        CaseType;
  assignedTo?:  string;
  limit?:       number;
}): Promise<ComplianceCase[]> {
  const conditions = ["status IN ('OPEN','IN_REVIEW','ESCALATED')"];
  const values: unknown[] = [];
  let idx = 1;

  if (options.priority)   { conditions.push(`priority = $${idx++}`);    values.push(options.priority); }
  if (options.type)       { conditions.push(`type = $${idx++}`);        values.push(options.type); }
  if (options.assignedTo) { conditions.push(`assigned_to = $${idx++}`); values.push(options.assignedTo); }

  values.push(options.limit ?? 50);

  const result = await query<{
    id: string; student_id: string; type: string; status: string;
    priority: string; triggered_by: string; rule_version: string;
    evidence: unknown; assigned_to: string | null; resolution: string | null;
    resolved_at: string | null; created_at: string;
  }>(
    `SELECT id, student_id, type, status, priority, triggered_by, rule_version,
            evidence, assigned_to, resolution, resolved_at, created_at
     FROM compliance_cases
     WHERE ${conditions.join(' AND ')}
     ORDER BY
       CASE priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
       created_at ASC
     LIMIT $${idx}`,
    values,
  );

  return result.rows.map((r) => ({
    id:          r.id,
    studentId:   r.student_id,
    type:        r.type as CaseType,
    status:      r.status as CaseStatus,
    priority:    r.priority as CasePriority,
    triggeredBy: r.triggered_by,
    ruleVersion: r.rule_version,
    evidence:    typeof r.evidence === 'string' ? JSON.parse(r.evidence) : (r.evidence as Record<string, unknown>),
    assignedTo:  r.assigned_to ?? undefined,
    resolution:  r.resolution ?? undefined,
    resolvedAt:  r.resolved_at ?? undefined,
    createdAt:   r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Escalation flows — called by service layer after automated decisions
// ---------------------------------------------------------------------------

/**
 * Called when Didit biometrics return below-threshold scores.
 * Automatically opens a KYC review case and blocks token minting.
 */
export async function escalateKYCFailure(params: {
  studentId:    string;
  livenessScore:    number;
  facialMatchScore: number;
  sessionId:        string;
}): Promise<{ action: 'BLOCK' | 'MANUAL_REVIEW'; caseId?: string }> {
  const evidence = { ...params };
  const evaluation = evaluatePolicies(evidence, [
    'KYC_LIVENESS_THRESHOLD',
    'KYC_FACIAL_MATCH_THRESHOLD',
  ]);

  if (evaluation.outcome === 'PASS') {
    return { action: 'MANUAL_REVIEW' };  // Shouldn't happen but defensive
  }

  const priority: CasePriority =
    evaluation.outcome === 'FAIL' ? 'HIGH' : 'MEDIUM';

  const caseId = await openCase({
    studentId:   params.studentId,
    type:        'KYC_MANUAL_REVIEW',
    priority,
    triggeredBy: 'escalateKYCFailure',
    ruleVersion: '1.0.0',
    evidence,
  });

  return {
    action:  evaluation.outcome === 'FAIL' ? 'BLOCK' : 'MANUAL_REVIEW',
    caseId,
  };
}

/**
 * Called when a transaction exceeds BSA thresholds.
 * Files a Currency Transaction Report (CTR) placeholder.
 */
export async function checkTransactionCompliance(params: {
  studentId:  string;
  amountUsd:  number;
  txId:       string;
  direction:  'CREDIT' | 'DEBIT';
}): Promise<{ requiresCTR: boolean; caseId?: string }> {
  const evaluation = evaluatePolicies(
    { amountUsd: params.amountUsd },
    ['BSA_HIGH_VALUE_TRANSACTION'],
  );

  if (evaluation.outcome === 'PASS') {
    return { requiresCTR: false };
  }

  const caseId = await openCase({
    studentId:   params.studentId,
    type:        'HIGH_VALUE_TRANSACTION',
    priority:    'CRITICAL',
    triggeredBy: 'checkTransactionCompliance',
    ruleVersion: '1.0.0',
    evidence:    { ...params, evaluationResult: evaluation },
  });

  logComplianceEvent('BSA_CTR_TRIGGER', params.studentId, {
    amountUsd:  params.amountUsd,
    txId:       params.txId,
    caseId,
  });

  return { requiresCTR: true, caseId };
}

/**
 * Called when Checkr returns an adverse action.
 * FCRA §615 requires written notice within 3 business days.
 */
export async function handleAdverseAction(params: {
  studentId:    string;
  reportId:     string;
  adjudication: string;
}): Promise<{ caseId: string; noticeDeadline: Date }> {
  const caseId = await openCase({
    studentId:   params.studentId,
    type:        'CHECKR_ADVERSE_ACTION',
    priority:    'HIGH',
    triggeredBy: 'handleAdverseAction',
    ruleVersion: '1.0.0',
    evidence:    params,
  });

  // FCRA: 3 business days for pre-adverse notice, 5 for final
  const noticeDeadline = new Date();
  noticeDeadline.setDate(noticeDeadline.getDate() + 3);

  logComplianceEvent('ADVERSE_ACTION_NOTICE_REQUIRED', params.studentId, {
    caseId,
    reportId:    params.reportId,
    deadline:    noticeDeadline.toISOString(),
    regulation:  'FCRA §615',
  });

  return { caseId, noticeDeadline };
}

// ---------------------------------------------------------------------------
// Notification (stub — implement with email/Slack in production)
// ---------------------------------------------------------------------------

async function notifyComplianceTeam(
  caseId:   string,
  type:     CaseType,
  priority: CasePriority,
): Promise<void> {
  // In production: POST to Slack webhook or email compliance@vecta.io
  const urgent = priority === 'CRITICAL' || priority === 'HIGH';

  logger.info(
    { caseId, type, priority, urgent },
    urgent ? 'COMPLIANCE ALERT: New case requires immediate review' : 'New compliance case opened',
  );

  // TODO: Slack webhook
  // await fetch(process.env.SLACK_COMPLIANCE_WEBHOOK ?? '', {
  //   method: 'POST',
  //   body: JSON.stringify({
  //     text: `${urgent ? '🚨' : '📋'} *[${priority}] ${type}*\nCase: ${caseId}`,
  //   }),
  // });
}
