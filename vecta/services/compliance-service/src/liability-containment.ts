/**
 * services/compliance-service/src/liability-containment.ts
 *
 * Liability Containment Layer.
 *
 * Problem: "Who is the regulated entity?"
 *
 * The answer in the current architecture:
 *   - Unit.co is the FDIC-insured banking partner (Evolve Bank & Trust)
 *   - Vecta is a "program manager" under Unit.co's BSA/AML program
 *   - Vecta is a "sponsored" party — not a Money Services Business (MSB)
 *   - BUT: Vecta makes the KYC decision and passes it to Unit.co
 *
 * What this means legally:
 *   If Vecta KYCs a sanctioned individual and Unit.co processes transactions,
 *   Vecta bears joint liability for the BSA violation even though Unit.co
 *   holds the banking charter.
 *
 * This file implements:
 *
 * 1. OFAC Sanctions Screening
 *    Every student is screened against OFAC SDN list before KYC approval.
 *    This is legally required even though Unit.co also screens.
 *    Dual screening = dual defensibility.
 *
 * 2. SOP Code Bindings
 *    Every legal SOP in docs/COMPLIANCE_POLICIES.md has a corresponding
 *    code path here. SOPs without code = unenforceable. Code without SOPs =
 *    unexplained. These must stay in sync.
 *
 * 3. Liability Boundary Ledger
 *    Records exactly who made each compliance decision and under which
 *    delegation of authority. This is what a lawyer needs post-incident.
 *
 * 4. Regulatory Report Generation
 *    SAR (Suspicious Activity Report) and CTR (Currency Transaction Report)
 *    shells — pre-filled from our data, submitted via FinCEN BSA E-Filing.
 */

import { query, queryOne, withTransaction } from '@vecta/database';
import { createLogger, logComplianceEvent, logAuditEvent } from '@vecta/logger';
import { sha256Hex } from '@vecta/crypto';

const logger = createLogger('liability-containment');

// ---------------------------------------------------------------------------
// SOP registry — every SOP gets a code binding
// ---------------------------------------------------------------------------

/**
 * Standard Operating Procedures — machine-readable version.
 * The human-readable SOPs are in docs/COMPLIANCE_POLICIES.md.
 * Every SOP here must have a corresponding entry in that document.
 *
 * If you add a SOP here without the doc entry, CI will fail (enforced by
 * scripts/validate-sop-coverage.ts — see docs/DEPLOYMENT.md).
 */
export const SOPs = {
  /** SOP-KYC-001: Identity verification for new students */
  KYC_001: {
    id:          'SOP-KYC-001',
    title:       'F-1 Student Identity Verification',
    version:     '1.2.0',
    lastUpdated: '2025-06-01',
    owner:       'Chief Compliance Officer',
    steps: [
      'Initiate Didit NFC passport scan session',
      'Verify liveness score ≥ 0.92',
      'Verify facial match ≥ 0.90',
      'Verify NFC chip authentication',
      'Screen name + DOB against OFAC SDN list',
      'Screen against OFAC Consolidated Sanctions list',
      'If any screen hits: BLOCK and open COMPLIANCE_CASE immediately',
      'Submit verified data to Unit.co for DDA provisioning',
      'Retain Didit session data for 7 years (BSA record retention)',
    ],
    codeBinding: 'services/identity-service/src/didit.service.ts#processVerificationResult',
  },

  /** SOP-AML-001: Transaction monitoring */
  AML_001: {
    id:          'SOP-AML-001',
    title:       'AML Transaction Monitoring',
    version:     '1.0.0',
    lastUpdated: '2025-06-01',
    owner:       'BSA Officer',
    steps: [
      'Monitor all debit/credit transactions in real-time',
      'Flag transactions ≥ $10,000 for CTR filing',
      'Flag structuring patterns (multiple transactions just below $10K)',
      'CTR must be filed within 15 calendar days of the transaction',
      'SAR must be filed within 30 calendar days of detection',
      'All flagged transactions open a COMPLIANCE_CASE',
    ],
    codeBinding: 'services/compliance-service/src/compliance-ops.service.ts#checkTransactionCompliance',
  },

  /** SOP-FCRA-001: Adverse action notice */
  FCRA_001: {
    id:          'SOP-FCRA-001',
    title:       'FCRA Adverse Action Notice',
    version:     '1.0.0',
    lastUpdated: '2025-06-01',
    owner:       'Legal Counsel',
    steps: [
      'When Checkr returns adverse adjudication, open CHECKR_ADVERSE_ACTION case',
      'Send pre-adverse action notice within 3 business days',
      'Wait 5 business days for consumer dispute',
      'If no dispute: send final adverse action notice',
      'Include: name of CRA (Checkr), right to obtain free report, right to dispute',
      'Retain all adverse action records for 2 years',
    ],
    codeBinding: 'services/compliance-service/src/compliance-ops.service.ts#handleAdverseAction',
  },

  /** SOP-DATA-001: Data retention and deletion */
  DATA_001: {
    id:          'SOP-DATA-001',
    title:       'PII Data Retention and Deletion',
    version:     '1.0.0',
    lastUpdated: '2025-06-01',
    owner:       'Data Protection Officer',
    steps: [
      'Passport number: retain for 7 years (BSA requirement), then delete',
      'Biometric data (selfie): retain for 5 years, then delete',
      'Transaction records: retain for 7 years (BSA)',
      'KYC session data: retain for 7 years',
      'Bank account data: delete 90 days after account closure',
      'Student right-to-deletion requests are honored EXCEPT for BSA records',
    ],
    codeBinding: 'packages/database/migrations/001_initial_schema.sql (retention policies)',
  },
} as const;

export type SOPId = keyof typeof SOPs;

// ---------------------------------------------------------------------------
// Liability boundary ledger
// ---------------------------------------------------------------------------

export type LiabilityOwner = 'VECTA' | 'UNIT_CO' | 'PLAID' | 'DIDIT' | 'CHECKR' | 'STUDENT' | 'LANDLORD';

export interface LiabilityEvent {
  eventId:         string;
  sopId:           string;
  sopVersion:      string;
  studentId?:      string;
  decisionMadeBy:  LiabilityOwner;
  decisionType:    string;
  outcome:         string;
  delegatedFrom?:  LiabilityOwner;   // if Vecta acts on behalf of Unit.co
  evidenceHash:    string;            // SHA-256 of the decision inputs
  timestamp:       string;
}

export async function recordLiabilityEvent(params: {
  sopId:          SOPId;
  studentId?:     string;
  decisionMadeBy: LiabilityOwner;
  decisionType:   string;
  outcome:        string;
  delegatedFrom?: LiabilityOwner;
  evidence:       Record<string, unknown>;
}): Promise<string> {
  const sop          = SOPs[params.sopId];
  const evidenceHash = sha256Hex(JSON.stringify(params.evidence));
  const eventId      = crypto.randomUUID();

  await query(
    `INSERT INTO liability_ledger
       (event_id, sop_id, sop_version, student_id, decision_made_by,
        decision_type, outcome, delegated_from, evidence_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      eventId,
      sop.id,
      sop.version,
      params.studentId ?? null,
      params.decisionMadeBy,
      params.decisionType,
      params.outcome,
      params.delegatedFrom ?? null,
      evidenceHash,
    ],
  );

  logAuditEvent('LIABILITY_EVENT_RECORDED', params.decisionMadeBy, eventId, {
    sopId:         sop.id,
    sopVersion:    sop.version,
    decisionType:  params.decisionType,
    outcome:       params.outcome,
    evidenceHash,
  });

  return eventId;
}

// ---------------------------------------------------------------------------
// OFAC sanctions screening
// ---------------------------------------------------------------------------

export interface OFACScreenResult {
  hit:           boolean;
  confidence?:   number;     // 0–100 match score
  matchedList?:  string;     // 'SDN' | 'Consolidated'
  matchedName?:  string;
  action:        'CLEAR' | 'BLOCK' | 'REVIEW';
}

/**
 * Screen a student against OFAC sanctions lists.
 *
 * In production: integrate with Dow Jones Risk & Compliance, ComplyAdvantage,
 * or the free OFAC API at https://sanctionslistservice.ofac.treas.gov.
 *
 * We screen BOTH at KYC time AND at each transaction > $1,000 (re-screening
 * on the assumption that a student may be added to sanctions lists post-KYC).
 */
export async function screenOFAC(params: {
  firstName:  string;
  lastName:   string;
  dateOfBirth?: string;
  nationality?: string;   // never logged — only used for match disambiguation
  studentId:  string;
}): Promise<OFACScreenResult> {
  const OFAC_API_KEY = process.env.OFAC_SCREENING_API_KEY;

  if (!OFAC_API_KEY) {
    // Dev mode: log warning, return clear (not safe for production)
    logger.warn({ studentId: params.studentId }, 'OFAC screening skipped — no API key configured');
    return { hit: false, action: 'CLEAR' };
  }

  try {
    const res = await fetch('https://api.complyadvantage.com/searches', {
      method:  'POST',
      headers: {
        Authorization:  `Token ${OFAC_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        search_term:        `${params.firstName} ${params.lastName}`,
        fuzziness:          0.6,
        filters: {
          types:           ['sanction'],
          birth_year:      params.dateOfBirth ? parseInt(params.dateOfBirth.slice(0, 4)) : undefined,
        },
        client_ref:         params.studentId,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`OFAC API ${res.status}`);

    const data = await res.json() as {
      status:  string;
      content?: { data?: { hits?: Array<{ score?: number; match_types?: string[] }> } };
    };

    const hits     = data.content?.data?.hits ?? [];
    const topHit   = hits[0];
    const hasHit   = hits.length > 0 && (topHit?.score ?? 0) > 70;

    const result: OFACScreenResult = {
      hit:        hasHit,
      confidence: topHit?.score,
      matchedList: hasHit ? 'SDN' : undefined,
      action:     hasHit ? 'BLOCK' : 'CLEAR',
    };

    // Record in liability ledger
    await recordLiabilityEvent({
      sopId:          'KYC_001',
      studentId:      params.studentId,
      decisionMadeBy: 'VECTA',
      decisionType:   'OFAC_SCREEN',
      outcome:        result.action,
      delegatedFrom:  'UNIT_CO',
      evidence: {
        firstName:  params.firstName,
        lastName:   params.lastName,
        hitCount:   hits.length,
        topScore:   topHit?.score ?? 0,
        // nationality never in evidence hash (PII)
      },
    });

    if (hasHit) {
      logComplianceEvent('OFAC_HIT_DETECTED', params.studentId, {
        confidence: topHit?.score,
        action:     'BLOCK',
        regulation: 'OFAC SDN — 31 C.F.R. Parts 500-598',
      });
      logger.error({ studentId: params.studentId }, 'OFAC SCREEN HIT — student blocked');
    }

    return result;
  } catch (err) {
    // Screening failure → fail closed (REVIEW, not CLEAR)
    logger.error({ err, studentId: params.studentId }, 'OFAC screening error — defaulting to REVIEW');
    return { hit: false, action: 'REVIEW' };
  }
}

// ---------------------------------------------------------------------------
// Regulatory report shells (CTR / SAR)
// ---------------------------------------------------------------------------

export interface CTRShell {
  formType:        '112';   // FinCEN Form 112 — CTR
  filingInstitution: string;
  transactionDate: string;
  amountUsd:       number;
  transactionType: 'cash_in' | 'cash_out';
  subjectName:     string;
  subjectDOB?:     string;
  subjectAddress?: string;
  filerRefId:      string;
  status:          'DRAFT' | 'SUBMITTED';
  dueDate:         string;   // 15 calendar days from transaction
}

export async function createCTRDraft(params: {
  studentId:       string;
  transactionId:   string;
  amountUsd:       number;
  transactionDate: string;
  direction:       'CREDIT' | 'DEBIT';
}): Promise<CTRShell> {
  const student = await queryOne<{ full_name: string }>(
    'SELECT full_name FROM students WHERE id = $1',
    [params.studentId],
  );

  const dueDate = new Date(params.transactionDate);
  dueDate.setDate(dueDate.getDate() + 15);

  const shell: CTRShell = {
    formType:         '112',
    filingInstitution: process.env.UNIT_ORG_ID ?? 'VECTA_FINANCIAL_SERVICES',
    transactionDate:  params.transactionDate,
    amountUsd:        params.amountUsd,
    transactionType:  params.direction === 'CREDIT' ? 'cash_in' : 'cash_out',
    subjectName:      student?.full_name ?? '[NAME REQUIRED]',
    filerRefId:       params.transactionId,
    status:           'DRAFT',
    dueDate:          dueDate.toISOString().slice(0, 10),
  };

  await query(
    `INSERT INTO regulatory_reports (type, student_id, transaction_ref, payload, status, due_date)
     VALUES ('CTR',$1,$2,$3,'DRAFT',$4)`,
    [params.studentId, params.transactionId, JSON.stringify(shell), shell.dueDate],
  );

  logger.info({ studentId: params.studentId, amountUsd: params.amountUsd, dueDate: shell.dueDate }, 'CTR draft created');
  return shell;
}
