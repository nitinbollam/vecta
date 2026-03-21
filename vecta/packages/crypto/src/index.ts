/**
 * @vecta/crypto — AES-256-GCM field-level encryption for PII
 *
 * Key derivation: PBKDF2-SHA512, 600 000 iterations (OWASP 2024 minimum).
 * Each encrypted value is self-contained:  iv:authTag:ciphertext  (Base64url, colon-delimited).
 * NEVER log plain-text values or key material.
 */

import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Key bootstrap
// ---------------------------------------------------------------------------

const RAW_KEY = process.env.VECTA_FIELD_ENCRYPTION_KEY;
if (!RAW_KEY || RAW_KEY.length < 32) {
  throw new Error(
    '[vecta/crypto] VECTA_FIELD_ENCRYPTION_KEY must be set and ≥ 32 chars',
  );
}

const SALT = Buffer.from(
  process.env.VECTA_ENCRYPTION_SALT ?? 'vecta-pii-salt-v1',
  'utf8',
);

/** Derived 256-bit key — computed once at module load. */
const MASTER_KEY: Buffer = crypto.pbkdf2Sync(
  RAW_KEY,
  SALT,
  600_000,
  32,
  'sha512',
);

const HMAC_SECRET = process.env.VECTA_HMAC_SECRET ?? RAW_KEY;

// ---------------------------------------------------------------------------
// Core encrypt / decrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt a UTF-8 string with AES-256-GCM.
 * Returns a compact token:  `<iv_b64url>:<authTag_b64url>:<ciphertext_b64url>`
 */
export function encryptField(plaintext: string): string {
  const iv = crypto.randomBytes(12); // 96-bit IV — GCM standard
  const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);

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
export function decryptField(token: string): string {
  const parts = token.split(':');
  if (parts.length !== 3) {
    throw new Error('[vecta/crypto] Malformed encrypted field token');
  }

  const [ivB64, tagB64, ciphertextB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64url');
  const authTag = Buffer.from(tagB64, 'base64url');
  const ciphertext = Buffer.from(ciphertextB64, 'base64url');

  const decipher = crypto.createDecipheriv('aes-256-gcm', MASTER_KEY, iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
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
export function hmacSign(payload: string, secret?: string): string {
  return crypto
    .createHmac('sha256', secret ?? HMAC_SECRET)
    .update(payload)
    .digest('hex');
}

/** Timing-safe HMAC comparison — prevents timing-oracle attacks. */
export function hmacVerify(
  payload: string,
  signature: string,
  secret?: string,
): boolean {
  const expected = hmacSign(payload, secret);
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signature, 'hex'),
  );
}

// ---------------------------------------------------------------------------
// Hash utilities
// ---------------------------------------------------------------------------

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function sha256B64(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('base64url');
}

/** Generate a cryptographically random token (URL-safe Base64). */
export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Generate a UUID v4. */
export function generateUUID(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Consent signature — used by VehicleEnrollmentService
// ---------------------------------------------------------------------------

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
export function signConsentPayload(payload: ConsentPayload): string {
  const canonical = JSON.stringify({
    ...payload,
    clauses: Object.fromEntries(
      Object.entries(payload.clauses).sort(([a], [b]) => a.localeCompare(b)),
    ),
  });
  return sha256Hex(canonical + HMAC_SECRET);
}
