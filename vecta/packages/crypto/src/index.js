"use strict";
/**
 * @vecta/crypto — AES-256-GCM field-level encryption for PII
 *
 * Key derivation: PBKDF2-SHA512, 600 000 iterations (OWASP 2024 minimum).
 * Each encrypted value is self-contained:  iv:authTag:ciphertext  (Base64url, colon-delimited).
 * NEVER log plain-text values or key material.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptField = encryptField;
exports.decryptField = decryptField;
exports.hmacSign = hmacSign;
exports.hmacVerify = hmacVerify;
exports.sha256Hex = sha256Hex;
exports.sha256B64 = sha256B64;
exports.generateSecureToken = generateSecureToken;
exports.generateUUID = generateUUID;
exports.signConsentPayload = signConsentPayload;
const crypto_1 = __importDefault(require("crypto"));
// ---------------------------------------------------------------------------
// Key bootstrap
// ---------------------------------------------------------------------------
const RAW_KEY = process.env.VECTA_FIELD_ENCRYPTION_KEY;
if (!RAW_KEY || RAW_KEY.length < 32) {
    throw new Error('[vecta/crypto] VECTA_FIELD_ENCRYPTION_KEY must be set and ≥ 32 chars');
}
const SALT = Buffer.from(process.env.VECTA_ENCRYPTION_SALT ?? 'vecta-pii-salt-v1', 'utf8');
/** Derived 256-bit key — computed once at module load. */
const MASTER_KEY = crypto_1.default.pbkdf2Sync(RAW_KEY, SALT, 600_000, 32, 'sha512');
const HMAC_SECRET = process.env.VECTA_HMAC_SECRET ?? RAW_KEY;
// ---------------------------------------------------------------------------
// Core encrypt / decrypt
// ---------------------------------------------------------------------------
/**
 * Encrypt a UTF-8 string with AES-256-GCM.
 * Returns a compact token:  `<iv_b64url>:<authTag_b64url>:<ciphertext_b64url>`
 */
function encryptField(plaintext) {
    const iv = crypto_1.default.randomBytes(12); // 96-bit IV — GCM standard
    const cipher = crypto_1.default.createCipheriv('aes-256-gcm', MASTER_KEY, iv);
    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag(); // 128-bit tag
    return [
        iv.toString('base64url'),
        authTag.toString('base64url'),
        encrypted.toString('base64url'),
    ].join(':');
}
/**
 * Decrypt a token produced by `encryptField`.
 * Throws if the auth tag is invalid (tampering detected).
 */
function decryptField(token) {
    const parts = token.split(':');
    if (parts.length !== 3) {
        throw new Error('[vecta/crypto] Malformed encrypted field token');
    }
    const [ivB64, tagB64, ciphertextB64] = parts;
    const iv = Buffer.from(ivB64, 'base64url');
    const authTag = Buffer.from(tagB64, 'base64url');
    const ciphertext = Buffer.from(ciphertextB64, 'base64url');
    const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', MASTER_KEY, iv);
    decipher.setAuthTag(authTag);
    try {
        return Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
        ]).toString('utf8');
    }
    catch {
        throw new Error('[vecta/crypto] Decryption failed — data integrity check failed');
    }
}
// ---------------------------------------------------------------------------
// HMAC utilities
// ---------------------------------------------------------------------------
/**
 * Generate HMAC-SHA256 hex digest for webhook signature verification
 * and audit-chain integrity stamps.
 */
function hmacSign(payload, secret) {
    return crypto_1.default
        .createHmac('sha256', secret ?? HMAC_SECRET)
        .update(payload)
        .digest('hex');
}
/** Timing-safe HMAC comparison — prevents timing-oracle attacks. */
function hmacVerify(payload, signature, secret) {
    const expected = hmacSign(payload, secret);
    return crypto_1.default.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}
// ---------------------------------------------------------------------------
// Hash utilities
// ---------------------------------------------------------------------------
function sha256Hex(data) {
    return crypto_1.default.createHash('sha256').update(data).digest('hex');
}
function sha256B64(data) {
    return crypto_1.default.createHash('sha256').update(data).digest('base64url');
}
/** Generate a cryptographically random token (URL-safe Base64). */
function generateSecureToken(bytes = 32) {
    return crypto_1.default.randomBytes(bytes).toString('base64url');
}
/** Generate a UUID v4. */
function generateUUID() {
    return crypto_1.default.randomUUID();
}
/**
 * Produces a deterministic SHA-256 hex signature of a sorted consent payload.
 * Stored alongside consent records so tampering is detectable.
 */
function signConsentPayload(payload) {
    const canonical = JSON.stringify({
        ...payload,
        clauses: Object.fromEntries(Object.entries(payload.clauses).sort(([a], [b]) => a.localeCompare(b))),
    });
    return sha256Hex(canonical + HMAC_SECRET);
}
//# sourceMappingURL=index.js.map