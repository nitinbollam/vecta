/**
 * packages/auth/src/index.ts
 *
 * Barrel export for @vecta/auth package.
 * Import from '@vecta/auth' or specific subpaths:
 *   import { checkPermission } from '@vecta/auth'
 *   import { authMiddleware }  from '@vecta/auth/middleware'
 *   import { consumeToken }    from '@vecta/auth/single-use-token'
 */

// RBAC — permission map + role definitions (session-cookie path uses requireSessionPermission)
export {
  PERMISSION_MAP,
  assertRoleConflictFree,
  requireSessionPermission,
  validateSession,
  RoleConflictError,
  F1ComplianceError,
  checkPermission,
  type UserRole,
  type RBACResult,
  type AuthenticatedRequest,
} from './rbac';

// Express JWT middleware + permission guards
export {
  authMiddleware,
  requirePermission,
  requireKYC,
  requireLandlordRole,
} from './middleware';

// Single-use token registry
export {
  registerToken,
  consumeToken,
  revokeToken,
  listActiveTokens,
  type ConsumeResult,
} from './single-use-token';

// RBAC audit trail
export {
  auditRBACDecision,
  queryRBACLog,
  getF1ViolationBlockCount,
  type RBACDecision,
  type RBACAuditQuery,
} from './rbac-audit';

// Landlord access tiering
export {
  landlordCan,
  requireLandlordPermission,
  buildLandlordContext,
  filterViewForTier,
  type LandlordTier,
  type LandlordAccessContext,
} from './landlord-access';

// Cryptographic certificate signing (Ed25519)
export {
  signCertificate,
  verifyCertificate,
  canonicalise,
  hashCanonical,
  getPublicKeyHex,
  getPublicKeyPem,
  type TrustAttributes,
  type SignedTrustCertificate,
  type CertificateStatus,
  type VerificationResult,
} from './crypto-signer';

// Trust Certificate Protocol — visa proof + credit portability
export {
  issueVisaCertificate,
  issueCreditCertificate,
  verifyProtocolCertificate,
  buildProtocolManifest,
  canonicaliseVisaClaim,
  canonicaliseCreditClaim,
  type ClaimType,
  type ClaimVersion,
  type VisaClaimAttributes,
  type SignedVisaCertificate,
  type CreditClaimAttributes,
  type SignedCreditCertificate,
  type ProtocolManifest,
  type ProtocolVerifyResult,
} from './certificate-protocol';

// Key management — versioned rotation, JWKS, backward-compatible verify
export {
  getKeyRegistry,
  buildJWKS,
  signWithCurrentKey,
  verifyWithKeyId,
  type KeyVersion,
  type JWK,
  type JWKS,
} from './key-manager';

// Internal HMAC request signing (service-to-service)
export { signInternalRequest, verifyInternalRequest } from './internal-request-signer';

// W3C Verifiable Credentials wrapper
export {
  wrapAsVerifiableCredential,
  verifyVerifiableCredential,
  base58Encode,
  base58DecodeToHex,
  type VectaVerifiableCredential,
  type VectaCredentialType,
  type VectaCredentialSubject,
  type VectaProof,
} from './verifiable-credential';
