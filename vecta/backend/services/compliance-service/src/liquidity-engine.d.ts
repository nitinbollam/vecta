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
export type PoolType = 'GUARANTEED_RENT' | 'UNIVERSITY_BACKED' | 'CORPORATE_PARTNER';
export interface LiquidityPool {
    id: string;
    poolType: PoolType;
    sponsorName: string;
    sponsorType: 'VECTA' | 'UNIVERSITY' | 'CORPORATE';
    totalCapacityUsd: number;
    deployedUsd: number;
    availableUsd: number;
    reserveRatio: number;
    targetCity?: string;
    targetUniversity?: string;
    active: boolean;
}
export interface LiquidityDecision {
    eligible: boolean;
    strategy: PoolType | null;
    poolId: string | null;
    coverageUsd: number;
    monthsCovered: number;
    badgeText: string | null;
    reason: string;
}
export interface AllocationResult {
    allocationId: string;
    poolId: string;
    strategy: PoolType;
    coverageUsd: number;
    monthsCovered: number;
    badgeText: string;
    expiresAt: string;
}
export declare function checkLiquidityEligibility(params: {
    studentId: string;
    universityName: string;
    city: string;
    monthlyRent: number;
    guaranteeTier: string;
    certId: string;
}): Promise<LiquidityDecision>;
export declare function allocateLiquidity(params: {
    studentId: string;
    certId: string;
    leaseApplicationId: string;
    poolId: string;
    strategy: PoolType;
    monthlyRent: number;
    monthsCovered: number;
    badgeText: string;
}): Promise<AllocationResult>;
export declare function seedVectaPool(params: {
    totalCapacityUsd: number;
    targetCity?: string;
}): Promise<string>;
export declare function addUniversityPool(params: {
    universityName: string;
    city: string;
    capacityUsd: number;
}): Promise<string>;
export declare function addCorporatePartner(params: {
    partnerName: string;
    city: string;
}): Promise<string>;
export declare function getPoolStats(): Promise<Array<{
    poolType: PoolType;
    sponsorName: string;
    totalCapacityUsd: number;
    deployedUsd: number;
    utilizationPct: number;
    activeAllocations: number;
    targetCity?: string;
}>>;
//# sourceMappingURL=liquidity-engine.d.ts.map