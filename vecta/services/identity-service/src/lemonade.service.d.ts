/**
 * lemonade.service.ts — Vecta × Lemonade Insurance Orchestrator
 *
 * Products:
 *   1. Renter's Insurance  — standard Lemonade Renters API
 *   2. Auto Insurance      — Lemonade Car API with F-1 foreign-experience
 *                            translation layer (no US history → mapped to
 *                            the lowest-risk equivalent tier with disclosure)
 *
 * F-1 edge-cases handled:
 *   - No US driving history: Lemonade requires ≥6 months. We attach a
 *     foreign-experience disclosure and map to "new driver equivalent" tier
 *     with a required disclosure flag.
 *   - No SSN: Lemonade Car accepts ITIN + passport + student visa number.
 *   - No US credit: Nova Credit translated score passed as creditScore param.
 */
import type { InsuranceQuote } from '@vecta/types';
export interface RentersQuoteInput {
    studentId: string;
    fullName: string;
    dateOfBirth: string;
    email: string;
    propertyAddress: string;
    city: string;
    state: string;
    zipCode: string;
    monthlyRent: number;
    coverageRequested: {
        personalProperty: number;
        liability: number;
        lossOfUse: number;
    };
    novaCreditScore?: number;
    isFurnishedApartment: boolean;
}
export interface AutoQuoteInput {
    studentId: string;
    fullName: string;
    dateOfBirth: string;
    email: string;
    passportNumber: string;
    visaType: 'F-1';
    i20ExpirationYear: number;
    garageZipCode: string;
    vehicle: {
        vin: string;
        year: number;
        make: string;
        model: string;
        trim?: string;
        primaryUse: 'personal' | 'pleasure';
        annualMileage: number;
    };
    foreignDrivingExperience?: {
        country: string;
        yearsLicensed: number;
        licenseType: 'full' | 'provisional';
        accidentFreeYears: number;
    };
    novaCreditScore?: number;
    coverageRequested: {
        liability: {
            bodily: string;
            property: string;
        };
        collision: boolean;
        comprehensive: boolean;
        deductible: number;
    };
}
export interface LemonadeQuoteResponse {
    quoteId: string;
    premium: {
        monthly: number;
        annual: number;
        currency: 'USD';
    };
    coverage: Record<string, unknown>;
    bindUrl: string;
    expiresAt: string;
    carrier: 'Lemonade';
    warnings?: string[];
}
export declare class LemonadeService {
    private api;
    constructor();
    getRentersQuote(input: RentersQuoteInput): Promise<InsuranceQuote>;
    getAutoQuote(input: AutoQuoteInput): Promise<InsuranceQuote>;
    bindQuote(quoteId: string, studentId: string, paymentToken: string): Promise<{
        policyId: string;
        policyNumber: string;
        effectiveDate: string;
    }>;
    private mapToInsuranceQuote;
}
export declare const lemonadeService: LemonadeService;
//# sourceMappingURL=lemonade.service.d.ts.map