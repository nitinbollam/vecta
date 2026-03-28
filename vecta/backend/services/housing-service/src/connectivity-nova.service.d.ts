import { Pool } from "pg";
import type { ESIMProvisionResult, NovaCreditResult } from "@vecta/types";
export declare class ConnectivityService {
    private readonly db;
    private readonly baseUrl;
    private readonly apiKey;
    constructor(db: Pool);
    validateIMEI(imei: string): Promise<{
        valid: boolean;
        supports5G: boolean;
        deviceBrand?: string;
        deviceModel?: string;
    }>;
    provisionESIM(params: {
        studentId: string;
        imei: string;
        planPreference?: "5G_UNLIMITED" | "5G_10GB" | "LTE_5GB";
        countryOfDestination?: string;
    }): Promise<ESIMProvisionResult>;
    private selectPlan;
    private luhnCheck;
    private request;
}
export declare class ESIMError extends Error {
    constructor(message: string);
}
export declare class NovaCreditService {
    private readonly db;
    private readonly baseUrl;
    private readonly apiKey;
    constructor(db: Pool);
    fetchCreditHistory(params: {
        studentId: string;
        passportNumber: string;
        countryOfOrigin: string;
        firstName: string;
        lastName: string;
        dateOfBirth: string;
    }): Promise<NovaCreditResult>;
    private buildDefaultScore;
    private scoreTier;
    /** Gateway cold-cache hook — full Nova pull uses `fetchCreditHistory` with PII from the KYC pipeline. */
    fetchInternationalCreditHistory(studentId: string): Promise<void>;
}
export declare class NovaCreditError extends Error {
    constructor(msg: string);
}
export declare const connectivityService: ConnectivityService;
export declare const novaCreditService: NovaCreditService;
//# sourceMappingURL=connectivity-nova.service.d.ts.map