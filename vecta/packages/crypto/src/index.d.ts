/**
 * @vecta/crypto — AES-256-GCM field-level encryption for PII
 *
 * Key derivation: PBKDF2-SHA512, 600 000 iterations (OWASP 2024 minimum).
 * Each encrypted value is self-contained:  iv:authTag:ciphertext  (Base64url, colon-delimited).
 * NEVER log plain-text values or key material.
 */
/**
 * Encrypt a UTF-8 string with AES-256-GCM.
 * Returns a compact token:  `<iv_b64url>:<authTag_b64url>:<ciphertext_b64url>`
 */
export declare function encryptField(plaintext: string): string;
/**
 * Decrypt a token produced by `encryptField`.
 * Throws if the auth tag is invalid (tampering detected).
 */
export declare function decryptField(token: string): string;
/**
 * Generate HMAC-SHA256 hex digest for webhook signature verification
 * and audit-chain integrity stamps.
 */
export declare function hmacSign(payload: string, secret?: string): string;
/** Timing-safe HMAC comparison — prevents timing-oracle attacks. */
export declare function hmacVerify(payload: string, signature: string, secret?: string): boolean;
export declare function sha256Hex(data: string | Buffer): string;
export declare function sha256B64(data: string | Buffer): string;
/** Generate a cryptographically random token (URL-safe Base64). */
export declare function generateSecureToken(bytes?: number): string;
/** Generate a UUID v4. */
export declare function generateUUID(): string;
export interface ConsentPayload {
    studentId: string;
    consentVersion: string;
    clauses: Record<string, boolean>;
    ipAddress: string;
    userAgent: string;
    timestamp: string;
}
/**
 * Produces a deterministic SHA-256 hex signature of a sorted consent payload.
 * Stored alongside consent records so tampering is detectable.
 */
export declare function signConsentPayload(payload: ConsentPayload): string;
//# sourceMappingURL=index.d.ts.map