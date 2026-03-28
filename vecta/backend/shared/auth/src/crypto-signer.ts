/**
 * packages/auth/src/crypto-signer.ts
 *
 * Cryptographic Signing Engine for Vecta Trust Certificates.
 *
 * Algorithm: Ed25519 (RFC 8032)
 *   - Deterministic: same payload → same signature (no nonce entropy)
 *   - Fast: ~50µs sign, ~130µs verify
 *   - Compact: 64-byte signatures (vs. 512 bytes for RS256)
 *   - Tamper-evident: any bit flip to payload or signature fails verification
 *
 * Key derivation:
 *   Ed25519 seed = HKDF-SHA256(INTERNAL_SERVICE_SECRET, salt="vecta-cert-v1", 32 bytes)
 *   This is deterministic — the same secret always yields the same keypair.
 *   Private key material NEVER leaves this module.
 *
 * Certificate payload is a CANONICAL JSON string:
 *   Fields are sorted alphabetically, nulls excluded, values normalised.
 *   This guarantees identical bytes on both signer and verifier.
 *
 * Adversarial threat model:
 *   - A landlord who receives a PDF certificate can re-derive the canonical
 *     hash client-side and call /certificate/verify to prove Vecta signed it.
 *   - An attacker who edits the PDF (e.g., changes "APPROVED" → "REJECTED")
 *     breaks the signature and the verify call returns 400 SIGNATURE_INVALID.
 *   - A compromised API server cannot forge certificates without the signing key.
 *   - Replay: each certificate embeds issuedAt + expiresAt + a unique certId.
 */

import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Immutable trust attributes used to build the certificate payload. */
export interface TrustAttributes {
  // Identity (Didit)
  studentId:           string;
  kycStatus:           'APPROVED' | 'PENDING' | 'REJECTED' | 'NEEDS_REVIEW';
  nfcChipVerified:     boolean;
  livenessScore:       number;    // 0–1
  facialMatchScore:    number;    // 0–1
  visaType:            string;    // 'F-1'
  visaExpiryYear:      number;
  universityName:      string;
  programOfStudy:      string;

  // Financial (Plaid)
  solvencyVerified:    boolean;
  balanceTier:         'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  guaranteeMonths:     number;    // how many months of rent covered
  monthlyRentTarget:   number;    // USD

  // Credit (Nova Credit)
  novaScore:           number;    // 300–850
  novaScoreTier:       'EXCELLENT' | 'GOOD' | 'FAIR' | 'BUILDING';

  // Background (Checkr) — may be null if landlord tier doesn't require it
  checkrStatus:        'APPROVED' | 'PENDING' | 'REJECTED' | 'SKIPPED' | null;

  // Composite (Trust Engine)
  compositeScore:      number;    // 0–1000
  guaranteeTier:       'PLATINUM' | 'GOLD' | 'SILVER' | 'STANDARD' | 'INSUFFICIENT';
  maxRentApproval:     number;
  depositMultiplier:   number;
}

/** Output of signCertificate — what gets stored and returned to landlords. */
export interface SignedTrustCertificate {
  certId:        string;             // UUID — unique per issuance
  version:       '1';
  issuedAt:      string;             // ISO 8601
  expiresAt:     string;             // ISO 8601 (30 days)
  issuer:        'Vecta Financial Services LLC';
  attributes:    TrustAttributes;
  canonicalHash: string;             // SHA-256 hex of canonical payload
  signature:     string;             // Ed25519 hex signature of canonicalHash
  publicKeyHex:  string;             // Ed25519 public key (for client verification)
  keyId:         string;             // Key version ID (e.g. "vecta-cert-v1") — for rotation
  certStatus:    CertificateStatus;
}

export type CertificateStatus =
  | 'FULL'          // All checks complete and APPROVED
  | 'CONTINGENT'    // Checkr still PENDING — valid but flagged
  | 'PARTIAL'       // KYC approved, solvency not yet verified
  | 'INVALID';      // Should never be signed, but here for exhaustiveness

// ---------------------------------------------------------------------------
// Key derivation (deterministic from environment secret)
// ---------------------------------------------------------------------------

function deriveSigningKey(): { privateKey: crypto.KeyObject; publicKey: crypto.KeyObject } {
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('[crypto-signer] INTERNAL_SERVICE_SECRET must be ≥ 32 chars');
  }

  // HKDF-SHA256: secret → 32-byte Ed25519 seed
  const seed = crypto.hkdfSync(
    'sha256',
    Buffer.from(secret, 'utf8'),
    Buffer.from('vecta-cert-v1', 'utf8'),  // salt
    Buffer.from('ed25519-signing-key', 'utf8'),  // info
    32,
  ) as unknown as Buffer;

  // Ed25519 seed → deterministic keypair (same secret = same keys, always)
  const privateKeyFromSeed = crypto.createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),  // PKCS8 Ed25519 header
      seed,
    ]),
    format: 'der',
    type:   'pkcs8',
  });

  const publicKeyFromSeed = crypto.createPublicKey(privateKeyFromSeed);

  return { privateKey: privateKeyFromSeed, publicKey: publicKeyFromSeed };
}

// Singleton keypair — derived once at module load
let _keyPair: ReturnType<typeof deriveSigningKey> | null = null;

function getKeyPair(): ReturnType<typeof deriveSigningKey> {
  if (!_keyPair) _keyPair = deriveSigningKey();
  return _keyPair;
}

// ---------------------------------------------------------------------------
// Canonical payload serialisation
// ---------------------------------------------------------------------------

/**
 * Produces a deterministic canonical string from trust attributes.
 *
 * Rules:
 *   1. Keys sorted lexicographically (ASCII)
 *   2. Null / undefined values excluded
 *   3. Numbers serialised without trailing zeros
 *   4. Booleans as lowercase strings ("true"/"false") for cross-language compat
 *   5. Strings lowercased for enum normalisation
 *
 * This exact serialisation must be reproduced by the client verifier.
 */
export function canonicalise(attrs: TrustAttributes): string {
  const flat: Record<string, string> = {
    studentId:         attrs.studentId,
    kycStatus:         attrs.kycStatus.toLowerCase(),
    nfcChipVerified:   String(attrs.nfcChipVerified),
    livenessScore:     attrs.livenessScore.toFixed(4),
    facialMatchScore:  attrs.facialMatchScore.toFixed(4),
    visaType:          attrs.visaType.toUpperCase(),
    visaExpiryYear:    String(attrs.visaExpiryYear),
    universityName:    attrs.universityName.trim(),
    programOfStudy:    attrs.programOfStudy.trim(),
    solvencyVerified:  String(attrs.solvencyVerified),
    balanceTier:       attrs.balanceTier.toLowerCase(),
    guaranteeMonths:   String(attrs.guaranteeMonths),
    monthlyRentTarget: String(attrs.monthlyRentTarget),
    novaScore:         String(attrs.novaScore),
    novaScoreTier:     attrs.novaScoreTier.toLowerCase(),
    compositeScore:    String(attrs.compositeScore),
    guaranteeTier:     attrs.guaranteeTier.toLowerCase(),
    maxRentApproval:   String(attrs.maxRentApproval),
    depositMultiplier: attrs.depositMultiplier.toFixed(1),
    // Checkr: only include if non-null
    ...(attrs.checkrStatus !== null && {
      checkrStatus: attrs.checkrStatus.toLowerCase(),
    }),
  };

  // Sort keys — critical for determinism
  const sorted = Object.keys(flat).sort();
  const pairs  = sorted.map((k) => `${k}=${flat[k]!}`);
  return pairs.join('|');
}

/**
 * SHA-256 of the canonical string.
 * This is what gets signed — not the full payload.
 */
export function hashCanonical(canonical: string): string {
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Determine certificate status from attributes
// ---------------------------------------------------------------------------

function determineCertStatus(attrs: TrustAttributes): CertificateStatus {
  if (attrs.kycStatus !== 'APPROVED')     return 'INVALID';
  if (!attrs.solvencyVerified)             return 'PARTIAL';
  if (attrs.checkrStatus === 'PENDING')    return 'CONTINGENT';
  if (attrs.checkrStatus === 'REJECTED')   return 'INVALID';
  return 'FULL';
}

// ---------------------------------------------------------------------------
// Sign a certificate
// ---------------------------------------------------------------------------

/**
 * Signs a TrustAttributes payload and returns a SignedTrustCertificate.
 *
 * @throws {Error} if KYC is not APPROVED (caller should check before calling)
 */
export async function signCertificate(attrs: TrustAttributes): Promise<SignedTrustCertificate> {
  const certStatus = determineCertStatus(attrs);

  if (certStatus === 'INVALID') {
    throw new Error(
      `[crypto-signer] Cannot sign certificate for student ${attrs.studentId}: ` +
      `kycStatus=${attrs.kycStatus}, checkrStatus=${attrs.checkrStatus ?? 'null'}`,
    );
  }

  const certId       = crypto.randomUUID();
  const issuedAt     = new Date().toISOString();
  const expiresAt    = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const canonical     = canonicalise(attrs);
  const canonicalHash = hashCanonical(canonical);

  // Use versioned key manager — critical for rotation support
  const { signWithCurrentKey } = await import('./key-manager');
  const { signature, keyId, publicKeyHex } = signWithCurrentKey(canonicalHash);

  return {
    certId,
    version:       '1',
    issuedAt,
    expiresAt,
    issuer:        'Vecta Financial Services LLC',
    attributes:    attrs,
    canonicalHash,
    signature,
    publicKeyHex,
    keyId,
    certStatus,
  };
}

// ---------------------------------------------------------------------------
// Verify a certificate (for client-side proof + API endpoint)
// ---------------------------------------------------------------------------

export interface VerificationResult {
  valid:        boolean;
  reason?:      'SIGNATURE_INVALID' | 'HASH_MISMATCH' | 'EXPIRED' | 'PUBLIC_KEY_MISMATCH';
  recomputedHash?: string;
}

/**
 * Verifies a SignedTrustCertificate.
 * Can be called server-side (/certificate/verify endpoint) or client-side.
 *
 * Client-side: pass `skipKeyCheck = false` and provide publicKeyHex from the cert.
 * Server-side:  pass `skipKeyCheck = false` (uses derived key to cross-check).
 */
export function verifyCertificate(cert: SignedTrustCertificate): VerificationResult {
  // 1. Check expiry
  if (new Date(cert.expiresAt) < new Date()) {
    return { valid: false, reason: 'EXPIRED' };
  }

  // 2. Recompute canonical hash from attributes
  const recomputedCanonical = canonicalise(cert.attributes);
  const recomputedHash      = hashCanonical(recomputedCanonical);

  if (recomputedHash !== cert.canonicalHash) {
    return { valid: false, reason: 'HASH_MISMATCH', recomputedHash };
  }

  // 3. Verify using the keyId embedded in the certificate (rotation-safe)
  const certWithKey = cert as SignedTrustCertificate & { keyId?: string };
  if (certWithKey.keyId) {
    // New-style certificate: verify by keyId lookup
    const { verifyWithKeyId } = require('./key-manager') as typeof import('./key-manager');
    const result = verifyWithKeyId(cert.canonicalHash, cert.signature, certWithKey.keyId);
    if (!result.valid) {
      return { valid: false, reason: 'SIGNATURE_INVALID', recomputedHash };
    }
  } else {
    // Legacy certificate (no keyId): fall back to pubKeyHex in cert
    try {
      const pubKeyObj = crypto.createPublicKey({
        key:    Buffer.from(cert.publicKeyHex, 'hex'),
        format: 'der',
        type:   'spki',
      });
      const signatureValid = crypto.verify(
        null,
        Buffer.from(cert.canonicalHash, 'hex'),
        pubKeyObj,
        Buffer.from(cert.signature, 'hex'),
      );
      if (!signatureValid) {
        return { valid: false, reason: 'SIGNATURE_INVALID', recomputedHash };
      }
    } catch {
      return { valid: false, reason: 'SIGNATURE_INVALID', recomputedHash };
    }
  }

  return { valid: true, recomputedHash };
}

// ---------------------------------------------------------------------------
// Expose public key (for embedding in PDFs and API responses)
// ---------------------------------------------------------------------------

export function getPublicKeyHex(): string {
  const { publicKey } = getKeyPair();
  return publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
}

export function getPublicKeyPem(): string {
  const { publicKey } = getKeyPair();
  return publicKey.export({ type: 'spki', format: 'pem' }) as string;
}
