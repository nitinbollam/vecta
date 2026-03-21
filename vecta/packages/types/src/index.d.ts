import { z } from "zod";
export declare enum VisaStatus {
    F1_ACTIVE = "F1_ACTIVE",
    F1_OPT = "F1_OPT",
    F1_CPT = "F1_CPT",
    F1_GRACE = "F1_GRACE",
    F2_DEPENDENT = "F2_DEPENDENT"
}
export declare enum KYCStatus {
    PENDING = "PENDING",
    IN_PROGRESS = "IN_PROGRESS",
    APPROVED = "APPROVED",
    REJECTED = "REJECTED",
    NEEDS_REVIEW = "NEEDS_REVIEW"
}
export declare enum VectaIDStatus {
    UNVERIFIED = "UNVERIFIED",
    IDENTITY_VERIFIED = "IDENTITY_VERIFIED",// Didit NFC + liveness passed
    BANKING_PROVISIONED = "BANKING_PROVISIONED",// Unit.co DDA opened
    FULLY_ACTIVE = "FULLY_ACTIVE"
}
export declare enum StudentRole {
    STUDENT = "STUDENT",
    LESSOR = "LESSOR"
}
export declare enum AuditEventType {
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
    LANDLORD_VERIFICATION = "LANDLORD_VERIFICATION"
}
export interface VectaIDTokenPayload {
    sub: string;
    legalName: string;
    facialPhotoUrl: string;
    idStatus: VectaIDStatus;
    visaType: VisaStatus;
    visaExpiryYear: number;
    universityName: string;
    universityEnrollmentVerified: boolean;
    usPhoneNumber: string;
    verifiedEmail: string;
    vectaTrustScore: number;
    trustScoreTier: "EXCELLENT" | "GOOD" | "FAIR" | "BUILDING";
    solvencyGuaranteeMonths: number;
    letterOfCreditId: string;
    rentSplitEnabled: boolean;
    iat: number;
    exp: number;
    iss: "vecta.platform";
    jti: string;
}
export declare const DiditPassportDataSchema: z.ZodObject<{
    mrz: z.ZodObject<{
        surname: z.ZodString;
        givenNames: z.ZodString;
        documentNumber: z.ZodString;
        nationality: z.ZodString;
        dateOfBirth: z.ZodString;
        sex: z.ZodEnum<["M", "F", "X"]>;
        expiryDate: z.ZodString;
        issuingState: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        surname: string;
        givenNames: string;
        documentNumber: string;
        nationality: string;
        dateOfBirth: string;
        sex: "M" | "F" | "X";
        expiryDate: string;
        issuingState: string;
    }, {
        surname: string;
        givenNames: string;
        documentNumber: string;
        nationality: string;
        dateOfBirth: string;
        sex: "M" | "F" | "X";
        expiryDate: string;
        issuingState: string;
    }>;
    livenessScore: z.ZodNumber;
    facialMatchScore: z.ZodNumber;
    chipVerified: z.ZodBoolean;
    selfieImageBase64: z.ZodString;
    sessionId: z.ZodString;
    verifiedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    mrz: {
        surname: string;
        givenNames: string;
        documentNumber: string;
        nationality: string;
        dateOfBirth: string;
        sex: "M" | "F" | "X";
        expiryDate: string;
        issuingState: string;
    };
    livenessScore: number;
    facialMatchScore: number;
    chipVerified: boolean;
    selfieImageBase64: string;
    sessionId: string;
    verifiedAt: string;
}, {
    mrz: {
        surname: string;
        givenNames: string;
        documentNumber: string;
        nationality: string;
        dateOfBirth: string;
        sex: "M" | "F" | "X";
        expiryDate: string;
        issuingState: string;
    };
    livenessScore: number;
    facialMatchScore: number;
    chipVerified: boolean;
    selfieImageBase64: string;
    sessionId: string;
    verifiedAt: string;
}>;
export type DiditPassportData = z.infer<typeof DiditPassportDataSchema>;
export declare const UnitCustomerCreateSchema: z.ZodObject<{
    fullName: z.ZodString;
    email: z.ZodString;
    phone: z.ZodString;
    dateOfBirth: z.ZodString;
    address: z.ZodObject<{
        street: z.ZodString;
        city: z.ZodString;
        state: z.ZodString;
        postalCode: z.ZodString;
        country: z.ZodLiteral<"US">;
    }, "strip", z.ZodTypeAny, {
        street: string;
        city: string;
        state: string;
        postalCode: string;
        country: "US";
    }, {
        street: string;
        city: string;
        state: string;
        postalCode: string;
        country: "US";
    }>;
    ssnLast4: z.ZodOptional<z.ZodString>;
    passportNumber: z.ZodOptional<z.ZodString>;
    passportCountry: z.ZodOptional<z.ZodString>;
    passportExpiry: z.ZodOptional<z.ZodString>;
    visaType: z.ZodNativeEnum<typeof VisaStatus>;
    sevisId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    dateOfBirth: string;
    fullName: string;
    email: string;
    phone: string;
    address: {
        street: string;
        city: string;
        state: string;
        postalCode: string;
        country: "US";
    };
    visaType: VisaStatus;
    ssnLast4?: string | undefined;
    passportNumber?: string | undefined;
    passportCountry?: string | undefined;
    passportExpiry?: string | undefined;
    sevisId?: string | undefined;
}, {
    dateOfBirth: string;
    fullName: string;
    email: string;
    phone: string;
    address: {
        street: string;
        city: string;
        state: string;
        postalCode: string;
        country: "US";
    };
    visaType: VisaStatus;
    ssnLast4?: string | undefined;
    passportNumber?: string | undefined;
    passportCountry?: string | undefined;
    passportExpiry?: string | undefined;
    sevisId?: string | undefined;
}>;
export type UnitCustomerCreate = z.infer<typeof UnitCustomerCreateSchema>;
export interface NovaCreditResult {
    cashScore: number;
    originalScore: number;
    originalScoreRange: {
        min: number;
        max: number;
    };
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
export interface PlaidSolvencyReport {
    studentId: string;
    reportId: string;
    verifiedAt: string;
    totalVerifiedBalanceUSD: number;
    monthsRentCoverage: number;
    guaranteeStatement: string;
    cryptographicHash: string;
    signatureKeyId: string;
}
export interface ESIMProvisionResult {
    iccid: string;
    activationCode: string;
    usPhoneNumber: string;
    plan: "5G_UNLIMITED" | "5G_10GB" | "LTE_5GB";
    activatedAt: string;
}
export interface InsuranceQuote {
    provider: "ISO" | "PSI" | "LEMONADE" | "CUSTOM";
    type: "MEDICAL_WAIVER" | "RENTERS" | "AUTO";
    monthlyPremium: number;
    annualPremium: number;
    deductible: number;
    coverageLimit: number;
    quoteId: string;
    expiresAt: string;
}
export interface MedicalWaiverAnalysis {
    universityPlanName: string;
    annualDeductible: number;
    outOfPocketMax: number;
    mentalHealthCoverage: boolean;
    dentalCoverage: boolean;
    visionCoverage: boolean;
    meetsF1Requirements: boolean;
    aiConfidenceScore: number;
    extractedAt: string;
    alternativeQuotes: InsuranceQuote[];
}
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
}
export interface RoommateMatch {
    matchedStudentId: string;
    compatibilityScore: number;
    sharedAttributes: string[];
    vectorDistance: number;
}
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
    signatureHash: string;
}
export interface FlightRecorderEntry {
    id: string;
    rideId: string;
    vehicleVin: string;
    lessorStudentId: string;
    driverUserId: string;
    startTimestamp: string;
    endTimestamp: string;
    startGps: {
        lat: number;
        lng: number;
    };
    endGps: {
        lat: number;
        lng: number;
    };
    distanceMiles: number;
    fareAmountCents: number;
    rentalIncomeCents: number;
    cryptographicHash: string;
    previousHash: string;
    blockIndex: number;
}
export interface LandlordVerificationView {
    identity: {
        legalName: string;
        facePhotoUrl: string;
        idStatusLabel: string;
        legalUSStatus: string;
    };
    financial: {
        trustScore: number;
        trustScoreTier: string;
        solvencyLabel: string;
        letterOfCreditDownloadUrl: string;
        rentSplitEnabled: boolean;
    };
    contact: {
        usPhoneNumber: string;
        verifiedEmail: string;
        universityAffiliation: string;
    };
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
//# sourceMappingURL=index.d.ts.map