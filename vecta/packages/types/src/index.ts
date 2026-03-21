// packages/types/src/index.ts
// ─── Vecta Platform — Canonical Type Definitions ─────────────────────────────
// All cross-service contracts live here. Never import from sibling services.

import { z } from "zod";

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum VisaStatus {
  F1_ACTIVE = "F1_ACTIVE",
  F1_OPT = "F1_OPT",
  F1_CPT = "F1_CPT",
  F1_GRACE = "F1_GRACE",
  F2_DEPENDENT = "F2_DEPENDENT",
}

export enum KYCStatus {
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  NEEDS_REVIEW = "NEEDS_REVIEW",
}

export enum VectaIDStatus {
  UNVERIFIED = "UNVERIFIED",
  IDENTITY_VERIFIED = "IDENTITY_VERIFIED",      // Didit NFC + liveness passed
  BANKING_PROVISIONED = "BANKING_PROVISIONED",  // Unit.co DDA opened
  FULLY_ACTIVE = "FULLY_ACTIVE",                // All checks passed
}

export enum StudentRole {
  STUDENT = "STUDENT",
  LESSOR = "LESSOR",   // Vehicle enrolled in fleet. CANNOT accept rides.
  // DRIVER role intentionally omitted for F-1 compliance.
}

export enum AuditEventType {
  IDENTITY_VERIFIED = "IDENTITY_VERIFIED",
  KYC_SUBMITTED = "KYC_SUBMITTED",
  KYC_APPROVED = "KYC_APPROVED",
  ACCOUNT_PROVISIONED = "ACCOUNT_PROVISIONED",
  ESIM_ACTIVATED = "ESIM_ACTIVATED",
  INSURANCE_QUOTED = "INSURANCE_QUOTED",
  VEHICLE_ENROLLED = "VEHICLE_ENROLLED",
  VEHICLE_LEASE_SIGNED = "VEHICLE_LEASE_SIGNED",
  RIDE_STARTED = "RIDE_STARTED",
  RIDE_COMPLETED = "RIDE_COMPLETED",
  RENTAL_INCOME_RECORDED = "RENTAL_INCOME_RECORDED",
  DSO_MEMO_GENERATED = "DSO_MEMO_GENERATED",
  LANDLORD_VERIFICATION = "LANDLORD_VERIFICATION",
}

// ─── Vecta ID Token (JWT Payload) ─────────────────────────────────────────────
// This is the payload embedded in the cryptographically signed JWT.
// The landlord portal verifies this JWT without ever seeing vaulted fields.

export interface VectaIDTokenPayload {
  // Public fields — presented to landlord
  sub: string;                  // Internal Vecta student UUID (NOT passport number)
  legalName: string;            // Full name as on passport
  facialPhotoUrl: string;       // Signed S3 URL to Didit liveness selfie (expires 1h)
  idStatus: VectaIDStatus;
  visaType: VisaStatus;
  visaExpiryYear: number;
  universityName: string;
  universityEnrollmentVerified: boolean;
  usPhoneNumber: string;        // eSIM-provisioned number
  verifiedEmail: string;

  // Financial summary — presented to landlord (no raw figures)
  vectaTrustScore: number;       // 300–850 Nova Credit translated score
  trustScoreTier: "EXCELLENT" | "GOOD" | "FAIR" | "BUILDING";
  solvencyGuaranteeMonths: number;
  letterOfCreditId: string;      // UUID of the signed LoC PDF
  rentSplitEnabled: boolean;

  // JWT standard claims
  iat: number;
  exp: number;
  iss: "vecta.platform";
  jti: string;   // Unique token ID for revocation

  /** API gateway tokens: RBAC role (student app). Omitted on landlord-sharing payloads. */
  role?: string;
  /** API gateway tokens: KYC lifecycle. Omitted when not applicable. */
  kycStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NEEDS_REVIEW';

  // ─── VAULTED — never present in JWT payload ───────────────────────────────
  // passportNumber     -> stored encrypted in DB (AES-256-GCM)
  // countryOfOrigin    -> stored encrypted in DB (Fair Housing protection)
  // i20Document        -> stored encrypted in DB (SEVIS ID exposure risk)
  // unitAccountId      -> stored encrypted in DB (exact balance hidden)
  // homeBankAccountDetails -> never stored in platform DB at all
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

export const DiditPassportDataSchema = z.object({
  // Raw NFC chip data from Didit SDK
  mrz: z.object({
    surname: z.string().min(1),
    givenNames: z.string().min(1),
    documentNumber: z.string().regex(/^[A-Z0-9]{9}$/),
    nationality: z.string().length(3),   // ISO 3166-1 alpha-3
    dateOfBirth: z.string().regex(/^\d{6}$/),
    sex: z.enum(["M", "F", "X"]),
    expiryDate: z.string().regex(/^\d{6}$/),
    issuingState: z.string().length(3),
  }),
  livenessScore: z.number().min(0).max(1),
  facialMatchScore: z.number().min(0).max(1),
  chipVerified: z.boolean(),
  selfieImageBase64: z.string(),
  sessionId: z.string().uuid(),
  verifiedAt: z.string().datetime(),
});

export type DiditPassportData = z.infer<typeof DiditPassportDataSchema>;

export const UnitCustomerCreateSchema = z.object({
  fullName: z.string(),
  email: z.string().email(),
  phone: z.string(),
  dateOfBirth: z.string(),
  address: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string().length(2),
    postalCode: z.string(),
    country: z.literal("US"),
  }),
  ssnLast4: z.string().regex(/^\d{4}$/).optional(),
  // For F-1 students: passport used instead of SSN
  passportNumber: z.string().optional(),
  passportCountry: z.string().length(3).optional(),
  passportExpiry: z.string().optional(),
  visaType: z.nativeEnum(VisaStatus),
  sevisId: z.string().regex(/^N\d{10}$/).optional(),
});

export type UnitCustomerCreate = z.infer<typeof UnitCustomerCreateSchema>;

// ─── Nova Credit ──────────────────────────────────────────────────────────────

export interface NovaCreditResult {
  cashScore: number;          // 300–850 translated to US-equivalent
  originalScore: number;
  originalScoreRange: { min: number; max: number };
  bureauCountry: string;
  bureauName: string;
  reportId: string;
  fetchedAt: string;
  factors: Array<{
    code: string;
    description: string;
    impact: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  }>;
}

// ─── Plaid ────────────────────────────────────────────────────────────────────

export interface PlaidSolvencyReport {
  studentId: string;
  reportId: string;
  verifiedAt: string;
  totalVerifiedBalanceUSD: number;
  monthsRentCoverage: number;
  guaranteeStatement: string;
  cryptographicHash: string;   // SHA-256 of report contents for tamper-evidence
  signatureKeyId: string;      // KMS key ID used to sign
}

// ─── eSIM ─────────────────────────────────────────────────────────────────────

export interface ESIMProvisionResult {
  iccid: string;
  activationCode: string;
  usPhoneNumber: string;
  plan: "5G_UNLIMITED" | "5G_10GB" | "LTE_5GB";
  activatedAt: string;
  // IMEI is accepted as input but NEVER returned or stored in this object
}

// ─── Insurance ────────────────────────────────────────────────────────────────

export interface InsuranceQuote {
  provider: "ISO" | "PSI" | "LEMONADE" | "CUSTOM";
  type: "MEDICAL_WAIVER" | "RENTERS" | "AUTO";
  monthlyPremium: number;
  annualPremium: number;
  deductible?: number;
  coverageLimit?: number;
  quoteId: string;
  expiresAt: string;
  /** Carrier-specific coverage payload (e.g. Lemonade). */
  coverageDetails?: Record<string, unknown>;
  bindUrl?: string;
  warnings?: string[];
}

export interface MedicalWaiverAnalysis {
  universityPlanName: string;
  annualDeductible: number;
  outOfPocketMax: number;
  mentalHealthCoverage: boolean;
  dentalCoverage: boolean;
  visionCoverage: boolean;
  meetsF1Requirements: boolean;
  aiConfidenceScore: number;   // 0–1
  extractedAt: string;
  alternativeQuotes: InsuranceQuote[];
}

// ─── Roommate Matching ────────────────────────────────────────────────────────

export interface StudentLifestyleProfile {
  studentId: string;
  major: string;
  universityId: string;
  sleepSchedule: "EARLY_BIRD" | "NIGHT_OWL" | "FLEXIBLE";
  studyEnvironment: "SILENT" | "BACKGROUND_NOISE" | "SOCIAL";
  guestFrequency: "NEVER" | "RARELY" | "SOMETIMES" | "OFTEN";
  cleanlinessLevel: 1 | 2 | 3 | 4 | 5;
  dietaryRestrictions: string[];
  languages: string[];
  hobbies: string[];
  preferredMoveInDate: string;
  budgetMin: number;
  budgetMax: number;
  // pgvector embedding — stored in DB, not transmitted via API
  // embedding: number[];
}

export interface RoommateMatch {
  matchedStudentId: string;
  compatibilityScore: number;   // 0–1 cosine similarity
  sharedAttributes: string[];
  vectorDistance: number;
}

// ─── Mobility & Compliance ────────────────────────────────────────────────────

export interface VehicleLeaseConsent {
  studentId: string;
  vehicleVin: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number;
  consentTimestamp: string;
  consentIpAddress: string;
  consentUserAgent: string;
  tosVersion: string;
  clauses: {
    strictlyPassiveAcknowledged: boolean;
    taxClassificationAcknowledged: boolean;
    flightRecorderConsentAcknowledged: boolean;
    independentCounselWaiverAcknowledged: boolean;
  };
  signatureHash: string;  // SHA-256 of all above fields
}

export interface FlightRecorderEntry {
  id: string;
  rideId: string;
  vehicleVin: string;
  lessorStudentId: string;     // The F-1 student who OWNS the car
  driverUserId: string;        // The NON-F1 user who DROVE the car
  startTimestamp: string;
  endTimestamp: string;
  startGps: { lat: number; lng: number };
  endGps: { lat: number; lng: number };
  distanceMiles: number;
  fareAmountCents: number;
  rentalIncomeCents: number;   // Lessor's 1099-MISC (Box 1) amount
  cryptographicHash: string;   // SHA-256 of all above fields
  previousHash: string;        // Links entries into an audit chain
  blockIndex: number;
}

// ─── Landlord Verification ────────────────────────────────────────────────────

export interface LandlordVerificationView {
  // Section 1: Identity (public)
  identity: {
    legalName: string;
    facePhotoUrl: string;
    idStatusLabel: string;   // "IDENTITY SECURE - NFC CHIP VERIFIED"
    legalUSStatus: string;   // "F-1 Student Visa - Valid through 2028"
  };
  // Section 2: Financial (public summary only)
  financial: {
    trustScore: number;
    trustScoreTier: string;
    solvencyLabel: string;   // "SOLVENT: 12 Months Rent Guaranteed"
    letterOfCreditDownloadUrl: string;
    rentSplitEnabled: boolean;
  };
  // Section 3: Contact
  contact: {
    usPhoneNumber: string;
    verifiedEmail: string;
    universityAffiliation: string;
  };
  // Verification metadata
  meta: {
    tokenVerifiedAt: string;
    tokenExpiresAt: string;
    verificationId: string;
  };
}

export interface LandlordVerificationLog {
  verificationId: string;
  studentId: string;
  landlordIp: string;
  landlordUserAgent: string;
  verifiedAt: string;
  tokenJti: string;
}
