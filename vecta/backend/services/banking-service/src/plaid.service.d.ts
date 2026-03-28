import { Pool } from "pg";
import type { Redis } from "ioredis";
export declare class SolvencyService {
    private readonly db;
    private readonly redis;
    private readonly plaid;
    private readonly signingKey;
    constructor(db: Pool, redis: Redis);
    createLinkToken(studentId: string): Promise<{
        linkToken: string;
    }>;
    exchangePublicToken(studentId: string, publicToken: string): Promise<{
        accessTokenStored: boolean;
    }>;
    generateLetterOfCredit(params: {
        studentId: string;
        monthlyRentEstimateUSD: number;
        studentFullName: string;
        universityName: string;
        landlordName?: string;
    }): Promise<{
        reportId: string;
        pdfDownloadUrl: string;
        solvencyConfirmed: boolean;
        guaranteedMonths: number;
    }>;
    private pollAssetReport;
    private encryptAES;
    private decryptAES;
}
export type BalanceTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
export interface MaskedBalanceResult {
    tier: BalanceTier;
    rangeLabel: string;
    lastUpdated: string;
    unitAccountLast4?: string;
}
/**
 * Returns a range label for the student's verified balance.
 * The exact balance is NEVER exposed — only the tier/range.
 * Landlords see the LoC guarantee amount, not these figures.
 */
export declare function getMaskedBalance(studentId: string): Promise<MaskedBalanceResult>;
/**
 * Mark a Plaid item as errored when we receive an ITEM error webhook.
 * The student will need to re-link their bank via the Plaid Link flow.
 */
export declare function handleItemError(itemId: string): Promise<void>;
export declare class PlaidError extends Error {
    constructor(message: string);
}
//# sourceMappingURL=plaid.service.d.ts.map