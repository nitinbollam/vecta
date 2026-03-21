/**
 * services/identity-service/src/email.service.ts
 *
 * Transactional email via SendGrid (primary) with SES fallback.
 *
 * Templates:
 *   landlord-verify          — magic link for landlord email verification
 *   landlord-upgrade-trusted — background check completion notification
 *   student-token-used       — notify student when landlord opens their Vecta ID
 *   student-kyc-approved     — KYC approval confirmation
 *   student-kyc-rejected     — KYC rejection with retry instructions
 *   loc-generated            — Letter of Credit ready
 *   dso-memo-ready           — DSO compliance memo ready
 */
/**
 * Landlord magic-link verification email.
 * Link is single-use and expires in 1 hour.
 */
export declare function sendLandlordVerifyEmail(params: {
    toEmail: string;
    toName?: string;
    verifyUrl: string;
}): Promise<void>;
/**
 * Notify landlord that their background check passed → TRUSTED tier.
 */
export declare function sendLandlordUpgradeEmail(params: {
    toEmail: string;
    toName?: string;
}): Promise<void>;
/**
 * Notify student that a landlord opened their Vecta ID sharing link.
 * Provides a link to the token management screen to revoke if needed.
 */
export declare function sendStudentTokenUsedEmail(params: {
    toEmail: string;
    studentName: string;
    usedAt: Date;
    tokensUrl: string;
}): Promise<void>;
/**
 * Notify student that KYC is approved and their Vecta ID is live.
 */
export declare function sendKycApprovedEmail(params: {
    toEmail: string;
    studentName: string;
}): Promise<void>;
/**
 * Notify student that KYC was rejected, with retry instructions.
 */
export declare function sendKycRejectedEmail(params: {
    toEmail: string;
    studentName: string;
    rejectReason: string;
    retryUrl: string;
}): Promise<void>;
/**
 * Notify student their Letter of Credit is ready for sharing.
 */
export declare function sendLocReadyEmail(params: {
    toEmail: string;
    studentName: string;
    locId: string;
    expiresAt: Date;
}): Promise<void>;
//# sourceMappingURL=email.service.d.ts.map