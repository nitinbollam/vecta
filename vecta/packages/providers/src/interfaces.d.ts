/**
 * packages/providers/src/interfaces.ts
 *
 * Vendor-agnostic provider contracts.
 *
 * Every external dependency implements one of these interfaces.
 * The application layer only imports these types — never concrete vendor SDKs.
 *
 * Swap strategy:
 *   1. Add a new class implementing the interface
 *   2. Update PROVIDER_CONFIG[service] in registry.ts
 *   3. Deploy — zero schema changes, zero application code changes
 *
 * Current implementations:
 *   Banking:     UnitProvider  (primary) → StripeProvider (standby)
 *   Identity:    DiditProvider (primary) → PersonaProvider (standby)
 *   BankData:    PlaidProvider (primary) → MXProvider (standby)
 *   Credit:      NovaCreditProvider (primary) → FairplayProvider (standby)
 *   eSIM:        ESIMGoProvider (primary) → AloSIMProvider (standby)
 */
export interface BankAccount {
    accountId: string;
    routingNumber: string;
    accountNumber: string;
    cardLast4?: string;
    status: 'PENDING' | 'ACTIVE' | 'FROZEN' | 'CLOSED';
    kycStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NEEDS_REVIEW';
    availableUsd: number;
    currency: 'USD';
    providerName: string;
    providerRefId: string;
}
export interface BankingProvider {
    readonly name: string;
    readonly supportsNoSSN: boolean;
    /** Create a customer record and open a DDA. Idempotent by studentId. */
    provision(studentId: string, passport: {
        firstName: string;
        lastName: string;
        dateOfBirth: string;
        passportNumber: string;
        issuingCountry: string;
    }): Promise<BankAccount>;
    /** Get current KYC status from provider. */
    getKYCStatus(providerRefId: string): Promise<BankAccount['kycStatus']>;
    /** Get masked balance (for trust engine — not for display). */
    getBalance(providerRefId: string): Promise<{
        available: number;
        pending: number;
    }>;
    /** List recent transactions. */
    getTransactions(providerRefId: string, limit: number): Promise<Array<{
        id: string;
        date: string;
        description: string;
        amountCents: number;
        direction: 'CREDIT' | 'DEBIT';
        status: 'PENDING' | 'CLEARED' | 'RETURNED';
    }>>;
    /** Handle incoming webhook payload. Returns normalized event. */
    handleWebhook(payload: unknown, signature: string): Promise<{
        type: 'KYC_STATUS_CHANGED' | 'TRANSACTION_SETTLED' | 'CARD_ISSUED' | 'UNKNOWN';
        customerId?: string;
        kycStatus?: BankAccount['kycStatus'];
    }>;
}
export interface IdentityVerificationSession {
    sessionId: string;
    sdkToken: string;
    qrCodeUrl?: string;
    expiresAt: string;
    providerName: string;
}
export interface BiometricResult {
    livenessScore: number;
    facialMatchScore: number;
    nfcChipVerified: boolean;
    documentValid: boolean;
    extractedData: {
        surname: string;
        givenNames: string;
        documentNumber: string;
        nationality: string;
        dateOfBirth: string;
        expiryDate: string;
    };
}
export interface IdentityProvider {
    readonly name: string;
    readonly supportsNFC: boolean;
    readonly livenessThreshold: number;
    readonly facialMatchThreshold: number;
    initiateVerification(studentId: string, returnUrl: string): Promise<IdentityVerificationSession>;
    processWebhook(payload: unknown, signature: string): Promise<{
        sessionId: string;
        status: 'APPROVED' | 'DECLINED' | 'EXPIRED' | 'PROCESSING';
        result?: BiometricResult;
    }>;
}
export interface AssetReport {
    reportId: string;
    totalBalanceUsd: number;
    accounts: Array<{
        institutionName: string;
        type: string;
        balanceUsd: number;
        verifiedAt: string;
    }>;
    verifiedAt: string;
    providerName: string;
}
export interface LinkTokenResult {
    linkToken: string;
    expiresAt: string;
    providerName: string;
}
export interface BankDataProvider {
    readonly name: string;
    readonly supportsInternationalBanks: boolean;
    createLinkToken(studentId: string, products: string[]): Promise<LinkTokenResult>;
    exchangePublicToken(publicToken: string): Promise<{
        accessToken: string;
        itemId: string;
    }>;
    getAssetReport(accessToken: string, daysRequested: number): Promise<AssetReport>;
    handleWebhook(payload: unknown): Promise<{
        type: 'ITEM_ERROR' | 'ASSET_REPORT_READY' | 'AUTH_GRANTED' | 'UNKNOWN';
        itemId?: string;
    }>;
}
export interface CreditResult {
    translatedScore: number;
    tier: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'BUILDING';
    sourceCountry: string;
    bureauName?: string;
    reportId?: string;
    factors: Array<{
        code: string;
        description: string;
        positive: boolean;
    }>;
    noHistoryFound: boolean;
    providerName: string;
}
export interface CreditProvider {
    readonly name: string;
    readonly supportedCountries: string[];
    fetchCreditHistory(params: {
        studentId: string;
        passportNumber: string;
        countryCode: string;
        firstName: string;
        lastName: string;
        dateOfBirth: string;
    }): Promise<CreditResult>;
}
export interface ESIMProfile {
    iccid: string;
    phoneNumber: string;
    activationCode: string;
    planId: string;
    dataGb: number;
    providerName: string;
}
export interface ESIMProvider {
    readonly name: string;
    readonly supports5G: boolean;
    provision(params: {
        studentId: string;
        imei: string;
        planPreference?: '5G_UNLIMITED' | '5G_15GB' | '4G_5GB';
    }): Promise<ESIMProfile>;
    validateIMEI(imei: string): Promise<{
        valid: boolean;
        supports5G: boolean;
    }>;
}
export interface ProviderHealthCheck {
    providerName: string;
    healthy: boolean;
    latencyMs: number;
    lastCheckedAt: string;
    error?: string;
}
export type ProviderType = 'banking' | 'identity' | 'bankData' | 'credit' | 'esim';
export interface ProviderRegistry {
    banking: BankingProvider;
    identity: IdentityProvider;
    bankData: BankDataProvider;
    credit: CreditProvider;
    esim: ESIMProvider;
}
//# sourceMappingURL=interfaces.d.ts.map