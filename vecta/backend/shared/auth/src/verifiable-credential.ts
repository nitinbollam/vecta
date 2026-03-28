/**
 * W3C Verifiable Credentials JSON-LD wrapper for Vecta Trust Certificates.
 */

import type { SignedTrustCertificate } from './crypto-signer';
import { getKeyRegistry, verifyWithKeyId } from './key-manager';

const VC_CONTEXT = [
  'https://www.w3.org/2018/credentials/v1',
  'https://vecta.io/credentials/v1',
];

export type VectaCredentialType =
  | 'TenantProofCredential'
  | 'VisaStatusCredential'
  | 'CreditPortabilityCredential'
  | 'ReputationScoreCredential';

export interface VectaCredentialSubject {
  id: string;
  identityVerified?: boolean;
  nfcChipVerified?: boolean;
  livenessConfirmed?: boolean;
  universityEnrolled?: boolean;
  universityName?: string;
  visaType?: string;
  visaValid?: boolean;
  visaExpiryYear?: number;
  solvencyTier?: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  monthsRentCovered?: number;
  maxMonthlyRent?: number;
  creditTier?: 'POOR' | 'FAIR' | 'GOOD' | 'EXCELLENT' | 'BUILDING';
  creditVerifiedDate?: string;
  onTimePayments?: number;
  totalPayments?: number;
  repaymentRate?: number;
  reputationScore?: number;
  monthsOfHistory?: number;
}

/** W3C proof + Vecta extension carrying the signed digest (same bytes as Ed25519 verify). */
export interface VectaProof {
  type: 'Ed25519Signature2020';
  created: string;
  verificationMethod: string;
  proofPurpose: 'assertionMethod';
  proofValue: string;
  /** Same 64-char SHA-256 hex payload that was signed for the underlying trust certificate. */
  vectaCanonicalDigestHex: string;
}

export interface VectaCredentialStatus {
  id: string;
  type: 'VectaCredentialStatusList';
}

export interface VectaVerifiableCredential {
  '@context': string[];
  id: string;
  type: ['VerifiableCredential', VectaCredentialType];
  issuer: string;
  issuanceDate: string;
  expirationDate: string;
  credentialSubject: VectaCredentialSubject;
  proof: VectaProof;
  credentialStatus?: VectaCredentialStatus;
}

const B58 =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Bitcoin-style base58 (no checksum). Exported for DID documents. */
export function base58Encode(buf: Buffer): string {
  const bytes = [...buf];
  let zeros = 0;
  for (const b of bytes) {
    if (b === 0) zeros++;
    else break;
  }
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  if (n === 0n) return B58[0]!.repeat(zeros) || B58[0]!;
  let out = '';
  while (n > 0n) {
    const r = Number(n % 58n);
    out = B58[r]! + out;
    n = n / 58n;
  }
  return B58[0]!.repeat(zeros) + out;
}

function base58DecodeToBuffer(str: string): Buffer {
  let leading = 0;
  for (let i = 0; i < str.length && str[i] === B58[0]; i++) leading++;
  let n = 0n;
  for (const c of str) {
    const idx = B58.indexOf(c);
    if (idx < 0) throw new Error('INVALID_BASE58');
    n = n * 58n + BigInt(idx);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const body = Buffer.from(hex, 'hex');
  return Buffer.concat([Buffer.alloc(leading), body]);
}

export function base58DecodeToHex(str: string): string {
  return base58DecodeToBuffer(str).toString('hex');
}

export function wrapAsVerifiableCredential(
  cert: SignedTrustCertificate,
  studentId: string,
  credentialType: VectaCredentialType,
  baseUrl: string = 'https://verify.vecta.io',
): VectaVerifiableCredential {
  const registry = getKeyRegistry();
  const keyId = cert.keyId ?? registry.getCurrentKeyId();

  const subject = buildCredentialSubject(cert, studentId, credentialType);
  const proofValue = base58Encode(Buffer.from(cert.signature, 'hex'));

  return {
    '@context': VC_CONTEXT,
    id: `${baseUrl.replace(/\/+$/, '')}/credentials/${cert.certId}`,
    type: ['VerifiableCredential', credentialType],
    issuer: 'https://vecta.io/issuers/vecta-financial',
    issuanceDate: cert.issuedAt,
    expirationDate: cert.expiresAt,
    credentialSubject: subject,
    proof: {
      type: 'Ed25519Signature2020',
      created: cert.issuedAt,
      verificationMethod: `${baseUrl.replace(/\/+$/, '')}/.well-known/vecta-keys.json#${keyId}`,
      proofPurpose: 'assertionMethod',
      proofValue,
      vectaCanonicalDigestHex: cert.canonicalHash,
    },
    credentialStatus: {
      id: `${baseUrl.replace(/\/+$/, '')}/credentials/status/${cert.certId}`,
      type: 'VectaCredentialStatusList',
    },
  };
}

function buildCredentialSubject(
  cert: SignedTrustCertificate,
  studentId: string,
  type: VectaCredentialType,
): VectaCredentialSubject {
  const attrs = cert.attributes;
  const didId = `did:vecta:${studentId}`;
  const year = new Date().getFullYear();

  switch (type) {
    case 'TenantProofCredential':
      return {
        id: didId,
        identityVerified: attrs.kycStatus === 'APPROVED',
        nfcChipVerified: attrs.nfcChipVerified,
        livenessConfirmed: attrs.livenessScore >= 0.92,
        universityEnrolled: !!attrs.universityName,
        universityName: attrs.universityName,
        visaType: attrs.visaType,
        visaValid: attrs.visaExpiryYear > year,
        visaExpiryYear: attrs.visaExpiryYear,
        solvencyTier: attrs.balanceTier,
        monthsRentCovered: attrs.guaranteeMonths,
        maxMonthlyRent: attrs.maxRentApproval,
        creditTier: mapNovaTierToVc(attrs.novaScoreTier),
      };

    case 'VisaStatusCredential':
      return {
        id: didId,
        visaType: attrs.visaType,
        visaValid: attrs.visaExpiryYear > year,
        visaExpiryYear: attrs.visaExpiryYear,
        nfcChipVerified: attrs.nfcChipVerified,
        universityEnrolled: !!attrs.universityName,
        universityName: attrs.universityName,
      };

    case 'CreditPortabilityCredential':
      return {
        id: didId,
        creditTier: mapNovaTierToVc(attrs.novaScoreTier),
        creditVerifiedDate: cert.issuedAt,
        solvencyTier: attrs.balanceTier,
        monthsRentCovered: attrs.guaranteeMonths,
      };

    case 'ReputationScoreCredential': {
      const subj: VectaCredentialSubject = {
        id: didId,
        creditVerifiedDate: cert.issuedAt,
      };
      if (attrs.reputationScore !== undefined) subj.reputationScore = attrs.reputationScore;
      if (attrs.onTimePayments !== undefined) subj.onTimePayments = attrs.onTimePayments;
      if (attrs.monthsOfHistory !== undefined) subj.monthsOfHistory = attrs.monthsOfHistory;
      if (attrs.reputationTier) {
        subj.creditTier = attrs.reputationTier as NonNullable<VectaCredentialSubject['creditTier']>;
      }
      return subj;
    }

    default:
      return { id: didId };
  }
}

function mapNovaTierToVc(tier: string): 'EXCELLENT' | 'GOOD' | 'FAIR' | 'BUILDING' {
  const t = tier.toUpperCase();
  if (t === 'EXCELLENT') return 'EXCELLENT';
  if (t === 'GOOD') return 'GOOD';
  if (t === 'FAIR') return 'FAIR';
  if (t === 'BUILDING') return 'BUILDING';
  return 'FAIR';
}

export function verifyVerifiableCredential(vc: VectaVerifiableCredential): {
  valid: boolean;
  reason?: string;
} {
  if (new Date(vc.expirationDate) < new Date()) {
    return { valid: false, reason: 'CREDENTIAL_EXPIRED' };
  }

  if (vc.issuer !== 'https://vecta.io/issuers/vecta-financial') {
    return { valid: false, reason: 'INVALID_ISSUER' };
  }

  const keyId = vc.proof.verificationMethod.split('#')[1];
  if (!keyId) return { valid: false, reason: 'MISSING_KEY_ID' };

  const digestHex = vc.proof.vectaCanonicalDigestHex;
  if (!digestHex || !/^[0-9a-f]{64}$/i.test(digestHex)) {
    return { valid: false, reason: 'MISSING_CANONICAL_DIGEST' };
  }

  let sigHex: string;
  try {
    sigHex = base58DecodeToHex(vc.proof.proofValue);
  } catch {
    return { valid: false, reason: 'INVALID_PROOF_ENCODING' };
  }

  if (!/^[0-9a-f]{128}$/i.test(sigHex)) {
    return { valid: false, reason: 'INVALID_SIGNATURE_LENGTH' };
  }

  return verifyWithKeyId(digestHex.toLowerCase(), sigHex.toLowerCase(), keyId);
}
