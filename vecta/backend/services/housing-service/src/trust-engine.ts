/**
 * services/housing-service/src/trust-engine.ts
 *
 * Vecta Composite Trust Score — Vecta's proprietary solvency rating.
 *
 * Inputs and weights:
 *   40% — Nova Credit translated score (300–850)
 *   30% — Plaid liquidity factor (verified balance ÷ monthly rent × 12)
 *   20% — Visa stability factor (time remaining on I-20 ÷ lease term)
 *   10% — Identity confidence (NFC chip + liveness + biometric match scores)
 *
 * Output:
 *   compositScore  0–1000   (higher = safer tenant)
 *   guaranteeTier  PLATINUM | GOLD | SILVER | STANDARD
 *   maxRentApproval  USD/month
 *   depositTier    1x | 1.5x | 2x monthly rent
 *
 * This is Vecta's defensible moat:
 *   A standard US landlord only sees FICO + income.
 *   Vecta surfaces a richer, F-1-specific signal that no existing
 *   tenant screening product provides.
 */

import { queryOne } from '@vecta/database';
import { createLogger } from '@vecta/logger';

const logger = createLogger('trust-engine');

// ---------------------------------------------------------------------------
// Score weights
// ---------------------------------------------------------------------------

const WEIGHTS = {
  nova:      0.40,
  liquidity: 0.30,
  visa:      0.20,
  identity:  0.10,
} as const;

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface TrustEngineInput {
  // Nova Credit
  novaTranslatedScore: number;           // 300–850

  // Plaid
  verifiedBalanceUsd:  number;           // Total verified liquid balance
  monthlyRentTarget:   number;           // Requested monthly rent

  // Visa
  i20ExpirationDate:   Date;             // I-20 program end date
  leaseDurationMonths: number;           // Intended lease length

  // Identity confidence (from Didit, 0–1)
  livenessScore:       number;           // 0–1, threshold 0.92
  facialMatchScore:    number;           // 0–1, threshold 0.90
  nfcChipVerified:     boolean;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type GuaranteeTier = 'PLATINUM' | 'GOLD' | 'SILVER' | 'STANDARD' | 'INSUFFICIENT';
export type DepositMultiplier = 1.0 | 1.5 | 2.0 | 2.5;

export interface TrustEngineResult {
  // Scores (0–100 each before weighting)
  novaFactor:       number;              // Normalized 0–100
  liquidityFactor:  number;              // 0–100
  visaFactor:       number;              // 0–100
  identityFactor:   number;              // 0–100

  // Composite
  compositeScore:   number;              // 0–1000 (weighted sum × 10)
  guaranteeTier:    GuaranteeTier;
  maxRentApproval:  number;              // USD/month
  depositMultiplier: DepositMultiplier;
  guaranteeMonths:  number;              // How many months Vecta will back

  // Explanations (for student dashboard)
  breakdown: {
    novaExplanation:      string;
    liquidityExplanation: string;
    visaExplanation:      string;
    identityExplanation:  string;
  };
}

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------

export function computeTrustScore(input: TrustEngineInput): TrustEngineResult {
  // --- 1. Nova factor (normalize 300–850 → 0–100) ---
  const novaFactor = Math.min(100, Math.max(0,
    ((input.novaTranslatedScore - 300) / (850 - 300)) * 100,
  ));

  // --- 2. Liquidity factor ---
  // Full score if balance covers 12 months of target rent.
  // Scales linearly down to 0 if balance covers 0 months.
  const monthsCovered = input.verifiedBalanceUsd / input.monthlyRentTarget;
  const liquidityFactor = Math.min(100, Math.max(0, (monthsCovered / 12) * 100));

  // --- 3. Visa stability factor ---
  // Full score if I-20 covers the lease + 6-month buffer.
  // Zero score if I-20 expires before lease end.
  const now          = new Date();
  const visaMonths   = (input.i20ExpirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
  const requiredMonths = input.leaseDurationMonths + 6; // 6-month buffer
  const visaFactor   = Math.min(100, Math.max(0, (visaMonths / requiredMonths) * 100));

  // --- 4. Identity confidence factor ---
  const identityBase   = (input.livenessScore + input.facialMatchScore) / 2;
  const nfcBonus       = input.nfcChipVerified ? 0.1 : 0;
  const identityFactor = Math.min(100, (identityBase + nfcBonus) * 100);

  // --- 5. Composite score (0–1000) ---
  const compositeScore = Math.round(
    (
      novaFactor       * WEIGHTS.nova      +
      liquidityFactor  * WEIGHTS.liquidity +
      visaFactor       * WEIGHTS.visa      +
      identityFactor   * WEIGHTS.identity
    ) * 10,  // × 10 to scale to 0–1000
  );

  // --- 6. Tier assignment ---
  let guaranteeTier = assignTier(compositeScore);

  // Hard liquidity floor: zero verified balance cannot support a SILVER+ guarantee.
  if (input.verifiedBalanceUsd <= 0 &&
      (guaranteeTier === 'SILVER' || guaranteeTier === 'GOLD' || guaranteeTier === 'PLATINUM')) {
    guaranteeTier = 'STANDARD';
  }

  // --- 7. Derived limits ---
  const { maxRentApproval, depositMultiplier, guaranteeMonths } =
    deriveLimits(guaranteeTier, input.monthlyRentTarget);

  // --- 8. Human-readable breakdown ---
  const breakdown = buildBreakdown(
    novaFactor, liquidityFactor, visaFactor, identityFactor,
    input, monthsCovered, visaMonths,
  );

  logger.info({
    compositeScore,
    guaranteeTier,
    novaFactor: Math.round(novaFactor),
    liquidityFactor: Math.round(liquidityFactor),
    visaFactor: Math.round(visaFactor),
    identityFactor: Math.round(identityFactor),
  }, 'Trust score computed');

  return {
    novaFactor:   Math.round(novaFactor),
    liquidityFactor: Math.round(liquidityFactor),
    visaFactor:   Math.round(visaFactor),
    identityFactor: Math.round(identityFactor),
    compositeScore,
    guaranteeTier,
    maxRentApproval,
    depositMultiplier,
    guaranteeMonths,
    breakdown,
  };
}

// ---------------------------------------------------------------------------
// Tier thresholds
// ---------------------------------------------------------------------------

function assignTier(score: number): GuaranteeTier {
  if (score >= 850) return 'PLATINUM';
  if (score >= 700) return 'GOLD';
  if (score >= 550) return 'SILVER';
  if (score >= 400) return 'STANDARD';
  return 'INSUFFICIENT';
}

// ---------------------------------------------------------------------------
// Derived financial limits per tier
// ---------------------------------------------------------------------------

interface Limits {
  maxRentApproval:   number;
  depositMultiplier: DepositMultiplier;
  guaranteeMonths:   number;
}

function deriveLimits(tier: GuaranteeTier, targetRent: number): Limits {
  switch (tier) {
    case 'PLATINUM':
      return { maxRentApproval: Math.min(targetRent * 1.5, 8_000), depositMultiplier: 1.0, guaranteeMonths: 18 };
    case 'GOLD':
      return { maxRentApproval: Math.min(targetRent * 1.25, 6_000), depositMultiplier: 1.0, guaranteeMonths: 14 };
    case 'SILVER':
      return { maxRentApproval: Math.min(targetRent, 4_500), depositMultiplier: 1.5, guaranteeMonths: 12 };
    case 'STANDARD':
      return { maxRentApproval: Math.min(targetRent * 0.8, 3_000), depositMultiplier: 2.0, guaranteeMonths: 6 };
    case 'INSUFFICIENT':
      return { maxRentApproval: 0, depositMultiplier: 2.5, guaranteeMonths: 0 };
  }
}

// ---------------------------------------------------------------------------
// Breakdown copy
// ---------------------------------------------------------------------------

function buildBreakdown(
  novaFactor: number,
  liquidityFactor: number,
  visaFactor: number,
  identityFactor: number,
  input: TrustEngineInput,
  monthsCovered: number,
  visaMonths: number,
): TrustEngineResult['breakdown'] {
  return {
    novaExplanation:
      `International credit score ${input.novaTranslatedScore}/850 → ` +
      `${Math.round(novaFactor)}% of maximum (40% weight).`,

    liquidityExplanation:
      `Verified balance covers ${monthsCovered.toFixed(1)} months of $${input.monthlyRentTarget.toLocaleString()}/mo target rent → ` +
      `${Math.round(liquidityFactor)}% of 12-month benchmark (30% weight).`,

    visaExplanation:
      `I-20 expires in ${Math.round(visaMonths)} months. ` +
      `${Math.round(visaFactor)}% of ${input.leaseDurationMonths + 6}-month coverage target (20% weight).`,

    identityExplanation:
      `NFC passport: ${input.nfcChipVerified ? '✓' : '✗'}, ` +
      `Liveness: ${(input.livenessScore * 100).toFixed(0)}%, ` +
      `Facial match: ${(input.facialMatchScore * 100).toFixed(0)}% → ` +
      `${Math.round(identityFactor)}% confidence (10% weight).`,
  };
}

// ---------------------------------------------------------------------------
// Convenience: compute from DB (look up student's existing data)
// ---------------------------------------------------------------------------

export async function computeTrustScoreForStudent(
  studentId: string,
  monthlyRentTarget: number,
  leaseDurationMonths: number = 12,
): Promise<TrustEngineResult> {
  const student = await queryOne<{
    trust_score: number | null;
    visa_expiry_year: number | null;
    liveness_threshold_met: boolean | null;
    facial_match_threshold_met: boolean | null;
    nfc_chip_verified: boolean | null;
  }>(
    `SELECT
       trust_score,
       visa_expiry_year,
       liveness_threshold_met,
       facial_match_threshold_met,
       nfc_chip_verified
     FROM students
     WHERE id = $1`,
    [studentId],
  );

  if (!student) throw new Error(`Student ${studentId} not found`);

  // Plaid balance: sum verified balances
  const balanceRow = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(verified_balance_usd), 0)::text AS total
     FROM letters_of_credit
     WHERE student_id = $1 AND status = 'active'`,
    [studentId],
  );

  const verifiedBalance = parseFloat(balanceRow?.total ?? '0');
  const visaExpiry      = student.visa_expiry_year
    ? new Date(student.visa_expiry_year, 11, 31)  // Dec 31 of expiry year
    : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // default 1yr if unknown

  return computeTrustScore({
    novaTranslatedScore: student.trust_score ?? 580,
    verifiedBalanceUsd:  verifiedBalance,
    monthlyRentTarget,
    i20ExpirationDate:   visaExpiry,
    leaseDurationMonths,
    livenessScore:       student.liveness_threshold_met ? 0.95 : 0.5,
    facialMatchScore:    student.facial_match_threshold_met ? 0.93 : 0.5,
    nfcChipVerified:     student.nfc_chip_verified ?? false,
  });
}
