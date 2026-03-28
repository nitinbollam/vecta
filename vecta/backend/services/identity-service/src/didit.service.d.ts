import { Pool } from "pg";
import Redis from "ioredis";
import { VectaIDTokenPayload } from "@vecta/types";
export declare class IdentityService {
    private readonly db;
    private readonly redis;
    private readonly didit;
    private readonly jwtPrivateKey;
    private readonly jwtKid;
    constructor(db: Pool, redis: Redis);
    /** Poll Didit for session state (student app). */
    getSessionStatus(sessionId: string): Promise<{
        status: string;
        kyc_status: string | null;
    } | null>;
    initiateVerification(studentId: string): Promise<{
        sessionId: string;
        verificationUrl: string;
    }>;
    processVerificationResult(sessionId: string, rawPayload: string, signature: string): Promise<{
        studentId: string;
        vectaIdToken: string;
    }>;
    mintVectaIDToken(studentId: string): Promise<string>;
    verifyVectaIDToken(token: string, landlordIp: string, userAgent: string): Promise<{
        payload: VectaIDTokenPayload;
        verificationId: string;
    }>;
    private parseSessionToPassportData;
    private getTrustScoreTier;
}
export declare class DiditError extends Error {
    constructor(message: string);
}
export declare class LivenessThresholdError extends DiditError {
}
export declare class FacialMatchError extends DiditError {
}
export declare class NFCChipError extends DiditError {
}
export declare class TokenExpiredError extends Error {
    constructor(message: string);
}
export declare class TokenVerificationError extends Error {
    constructor(message: string);
}
export declare class TokenRevokedError extends Error {
    constructor(message: string);
}
export declare const identityService: IdentityService;
export declare function mintVectaIDToken(studentId: string): Promise<string>;
export declare function verifyVectaIDToken(token: string, landlordIp: string, userAgent: string): ReturnType<IdentityService["verifyVectaIDToken"]>;
//# sourceMappingURL=didit.service.d.ts.map