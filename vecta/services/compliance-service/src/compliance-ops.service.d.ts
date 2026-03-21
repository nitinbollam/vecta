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
export type CaseType = 'KYC_MANUAL_REVIEW' | 'KYC_DOCUMENT_MISMATCH' | 'HIGH_VALUE_TRANSACTION' | 'VISA_EXPIRY_WARNING' | 'SUSPICIOUS_ACTIVITY' | 'CHECKR_ADVERSE_ACTION' | 'PLAID_CONNECTION_ERROR' | 'PROVIDER_FAILOVER';
export type CaseStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED_PASS' | 'RESOLVED_FAIL' | 'ESCALATED';
export type CasePriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export interface ComplianceCase {
    id: string;
    studentId: string;
    type: CaseType;
    status: CaseStatus;
    priority: CasePriority;
    triggeredBy: string;
    ruleVersion: string;
    evidence: Record<string, unknown>;
    assignedTo?: string;
    resolution?: string;
    resolvedAt?: string;
    createdAt: string;
}
export interface PolicyEvaluationResult {
    outcome: 'PASS' | 'FAIL' | 'REVIEW';
    ruleResults: Array<{
        rule: string;
        version: string;
        outcome: 'PASS' | 'FAIL' | 'REVIEW';
    }>;
    triggeredRules: string[];
}
export declare function evaluatePolicies(evidence: Record<string, unknown>, rulesToRun?: string[]): PolicyEvaluationResult;
export declare function openCase(params: {
    studentId: string;
    type: CaseType;
    priority: CasePriority;
    triggeredBy: string;
    ruleVersion: string;
    evidence: Record<string, unknown>;
}): Promise<string>;
export declare function resolveCase(params: {
    caseId: string;
    officerEmail: string;
    decision: 'RESOLVED_PASS' | 'RESOLVED_FAIL' | 'ESCALATED';
    rationale: string;
}): Promise<void>;
export declare function getOpenCases(options: {
    priority?: CasePriority;
    type?: CaseType;
    assignedTo?: string;
    limit?: number;
}): Promise<ComplianceCase[]>;
/**
 * Called when Didit biometrics return below-threshold scores.
 * Automatically opens a KYC review case and blocks token minting.
 */
export declare function escalateKYCFailure(params: {
    studentId: string;
    livenessScore: number;
    facialMatchScore: number;
    sessionId: string;
}): Promise<{
    action: 'BLOCK' | 'MANUAL_REVIEW';
    caseId?: string;
}>;
/**
 * Called when a transaction exceeds BSA thresholds.
 * Files a Currency Transaction Report (CTR) placeholder.
 */
export declare function checkTransactionCompliance(params: {
    studentId: string;
    amountUsd: number;
    txId: string;
    direction: 'CREDIT' | 'DEBIT';
}): Promise<{
    requiresCTR: boolean;
    caseId?: string;
}>;
/**
 * Called when Checkr returns an adverse action.
 * FCRA §615 requires written notice within 3 business days.
 */
export declare function handleAdverseAction(params: {
    studentId: string;
    reportId: string;
    adjudication: string;
}): Promise<{
    caseId: string;
    noticeDeadline: Date;
}>;
//# sourceMappingURL=compliance-ops.service.d.ts.map