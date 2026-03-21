/**
 * services/identity-service/src/checkr.service.ts
 *
 * Checkr background check integration — gates landlord TRUSTED tier.
 *
 * Flow:
 *   1. Landlord requests background check → POST /landlord/background-check/initiate
 *   2. Vecta creates a Checkr candidate + orders a "tasker" package
 *   3. Checkr emails the landlord a consent link
 *   4. Landlord completes consent → Checkr runs check
 *   5. Checkr webhook → POST /webhooks/checkr → updates landlord tier
 *
 * Package used: "tasker" — identity verification + criminal check
 * No credit check (not needed for landlord verification).
 *
 * Privacy:
 *   SSN is collected by Checkr directly (never touches Vecta servers).
 *   We only store the Checkr report ID + adjudication status.
 */
export declare function initiateBackgroundCheck(landlordId: string): Promise<{
    candidateId: string;
    reportId: string;
    consentUrl: string;
    estimatedDays: number;
}>;
export interface CheckrWebhookPayload {
    type: string;
    data: {
        object: {
            id: string;
            status: string;
            adjudication: 'engaged' | 'adverse_action' | null;
            candidate_id: string;
        };
    };
}
export declare function handleCheckrWebhook(payload: CheckrWebhookPayload): Promise<void>;
export declare function getBackgroundCheckStatus(landlordId: string): Promise<{
    status: 'NOT_STARTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
    estimatedCompletion?: string;
}>;
//# sourceMappingURL=checkr.service.d.ts.map