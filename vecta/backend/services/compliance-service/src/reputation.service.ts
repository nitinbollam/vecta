import { query } from '@vecta/database';
import { createLogger } from '@vecta/logger';
import crypto from 'crypto';

const logger = createLogger('reputation-service');

export interface ReputationScore {
  score: number;
  tier: 'BUILDING' | 'FAIR' | 'GOOD' | 'EXCELLENT';
  onTimePayments: number;
  totalPayments: number;
  repaymentRate: number;
  monthsOfHistory: number;
}

export const REPUTATION_EVENT_TYPES = [
  'RENT_PAYMENT_ONTIME',
  'RENT_PAYMENT_LATE',
  'LEASE_COMPLETED',
  'IDENTITY_VERIFIED',
  'BANK_ACCOUNT_MAINTAINED',
  'INSURANCE_MAINTAINED',
  'VISA_RENEWED',
  'UNIVERSITY_ENROLLED',
  'ESIM_ACTIVE',
  'REFERRAL_PLACED',
] as const;

export type ReputationEventType = (typeof REPUTATION_EVENT_TYPES)[number];

const WEIGHTS: Record<ReputationEventType, number> = {
  RENT_PAYMENT_ONTIME:        15,
  RENT_PAYMENT_LATE:          -25,
  LEASE_COMPLETED:            30,
  IDENTITY_VERIFIED:          50,
  BANK_ACCOUNT_MAINTAINED:    5,
  INSURANCE_MAINTAINED:       5,
  VISA_RENEWED:               20,
  UNIVERSITY_ENROLLED:        10,
  ESIM_ACTIVE:                3,
  REFERRAL_PLACED:            20,
};

export async function calculateReputationScore(studentId: string): Promise<ReputationScore> {
  const events = await query<{
    event_type: string;
    event_date: string;
    amount_cents: number | null;
  }>(
    `SELECT event_type, event_date, amount_cents
     FROM reputation_events
     WHERE student_id = $1
     ORDER BY event_date ASC`,
    [studentId],
  );

  let score = 300;
  let onTimePayments = 0;
  let totalPayments = 0;
  let firstEventDate: Date | null = null;

  for (const event of events.rows) {
    const w = WEIGHTS[event.event_type as ReputationEventType];
    score += w ?? 0;

    if (event.event_type === 'RENT_PAYMENT_ONTIME') onTimePayments++;
    if (event.event_type.startsWith('RENT_PAYMENT')) totalPayments++;

    if (!firstEventDate) firstEventDate = new Date(event.event_date);
  }

  score = Math.max(300, Math.min(850, score));

  const repaymentRate = totalPayments > 0 ? onTimePayments / totalPayments : 0;
  const monthsOfHistory = firstEventDate
    ? Math.floor((Date.now() - firstEventDate.getTime()) / (30 * 24 * 60 * 60 * 1000))
    : 0;

  const tier: ReputationScore['tier'] =
    score >= 700 ? 'EXCELLENT' :
      score >= 600 ? 'GOOD' :
        score >= 500 ? 'FAIR' :
          'BUILDING';

  return { score, tier, onTimePayments, totalPayments, repaymentRate, monthsOfHistory };
}

export async function updateReputationScore(studentId: string): Promise<ReputationScore> {
  const result = await calculateReputationScore(studentId);

  await query(
    `INSERT INTO reputation_scores
       (student_id, score, on_time_payments, total_payments, repayment_rate, months_of_history, tier, last_calculated)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (student_id) DO UPDATE SET
       score = EXCLUDED.score,
       on_time_payments = EXCLUDED.on_time_payments,
       total_payments = EXCLUDED.total_payments,
       repayment_rate = EXCLUDED.repayment_rate,
       months_of_history = EXCLUDED.months_of_history,
       tier = EXCLUDED.tier,
       last_calculated = NOW(),
       updated_at = NOW()`,
    [
      studentId,
      result.score,
      result.onTimePayments,
      result.totalPayments,
      result.repaymentRate,
      result.monthsOfHistory,
      result.tier,
    ],
  );

  logger.info({ studentId, score: result.score, tier: result.tier }, 'Reputation score updated');
  return result;
}

export async function recordReputationEvent(params: {
  studentId: string;
  eventType: ReputationEventType;
  verifiedBy: string;
  amountCents?: number;
  landlordId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `INSERT INTO reputation_events
       (student_id, event_type, verified_by, amount_cents, landlord_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      params.studentId,
      params.eventType,
      params.verifiedBy,
      params.amountCents ?? null,
      params.landlordId ?? null,
      params.metadata ?? {},
    ],
  );

  await updateReputationScore(params.studentId);
}

export async function anchorDailyReputationSnapshot(): Promise<void> {
  const scores = await query<{
    student_id: string;
    score: number;
    tier: string;
    last_calculated: string;
  }>('SELECT student_id, score, tier, last_calculated FROM reputation_scores');

  const scoreData = scores.rows
    .slice()
    .sort((a, b) => a.student_id.localeCompare(b.student_id))
    .map((r) => `${r.student_id}:${r.score}:${r.tier}`)
    .join('|');

  const scoresHash = crypto.createHash('sha256').update(scoreData).digest('hex');

  const { createPublicAnchor } = await import('../../audit-service/src/public-anchor-log');
  const anchor = await createPublicAnchor({
    anchorId: crypto.randomUUID(),
    chainTipHash: scoresHash,
    anchorType: 'GLOBAL_CHECKPOINT',
    fullManifest: {
      type: 'REPUTATION_SNAPSHOT',
      date: new Date().toISOString(),
      studentCount: scores.rows.length,
      scoresHash,
    },
  });

  await query(
    `INSERT INTO reputation_anchors
       (anchor_date, student_count, scores_hash, github_gist_line, s3_url)
     VALUES (CURRENT_DATE, $1, $2, $3, $4)
     ON CONFLICT (anchor_date) DO NOTHING`,
    [scores.rows.length, scoresHash, anchor.gistLineNumber ?? null, anchor.manifestUrl],
  );

  logger.info(
    { studentCount: scores.rows.length, scoresHash: scoresHash.slice(0, 16) },
    'Daily reputation snapshot anchored',
  );
}
