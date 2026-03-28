import { Pool } from "pg";
import { UnitCustomerCreate, KYCStatus } from "@vecta/types";
export declare class BaaSService {
    private readonly db;
    private readonly unit;
    constructor(db: Pool);
    provisionStudentAccount(params: {
        studentId: string;
        email: string;
        phone: string;
        address: UnitCustomerCreate["address"];
        legalFirstName: string;
        legalLastName: string;
        dateOfBirth: string;
        passportNumber: string;
        passportCountry: string;
        passportExpiry: string;
        passportSelfieBase64: string;
    }): Promise<{
        unitCustomerId: string;
        unitAccountId: string;
        kycStatus: KYCStatus;
    }>;
    /** Coarse masking for internal dashboards — not exact cents. */
    getMaskedBalance(studentId: string): Promise<{
        availableBandUsd: number;
        balanceBandUsd: number;
        currency: "USD";
    }>;
    getAccountBalance(studentId: string): Promise<{
        available: number;
        balance: number;
        currency: "USD";
    }>;
    /**
     * Idempotent if already provisioned; otherwise loads latest Didit session and calls Unit.
     */
    provisionStudentAccountByStudentId(studentId: string): Promise<{
        unitCustomerId: string;
        unitAccountId: string;
        kycStatus: KYCStatus;
    }>;
    /** Parse Unit.co JSON:API webhook body. */
    handleKYCStatusUpdateFromWebhook(payload: unknown): Promise<void>;
    handleKYCStatusUpdate(unitCustomerId: string, newStatus: string): Promise<void>;
    private mapUnitStatusToKYC;
    private emitAuditEvent;
}
export declare class UnitAPIError extends Error {
    constructor(message: string);
}
export declare const baasService: BaaSService;
//# sourceMappingURL=unit.service.d.ts.map