/**
 * packages/auth/src/single-use-token.ts
 *
 * Enforces that every Vecta ID sharing link can only be opened once.
 *
 * Flow:
 *   Student mints token → JTI registered (used_at = NULL)
 *   Landlord opens link  → JTI checked + atomically stamped (used_at = NOW())
 *   Any subsequent open  → 409 ALREADY_USED with who/when
 *
 * Why this matters:
 *   Without single-use enforcement a shared URL is a "forwardable identity link"
 *   — a forwarded email could give a third party (competitor, discriminatory
 *   actor) full access to the student's verified profile.
 */
export declare function registerToken(jti: string, studentId: string, expiresAt: Date): Promise<void>;
export type ConsumeResult = {
    ok: true;
} | {
    ok: false;
    reason: 'NOT_FOUND' | 'EXPIRED' | 'ALREADY_USED';
    usedAt?: Date;
    usedByIp?: string;
};
export declare function consumeToken(jti: string, landlordIp: string): Promise<ConsumeResult>;
export declare function revokeToken(jti: string, studentId: string): Promise<void>;
export declare function listActiveTokens(studentId: string): Promise<Array<{
    jti: string;
    createdAt: Date;
    expiresAt: Date;
    used: boolean;
    usedAt?: Date;
}>>;
//# sourceMappingURL=single-use-token.d.ts.map