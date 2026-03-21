/**
 * services/compliance-service/src/liquidity-engine.ts
 *
 * Cold-Start Liquidity Engine.
 *
 * The deadlock:
 *   Landlords won't accept Vecta certificates without proof others have.
 *   Students won't risk applying without knowing landlords will accept.
 *   Both sides wait → market never starts.
 *
 * Three forced liquidity strategies, in order of capital efficiency:
 *
 * Strategy A: Guaranteed Rent Pool (Vecta-funded)
 *   Vecta covers the first month's rent for early adopters.
 *   Landlord risk = $0. Acceptance rate → 100% for pool-backed applications.
 *   Cap: $500K total (covers ~300 first-month guarantees at $1,500/mo).
 *   Break-even: 20% conversion to repeat (no-guarantee) applications.
 *
 * Strategy B: University-Backed Mandate
 *   MIT / Harvard / BU sign an MOU with Vecta.
 *   University housing office adds "Vecta-verified" to their approved tenant list.
 *   Off-campus landlords who list on university housing boards must accept.
 *   Capital required: $0. Leverage: institutional credibility.
 *
 * Strategy C: Corporate Housing Partner
 *   Greystar, Equity Residential, AvalonBay — national property managers.
 *   They pre-commit to accepting Vecta certificates in specific markets.
 *   In exchange: Vecta routes all students in that city to their properties.
 *   Win: landlord fills units faster. Win: students get guaranteed acceptance.
 *   Capital required: $0. Requires a revenue share or referral agreement.
 *
 * This service:
 *   - Manages pool balances and allocation rules
 *   - Decides which strategy applies to a given student/landlord pair
 *   - Generates the "Backed by Vecta Guarantee" badge for the certificate
 *   - Tracks repayment (students repay from earnings over 6 months)
 */

import { query, queryOne, withTransaction } from '@vecta/database';
import { createLogger, logAuditEvent } from '@vecta/logger';

const logger = createLogger('liquidity-engine');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PoolType = 'GUARANTEED_RENT' | 'UNIVERSITY_BACKED' | 'CORPORATE_PARTNER';

export interface LiquidityPool {
  id:              string;
  poolType:        PoolType;
  sponsorName:     string;
  sponsorType:     'VECTA' | 'UNIVERSITY' | 'CORPORATE';
  totalCapacityUsd: number;
  deployedUsd:     number;
  availableUsd:    number;
  reserveRatio:    number;
  targetCity?:     string;
  targetUniversity?: string;
  active:          boolean;
}

export interface LiquidityDecision {
  eligible:       boolean;
  strategy:       PoolType | null;
  poolId:         string | null;
  coverageUsd:    number;
  monthsCovered:  number;
  badgeText:      string | null;
  reason:         string;
}

export interface AllocationResult {
  allocationId:  string;
  poolId:        string;
  strategy:      PoolType;
  coverageUsd:   number;
  monthsCovered: number;
  badgeText:     string;
  expiresAt:     string;
}

// ---------------------------------------------------------------------------
// Eligibility check — which strategy applies?
// ---------------------------------------------------------------------------

export async function checkLiquidityEligibility(params: {
  studentId:      string;
  universityName: string;
  city:           string;
  monthlyRent:    number;
  guaranteeTier:  string;
  certId:         string;
}): Promise<LiquidityDecision> {

  // Reject if student already has an active allocation
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM liquidity_allocations
     WHERE student_id = $1 AND status = 'ACTIVE' AND expires_at > NOW()`,
    [params.studentId],
  );
  if (existing) {
    return {
      eligible: false, strategy: null, poolId: null,
      coverageUsd: 0, monthsCovered: 0, badgeText: null,
      reason: 'Student already has an active liquidity allocation',
    };
  }

  // Strategy B: University-backed (highest priority — zero cost)
  const uniPool = await queryOne<{ id: string; total_capacity_usd: number; deployed_usd: number }>(
    `SELECT id, total_capacity_usd, deployed_usd
     FROM liquidity_pool
     WHERE pool_type = 'UNIVERSITY_BACKED'
       AND active = TRUE
       AND (target_university = $1 OR target_university IS NULL)
       AND (target_city = $2 OR target_city IS NULL)
     ORDER BY target_university NULLS LAST, target_city NULLS LAST
     LIMIT 1`,
    [params.universityName, params.city],
  );

  if (uniPool) {
    const available = uniPool.total_capacity_usd - uniPool.deployed_usd;
    if (available >= params.monthlyRent) {
      return {
        eligible: true, strategy: 'UNIVERSITY_BACKED', poolId: uniPool.id,
        coverageUsd: params.monthlyRent, monthsCovered: 1,
        badgeText: `Backed by ${params.universityName} Housing Guarantee`,
        reason: 'University-backed pool available',
      };
    }
  }

  // Strategy C: Corporate partner (zero cost, coverage via pre-commitment)
  const corpPool = await queryOne<{ id: string; sponsor_name: string }>(
    `SELECT id, sponsor_name
     FROM liquidity_pool
     WHERE pool_type = 'CORPORATE_PARTNER'
       AND active = TRUE
       AND (target_city = $1 OR target_city IS NULL)
     LIMIT 1`,
    [params.city],
  );

  if (corpPool) {
    return {
      eligible: true, strategy: 'CORPORATE_PARTNER', poolId: corpPool.id,
      coverageUsd: 0,  // Corporate partners don't deploy cash — they pre-commit
      monthsCovered: 1,
      badgeText: `Preferred by ${corpPool.sponsor_name}`,
      reason: 'Corporate partner pre-commitment available in this city',
    };
  }

  // Strategy A: Vecta guaranteed rent (last resort — uses capital)
  const vectaPool = await queryOne<{
    id: string; total_capacity_usd: number; deployed_usd: number; reserve_ratio: number;
  }>(
    `SELECT id, total_capacity_usd, deployed_usd, reserve_ratio
     FROM liquidity_pool
     WHERE pool_type = 'GUARANTEED_RENT'
       AND sponsor_type = 'VECTA'
       AND active = TRUE
       AND (target_city = $1 OR target_city IS NULL)
     ORDER BY target_city NULLS LAST
     LIMIT 1`,
    [params.city],
  );

  if (!vectaPool) {
    return {
      eligible: false, strategy: null, poolId: null,
      coverageUsd: 0, monthsCovered: 0, badgeText: null,
      reason: 'No active Vecta guaranteed rent pool in this market',
    };
  }

  const maxDeployable = vectaPool.total_capacity_usd * (1 - vectaPool.reserve_ratio);
  const available     = maxDeployable - vectaPool.deployed_usd;
  const utilizationPct = (vectaPool.deployed_usd / maxDeployable) * 100;

  // ── Dynamic adverse selection throttle ────────────────────────────────
  // As pool fills, we raise the bar to protect against adverse selection.
  // Early adopters (low utilization) see loose thresholds.
  // As pool depletes, only highest-quality applicants are guaranteed.
  //
  // Thresholds:
  //   0–50% utilization:  SILVER+ eligible (broad market seeding)
  //   50–70% utilization: GOLD+   eligible (tighten as pool depletes)
  //   70–90% utilization: PLATINUM/GOLD only (protect remaining capital)
  //   >90% utilization:   Pool closed to new allocations (reserve only)
  // ─────────────────────────────────────────────────────────────────────

  const minimumTier = (() => {
    if (utilizationPct < 50) return ['PLATINUM', 'GOLD', 'SILVER'];
    if (utilizationPct < 70) return ['PLATINUM', 'GOLD'];
    if (utilizationPct < 90) return ['PLATINUM', 'GOLD'];
    return [];  // Pool in reserve-only mode
  })();

  if (minimumTier.length === 0) {
    return {
      eligible: false, strategy: null, poolId: null,
      coverageUsd: 0, monthsCovered: 0, badgeText: null,
      reason: `Pool at ${utilizationPct.toFixed(0)}% capacity — in reserve-only mode. New allocations paused.`,
    };
  }

  if (!minimumTier.includes(params.guaranteeTier)) {
    const thresholdName = utilizationPct < 50 ? 'SILVER' : 'GOLD';
    return {
      eligible: false, strategy: null, poolId: null,
      coverageUsd: 0, monthsCovered: 0, badgeText: null,
      reason: `Pool at ${utilizationPct.toFixed(0)}% capacity — minimum ${thresholdName} tier required. ` +
              `Your tier: ${params.guaranteeTier}.`,
    };
  }
  // ─────────────────────────────────────────────────────────────────────

  if (available < params.monthlyRent) {
    return {
      eligible: false, strategy: null, poolId: null,
      coverageUsd: 0, monthsCovered: 0, badgeText: null,
      reason: `Insufficient capacity ($${available.toFixed(0)} remaining, need $${params.monthlyRent}) in ${params.city}.`,
    };
  }

  return {
    eligible: true, strategy: 'GUARANTEED_RENT', poolId: vectaPool.id,
    coverageUsd: params.monthlyRent, monthsCovered: 1,
    badgeText: '✅ First Month Guaranteed by Vecta',
    reason: `Pool at ${utilizationPct.toFixed(0)}% — eligible at ${params.guaranteeTier} tier`,
  };
}

// ---------------------------------------------------------------------------
// Allocate from pool — atomic, prevents double-spend
// ---------------------------------------------------------------------------

export async function allocateLiquidity(params: {
  studentId:         string;
  certId:            string;
  leaseApplicationId: string;
  poolId:            string;
  strategy:          PoolType;
  monthlyRent:       number;
  monthsCovered:     number;
  badgeText:         string;
}): Promise<AllocationResult> {
  return withTransaction(async (client) => {
    // Lock the pool row to prevent concurrent over-allocation
    const pool = await client.query<{
      id: string; total_capacity_usd: number; deployed_usd: number;
      reserve_ratio: number; pool_type: string; sponsor_name: string;
    }>(
      `SELECT id, total_capacity_usd, deployed_usd, reserve_ratio, pool_type, sponsor_name
       FROM liquidity_pool WHERE id = $1 AND active = TRUE FOR UPDATE`,
      [params.poolId],
    );

    if (pool.rowCount === 0) throw new Error('Pool not found or inactive');

    const p           = pool.rows[0]!;
    const maxDeploy   = p.total_capacity_usd * (1 - p.reserve_ratio);
    const available   = maxDeploy - p.deployed_usd;
    const allocAmount = params.strategy === 'CORPORATE_PARTNER' ? 0 : params.monthlyRent;

    if (allocAmount > 0 && available < allocAmount) {
      throw new Error(`Insufficient pool capacity: need $${allocAmount}, have $${available.toFixed(2)}`);
    }

    // Write allocation
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 45); // 45-day window to find housing

    const alloc = await client.query<{ id: string }>(
      `INSERT INTO liquidity_allocations
         (pool_id, student_id, lease_application_id, allocated_usd, months_covered, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [params.poolId, params.studentId, params.leaseApplicationId, allocAmount, params.monthsCovered, expiresAt],
    );

    // Deduct from pool
    if (allocAmount > 0) {
      await client.query(
        `UPDATE liquidity_pool SET deployed_usd = deployed_usd + $2, updated_at = NOW() WHERE id = $1`,
        [params.poolId, allocAmount],
      );
    }

    const allocationId = alloc.rows[0]!.id;

    logAuditEvent('LIQUIDITY_ALLOCATED', params.studentId, allocationId, {
      strategy:   params.strategy,
      poolId:     params.poolId,
      amountUsd:  allocAmount,
      expiresAt:  expiresAt.toISOString(),
    });

    logger.info(
      { studentId: params.studentId, strategy: params.strategy, allocAmount },
      'Liquidity allocated',
    );

    return {
      allocationId,
      poolId:       params.poolId,
      strategy:     params.strategy,
      coverageUsd:  allocAmount,
      monthsCovered: params.monthsCovered,
      badgeText:    params.badgeText,
      expiresAt:    expiresAt.toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------
// Seed pools — call this in setup/onboarding scripts
// ---------------------------------------------------------------------------

export async function seedVectaPool(params: {
  totalCapacityUsd: number;
  targetCity?:      string;
}): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO liquidity_pool
       (pool_type, sponsor_name, sponsor_type, total_capacity_usd, target_city, reserve_ratio)
     VALUES ('GUARANTEED_RENT','Vecta Financial Services LLC','VECTA',$1,$2,0.20)
     RETURNING id`,
    [params.totalCapacityUsd, params.targetCity ?? null],
  );

  logger.info(
    { poolId: result!.id, capacity: params.totalCapacityUsd, city: params.targetCity },
    'Vecta guaranteed rent pool seeded',
  );

  return result!.id;
}

export async function addUniversityPool(params: {
  universityName:   string;
  city:             string;
  capacityUsd:      number;
}): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO liquidity_pool
       (pool_type, sponsor_name, sponsor_type, total_capacity_usd, target_university, target_city, reserve_ratio)
     VALUES ('UNIVERSITY_BACKED',$1,'UNIVERSITY',$2,$3,$4,0.10)
     RETURNING id`,
    [params.universityName, params.capacityUsd, params.universityName, params.city],
  );

  logger.info(
    { poolId: result!.id, university: params.universityName, capacity: params.capacityUsd },
    'University-backed pool added',
  );

  return result!.id;
}

export async function addCorporatePartner(params: {
  partnerName:  string;
  city:         string;
}): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO liquidity_pool
       (pool_type, sponsor_name, sponsor_type, total_capacity_usd, target_city, reserve_ratio)
     VALUES ('CORPORATE_PARTNER',$1,'CORPORATE',9999999,$2,0.00)
     RETURNING id`,
    [params.partnerName, params.city],
  );

  logger.info({ poolId: result!.id, partner: params.partnerName, city: params.city }, 'Corporate partner added');
  return result!.id;
}

// ---------------------------------------------------------------------------
// Pool health for ops dashboard
// ---------------------------------------------------------------------------

export async function getPoolStats(): Promise<Array<{
  poolType:        PoolType;
  sponsorName:     string;
  totalCapacityUsd: number;
  deployedUsd:     number;
  utilizationPct:  number;
  activeAllocations: number;
  targetCity?:     string;
}>> {
  const result = await query<{
    pool_type: string; sponsor_name: string; total_capacity_usd: number;
    deployed_usd: number; target_city: string | null; active_alloc: string;
  }>(
    `SELECT
       lp.pool_type, lp.sponsor_name, lp.total_capacity_usd,
       lp.deployed_usd, lp.target_city,
       COUNT(la.id) FILTER (WHERE la.status = 'ACTIVE')::text AS active_alloc
     FROM liquidity_pool lp
     LEFT JOIN liquidity_allocations la ON la.pool_id = lp.id
     WHERE lp.active = TRUE
     GROUP BY lp.id, lp.pool_type, lp.sponsor_name, lp.total_capacity_usd,
              lp.deployed_usd, lp.target_city`,
  );

  return result.rows.map((r) => ({
    poolType:          r.pool_type as PoolType,
    sponsorName:       r.sponsor_name,
    totalCapacityUsd:  r.total_capacity_usd,
    deployedUsd:       r.deployed_usd,
    utilizationPct:    r.total_capacity_usd > 0
      ? Math.round((r.deployed_usd / r.total_capacity_usd) * 100) : 0,
    activeAllocations: parseInt(r.active_alloc, 10),
    targetCity:        r.target_city ?? undefined,
  }));
}
