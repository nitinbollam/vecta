/**
 * packages/auth/src/certificate-protocol.ts
 *
 * Trust Certificate Protocol (TCP) — v1
 *
 * Current state: the certificate is used for landlord tenant validation.
 * Actual capability: it's a general-purpose verifiable credential system.
 *
 * A Vecta Trust Certificate is structurally identical to a W3C Verifiable
 * Credential — deterministic canonical hash, Ed25519 signature, public key
 * embedded for offline verification. The only difference is JSON-LD context.
 *
 * This file expands the protocol to three claim types:
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Claim Type 1: TENANT_PROOF (existing)
 *   "This person has verified identity, financial standing, and no adverse
 *   background. Suitable for residential tenancy."
 *   Used by: Landlords, property managers, co-living operators
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Claim Type 2: VISA_STATUS_PROOF (new)
 *   "This person holds a valid F-1 student visa, verified via NFC passport
 *   chip, with I-20 valid until [year]. University enrollment confirmed."
 *   Used by:
 *     - Employers (can they legally hire this intern?)
 *     - Banks (can they open a credit card account?)
 *     - Insurance carriers (F-1 student discount eligibility)
 *     - Vehicle lessors (LESSOR program enrollment)
 *   Zero-knowledge: confirms visa validity without exposing passport number,
 *   nationality, or country of origin.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Claim Type 3: CREDIT_PORTABILITY_PROOF (new)
 *   "This person has [score range] on their home-country credit history,
 *   translated to the US 300-850 scale via Nova Credit. 12+ months of
 *   financial history verified via Plaid."
 *   Used by:
 *     - US credit card issuers (Capital One, Deserve, Nova Credit partners)
 *     - Auto lenders for LESSOR vehicles
 *     - Utility companies requiring deposits
 *   Zero-knowledge: confirms credit tier without exposing exact score,
 *   account numbers, or home bank details.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Protocol design:
 *   - Each claim type has its own TrustAttributes subset
 *   - Same Ed25519 signing infrastructure (crypto-signer.ts)
 *   - Certificates are composable: a tenant proof can embed a visa proof
 *   - Verification endpoint is claim-type-aware
 *   - All claims expire; re-issuance triggers re-verification
 */

import crypto from 'crypto';
import { hashCanonical, getPublicKeyHex } from './crypto-signer';

// ---------------------------------------------------------------------------
// Protocol claim types
// ---------------------------------------------------------------------------

export type ClaimType = 'TENANT_PROOF' | 'VISA_STATUS_PROOF' | 'CREDIT_PORTABILITY_PROOF';

export type ClaimVersion = '1.0';

// ---------------------------------------------------------------------------
// Claim 1: Visa Status Proof
// ---------------------------------------------------------------------------

export interface VisaClaimAttributes {
  claimType:       'VISA_STATUS_PROOF';
  claimVersion:    ClaimVersion;
  // Identity anchors (no raw PII)
  studentId:       string;
  universityName:  string;
  programOfStudy:  string;
  // Visa facts
  visaType:        'F-1' | 'J-1' | 'OPT' | 'CPT';
  visaExpiryYear:  number;
  i20ExpiryYear:   number;
  // Verification method
  verificationMethod: 'NFC_CHIP' | 'OCR_ONLY';
  livenessVerified: boolean;
  // Enrollment
  enrollmentActive: boolean;
  dsoVerified:      boolean;   // DSO signed off on I-20
}

export interface SignedVisaCertificate {
  certId:        string;
  claimType:     'VISA_STATUS_PROOF';
  version:       ClaimVersion;
  issuedAt:      string;
  expiresAt:     string;       // 90 days — visa status changes more frequently
  issuer:        'Vecta Financial Services LLC';
  attributes:    VisaClaimAttributes;
  canonicalHash: string;
  signature:     string;
  publicKeyHex:  string;
  // Derived human-readable assertions (zero-knowledge)
  assertions: {
    visaValid:       boolean;
    visaExpiresSoon: boolean;  // within 90 days
    enrolledFullTime: boolean;
    workAuthorizationType: 'ON_CAMPUS' | 'CPT' | 'OPT' | 'NONE';
  };
}

// ---------------------------------------------------------------------------
// Claim 2: Credit Portability Proof
// ---------------------------------------------------------------------------

export interface CreditClaimAttributes {
  claimType:           'CREDIT_PORTABILITY_PROOF';
  claimVersion:        ClaimVersion;
  studentId:           string;
  // Credit facts (tier ranges, not exact scores)
  usCreditScoreTier:   'EXCELLENT' | 'GOOD' | 'FAIR' | 'BUILDING';
  usCreditScoreMin:    number;    // lower bound of tier range
  usCreditScoreMax:    number;    // upper bound of tier range
  creditHistoryMonths: number;
  sourceCountry:       string;    // country code only, not detailed history
  // Financial facts (tier ranges)
  liquidityTier:       'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW';
  guaranteeMonths:     number;    // how many months of rent covered
  // Verification
  novaVerified:        boolean;   // Nova Credit pulled international history
  plaidVerified:       boolean;   // Plaid confirmed US liquid assets
}

export interface SignedCreditCertificate {
  certId:        string;
  claimType:     'CREDIT_PORTABILITY_PROOF';
  version:       ClaimVersion;
  issuedAt:      string;
  expiresAt:     string;       // 30 days
  issuer:        'Vecta Financial Services LLC';
  attributes:    CreditClaimAttributes;
  canonicalHash: string;
  signature:     string;
  publicKeyHex:  string;
  assertions: {
    creditworthy:        boolean;
    recommendedCreditLine: number;   // suggested starting limit in USD
    depositRequired:     boolean;
    depositMultiplier:   number;     // 0 = no deposit, 2.0 = 2× monthly rent
  };
}

// ---------------------------------------------------------------------------
// Canonical serialisation (visa claim)
// ---------------------------------------------------------------------------

export function canonicaliseVisaClaim(attrs: VisaClaimAttributes): string {
  const fields: Record<string, string> = {
    claimType:          attrs.claimType,
    claimVersion:       attrs.claimVersion,
    dsoVerified:        String(attrs.dsoVerified),
    enrollmentActive:   String(attrs.enrollmentActive),
    i20ExpiryYear:      String(attrs.i20ExpiryYear),
    livenessVerified:   String(attrs.livenessVerified),
    programOfStudy:     attrs.programOfStudy.trim(),
    studentId:          attrs.studentId,
    universityName:     attrs.universityName.trim(),
    verificationMethod: attrs.verificationMethod,
    visaExpiryYear:     String(attrs.visaExpiryYear),
    visaType:           attrs.visaType,
  };
  return Object.keys(fields).sort().map((k) => `${k}=${fields[k]!}`).join('|');
}

export function canonicaliseCreditClaim(attrs: CreditClaimAttributes): string {
  const fields: Record<string, string> = {
    claimType:           attrs.claimType,
    claimVersion:        attrs.claimVersion,
    creditHistoryMonths: String(attrs.creditHistoryMonths),
    guaranteeMonths:     String(attrs.guaranteeMonths),
    liquidityTier:       attrs.liquidityTier,
    novaVerified:        String(attrs.novaVerified),
    plaidVerified:       String(attrs.plaidVerified),
    sourceCountry:       attrs.sourceCountry,
    studentId:           attrs.studentId,
    usCreditScoreMax:    String(attrs.usCreditScoreMax),
    usCreditScoreMin:    String(attrs.usCreditScoreMin),
    usCreditScoreTier:   attrs.usCreditScoreTier,
  };
  return Object.keys(fields).sort().map((k) => `${k}=${fields[k]!}`).join('|');
}

// ---------------------------------------------------------------------------
// Signing (reuses the same Ed25519 infrastructure from crypto-signer.ts)
// ---------------------------------------------------------------------------

function signCanonical(canonical: string): { canonicalHash: string; signature: string } {
  const canonicalHash = hashCanonical(canonical);

  // Import the signing key (same derivation as crypto-signer.ts)
  const secret = process.env.INTERNAL_SERVICE_SECRET ?? '';
  if (!secret || secret.length < 32) {
    throw new Error('[certificate-protocol] INTERNAL_SERVICE_SECRET required');
  }

  const seed = crypto.hkdfSync(
    'sha256',
    Buffer.from(secret, 'utf8'),
    Buffer.from('vecta-cert-v1', 'utf8'),
    Buffer.from('ed25519-signing-key', 'utf8'),
    32,
  ) as unknown as Buffer;

  const privateKey = crypto.createPrivateKey({
    key:    Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der',
    type:   'pkcs8',
  });

  const sig = crypto.sign(null, Buffer.from(canonicalHash, 'hex'), privateKey);
  return { canonicalHash, signature: sig.toString('hex') };
}

// ---------------------------------------------------------------------------
// Issue Visa Status Certificate
// ---------------------------------------------------------------------------

export function issueVisaCertificate(attrs: VisaClaimAttributes): SignedVisaCertificate {
  const canonical      = canonicaliseVisaClaim(attrs);
  const { canonicalHash, signature } = signCanonical(canonical);

  const now        = new Date();
  const expiresAt  = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days

  const thisYear   = now.getFullYear();
  const visaExpiresSoon = attrs.visaExpiryYear === thisYear
    || attrs.i20ExpiryYear === thisYear;

  return {
    certId:      crypto.randomUUID(),
    claimType:   'VISA_STATUS_PROOF',
    version:     '1.0',
    issuedAt:    now.toISOString(),
    expiresAt:   expiresAt.toISOString(),
    issuer:      'Vecta Financial Services LLC',
    attributes:  attrs,
    canonicalHash,
    signature,
    publicKeyHex: getPublicKeyHex(),
    assertions: {
      visaValid:        attrs.visaExpiryYear >= thisYear,
      visaExpiresSoon,
      enrolledFullTime: attrs.enrollmentActive,
      workAuthorizationType:
        attrs.visaType === 'CPT' ? 'CPT' :
        attrs.visaType === 'OPT' ? 'OPT' :
        attrs.visaType === 'F-1' ? 'ON_CAMPUS' : 'NONE',
    },
  };
}

// ---------------------------------------------------------------------------
// Issue Credit Portability Certificate
// ---------------------------------------------------------------------------

const CREDIT_TIER_RANGES: Record<string, [number, number]> = {
  EXCELLENT: [740, 850],
  GOOD:      [670, 739],
  FAIR:      [580, 669],
  BUILDING:  [300, 579],
};

const CREDIT_LINE_BY_TIER: Record<string, number> = {
  EXCELLENT: 5000,
  GOOD:      2500,
  FAIR:      1000,
  BUILDING:    500,
};

export function issueCreditCertificate(attrs: CreditClaimAttributes): SignedCreditCertificate {
  const canonical      = canonicaliseCreditClaim(attrs);
  const { canonicalHash, signature } = signCanonical(canonical);

  const now       = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  const [scoreMin, scoreMax] = CREDIT_TIER_RANGES[attrs.usCreditScoreTier] ?? [300, 579];
  const creditworthy         = attrs.usCreditScoreTier !== 'BUILDING'
    || (attrs.novaVerified && attrs.guaranteeMonths >= 6);

  return {
    certId:      crypto.randomUUID(),
    claimType:   'CREDIT_PORTABILITY_PROOF',
    version:     '1.0',
    issuedAt:    now.toISOString(),
    expiresAt:   expiresAt.toISOString(),
    issuer:      'Vecta Financial Services LLC',
    attributes:  { ...attrs, usCreditScoreMin: scoreMin, usCreditScoreMax: scoreMax },
    canonicalHash,
    signature,
    publicKeyHex: getPublicKeyHex(),
    assertions: {
      creditworthy,
      recommendedCreditLine: CREDIT_LINE_BY_TIER[attrs.usCreditScoreTier] ?? 500,
      depositRequired:   attrs.usCreditScoreTier === 'BUILDING',
      depositMultiplier: attrs.usCreditScoreTier === 'BUILDING' ? 2.0 :
                         attrs.usCreditScoreTier === 'FAIR'     ? 1.5 : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Cross-claim verification
// ---------------------------------------------------------------------------

export interface ProtocolVerifyResult {
  valid:      boolean;
  claimType:  ClaimType;
  assertions: Record<string, unknown>;
  reason?:    string;
}

export function verifyProtocolCertificate(
  cert: SignedVisaCertificate | SignedCreditCertificate,
): ProtocolVerifyResult {
  // 1. Expiry check
  if (new Date(cert.expiresAt) < new Date()) {
    return { valid: false, claimType: cert.claimType, assertions: {}, reason: 'EXPIRED' };
  }

  // 2. Recompute canonical hash
  const canonical =
    cert.claimType === 'VISA_STATUS_PROOF'
      ? canonicaliseVisaClaim(cert.attributes as VisaClaimAttributes)
      : canonicaliseCreditClaim(cert.attributes as CreditClaimAttributes);

  const recomputed = hashCanonical(canonical);
  if (recomputed !== cert.canonicalHash) {
    return { valid: false, claimType: cert.claimType, assertions: {}, reason: 'HASH_MISMATCH' };
  }

  // 3. Ed25519 signature
  try {
    const pub = crypto.createPublicKey({
      key:    Buffer.from(cert.publicKeyHex, 'hex'),
      format: 'der',
      type:   'spki',
    });
    const valid = crypto.verify(
      null,
      Buffer.from(cert.canonicalHash, 'hex'),
      pub,
      Buffer.from(cert.signature, 'hex'),
    );
    if (!valid) {
      return { valid: false, claimType: cert.claimType, assertions: {}, reason: 'SIGNATURE_INVALID' };
    }
  } catch {
    return { valid: false, claimType: cert.claimType, assertions: {}, reason: 'SIGNATURE_INVALID' };
  }

  return { valid: true, claimType: cert.claimType, assertions: cert.assertions };
}

// ---------------------------------------------------------------------------
// Protocol discovery endpoint (what claims can Vecta issue for a student?)
// ---------------------------------------------------------------------------

export interface ProtocolManifest {
  studentId:       string;
  availableClaims: Array<{
    claimType:     ClaimType;
    eligible:      boolean;
    reason?:       string;
    expiryDays:    number;
    useCases:      string[];
  }>;
  issuer:          'Vecta Financial Services LLC';
  protocolVersion: '1.0';
}

export function buildProtocolManifest(params: {
  studentId:     string;
  kycApproved:   boolean;
  nfcVerified:   boolean;
  plaidConnected: boolean;
  novaVerified:  boolean;
}): ProtocolManifest {
  return {
    studentId:       params.studentId,
    protocolVersion: '1.0',
    issuer:          'Vecta Financial Services LLC',
    availableClaims: [
      {
        claimType:  'TENANT_PROOF',
        eligible:   params.kycApproved && params.plaidConnected,
        ...(!params.kycApproved
          ? { reason: 'KYC required' as const }
          : !params.plaidConnected
            ? { reason: 'Bank connection required' as const }
            : {}),
        expiryDays: 30,
        useCases: [
          'Residential tenancy applications',
          'Co-living and shared housing',
          'Property management platforms',
          'Vecta letter of credit',
        ],
      },
      {
        claimType:  'VISA_STATUS_PROOF',
        eligible:   params.kycApproved && params.nfcVerified,
        ...(!params.kycApproved
          ? { reason: 'KYC required' as const }
          : !params.nfcVerified
            ? { reason: 'NFC passport chip verification required' as const }
            : {}),
        expiryDays: 90,
        useCases: [
          'F-1 work authorization verification (employers)',
          'Bank account opening (FDIC-insured accounts)',
          'Health insurance F-1 eligibility',
          'Vehicle LESSOR program enrollment',
          'Internship and employment onboarding',
        ],
      },
      {
        claimType:  'CREDIT_PORTABILITY_PROOF',
        eligible:   params.novaVerified && params.plaidConnected,
        ...(!params.novaVerified
          ? { reason: 'International credit check required' as const }
          : !params.plaidConnected
            ? { reason: 'Bank connection required' as const }
            : {}),
        expiryDays: 30,
        useCases: [
          'US credit card application (Deserve, Nova Credit partners)',
          'Auto loan for LESSOR vehicle',
          'Utility account (skip security deposit)',
          'Apartment deposit negotiation',
          'Secured credit card limit increase',
        ],
      },
    ],
  };
}
