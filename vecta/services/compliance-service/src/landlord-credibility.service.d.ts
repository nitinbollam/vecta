/**
 * services/compliance-service/src/landlord-credibility.service.ts
 *
 * Landlord Credibility Engine — addresses the "last mile trust problem."
 *
 * The problem:
 *   A landlord can verify identity and financial standing via Vecta.
 *   But without social proof, network effects, and institutional backing,
 *   they have no reason to *accept Vecta certificates* over SSN + FICO.
 *
 * This service builds the distribution layer:
 *
 * 1. Social Proof API
 *    Real-time acceptance statistics that landlords see on the portal.
 *    "1,247 landlords in Boston have accepted Vecta-verified students."
 *    These are not fake numbers — they aggregate from trust_signal_events.
 *
 * 2. Landlord Network Tiering
 *    STANDARD → PREFERRED → PARTNER based on acceptance history.
 *    PARTNER landlords get co-marketing, so they promote Vecta to their networks.
 *
 * 3. University Partnership Pipeline
 *    Integration hooks for university housing offices.
 *    When MIT Housing accepts Vecta certificates, every MIT student gets credibility.
 *
 * 4. Comparable Tenant Report
 *    For a given property address, show how many similar Vecta-verified students
 *    were successfully placed in the same zip code.
 *    This directly answers "do other landlords accept this?"
 */
export interface SocialProofStats {
    totalLandlordsAccepted: number;
    totalStudentsPlaced: number;
    acceptanceRatePercent: number;
    avgDecisionSeconds: number;
    citiesServed: number;
    universitiesPartner: number;
    recentAcceptances: Array<{
        city: string;
        state: string;
        universityName: string;
        daysAgo: number;
    }>;
}
export declare function getSocialProofStats(city?: string, state?: string): Promise<SocialProofStats>;
export interface ComparableReport {
    zipCode: string;
    placementsInZip: number;
    avgGuaranteeMonths: number;
    avgTrustScore: number;
    mostCommonTiers: string[];
    message: string;
}
export declare function getComparableReport(zipCode: string, guaranteeTier: string): Promise<ComparableReport>;
export declare function onboardLandlord(params: {
    landlordProfileId: string;
    propertyCount: number;
    cities: string[];
    referralCode?: string;
}): Promise<{
    networkId: string;
    referralCode: string;
}>;
export declare function recordAcceptance(params: {
    landlordId: string;
    studentId: string;
    certId: string;
    city: string;
    state: string;
    universityName: string;
}): Promise<void>;
export declare function recordUniversityIntegration(params: {
    universityName: string;
    city: string;
    state: string;
    integrationUrl?: string;
}): Promise<void>;
//# sourceMappingURL=landlord-credibility.service.d.ts.map