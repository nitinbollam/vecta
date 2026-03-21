/**
 * packages/auth/src/landlord-access.ts
 *
 * Landlord access tiering — not all landlords get the same view.
 *
 * | Tier       | How achieved            | What they can do                          |
 * |------------|-------------------------|-------------------------------------------|
 * | ANONYMOUS  | Raw token URL           | View identity summary only                |
 * | VERIFIED   | Email verified + signed | Download LoC PDF, view trust score detail |
 * | TRUSTED    | Background check done   | Accept tenant, initiate lease flow        |
 *
 * This enforces the review's requirement:
 *   "View identity → token only"
 *   "Download LoC  → authenticated (verified) landlord"
 *   "Accept tenant → verified landlord"
 */
export type LandlordTier = 'ANONYMOUS' | 'VERIFIED' | 'TRUSTED';
export interface LandlordAccessContext {
    landlordId?: string;
    landlordEmail?: string;
    tier: LandlordTier;
    ipAddress: string;
    userAgent: string;
}
export declare function landlordCan(ctx: LandlordAccessContext, permission: string): boolean;
export declare function requireLandlordPermission(ctx: LandlordAccessContext, permission: string): void;
export declare function buildLandlordContext(ipAddress: string, userAgent: string, landlordEmail?: string): Promise<LandlordAccessContext>;
export declare function filterViewForTier(fullView: Record<string, unknown>, ctx: LandlordAccessContext): Record<string, unknown>;
//# sourceMappingURL=landlord-access.d.ts.map