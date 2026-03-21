"use strict";
// packages/types/src/index.ts
// ─── Vecta Platform — Canonical Type Definitions ─────────────────────────────
// All cross-service contracts live here. Never import from sibling services.
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnitCustomerCreateSchema = exports.DiditPassportDataSchema = exports.AuditEventType = exports.StudentRole = exports.VectaIDStatus = exports.KYCStatus = exports.VisaStatus = void 0;
const zod_1 = require("zod");
// ─── Enums ────────────────────────────────────────────────────────────────────
var VisaStatus;
(function (VisaStatus) {
    VisaStatus["F1_ACTIVE"] = "F1_ACTIVE";
    VisaStatus["F1_OPT"] = "F1_OPT";
    VisaStatus["F1_CPT"] = "F1_CPT";
    VisaStatus["F1_GRACE"] = "F1_GRACE";
    VisaStatus["F2_DEPENDENT"] = "F2_DEPENDENT";
})(VisaStatus || (exports.VisaStatus = VisaStatus = {}));
var KYCStatus;
(function (KYCStatus) {
    KYCStatus["PENDING"] = "PENDING";
    KYCStatus["IN_PROGRESS"] = "IN_PROGRESS";
    KYCStatus["APPROVED"] = "APPROVED";
    KYCStatus["REJECTED"] = "REJECTED";
    KYCStatus["NEEDS_REVIEW"] = "NEEDS_REVIEW";
})(KYCStatus || (exports.KYCStatus = KYCStatus = {}));
var VectaIDStatus;
(function (VectaIDStatus) {
    VectaIDStatus["UNVERIFIED"] = "UNVERIFIED";
    VectaIDStatus["IDENTITY_VERIFIED"] = "IDENTITY_VERIFIED";
    VectaIDStatus["BANKING_PROVISIONED"] = "BANKING_PROVISIONED";
    VectaIDStatus["FULLY_ACTIVE"] = "FULLY_ACTIVE";
})(VectaIDStatus || (exports.VectaIDStatus = VectaIDStatus = {}));
var StudentRole;
(function (StudentRole) {
    StudentRole["STUDENT"] = "STUDENT";
    StudentRole["LESSOR"] = "LESSOR";
    // DRIVER role intentionally omitted for F-1 compliance.
})(StudentRole || (exports.StudentRole = StudentRole = {}));
var AuditEventType;
(function (AuditEventType) {
    AuditEventType["IDENTITY_VERIFIED"] = "IDENTITY_VERIFIED";
    AuditEventType["KYC_SUBMITTED"] = "KYC_SUBMITTED";
    AuditEventType["KYC_APPROVED"] = "KYC_APPROVED";
    AuditEventType["ACCOUNT_PROVISIONED"] = "ACCOUNT_PROVISIONED";
    AuditEventType["ESIM_ACTIVATED"] = "ESIM_ACTIVATED";
    AuditEventType["INSURANCE_QUOTED"] = "INSURANCE_QUOTED";
    AuditEventType["VEHICLE_ENROLLED"] = "VEHICLE_ENROLLED";
    AuditEventType["VEHICLE_LEASE_SIGNED"] = "VEHICLE_LEASE_SIGNED";
    AuditEventType["RIDE_STARTED"] = "RIDE_STARTED";
    AuditEventType["RIDE_COMPLETED"] = "RIDE_COMPLETED";
    AuditEventType["RENTAL_INCOME_RECORDED"] = "RENTAL_INCOME_RECORDED";
    AuditEventType["DSO_MEMO_GENERATED"] = "DSO_MEMO_GENERATED";
    AuditEventType["LANDLORD_VERIFICATION"] = "LANDLORD_VERIFICATION";
})(AuditEventType || (exports.AuditEventType = AuditEventType = {}));
// ─── Zod Schemas ──────────────────────────────────────────────────────────────
exports.DiditPassportDataSchema = zod_1.z.object({
    // Raw NFC chip data from Didit SDK
    mrz: zod_1.z.object({
        surname: zod_1.z.string().min(1),
        givenNames: zod_1.z.string().min(1),
        documentNumber: zod_1.z.string().regex(/^[A-Z0-9]{9}$/),
        nationality: zod_1.z.string().length(3), // ISO 3166-1 alpha-3
        dateOfBirth: zod_1.z.string().regex(/^\d{6}$/),
        sex: zod_1.z.enum(["M", "F", "X"]),
        expiryDate: zod_1.z.string().regex(/^\d{6}$/),
        issuingState: zod_1.z.string().length(3),
    }),
    livenessScore: zod_1.z.number().min(0).max(1),
    facialMatchScore: zod_1.z.number().min(0).max(1),
    chipVerified: zod_1.z.boolean(),
    selfieImageBase64: zod_1.z.string(),
    sessionId: zod_1.z.string().uuid(),
    verifiedAt: zod_1.z.string().datetime(),
});
exports.UnitCustomerCreateSchema = zod_1.z.object({
    fullName: zod_1.z.string(),
    email: zod_1.z.string().email(),
    phone: zod_1.z.string(),
    dateOfBirth: zod_1.z.string(),
    address: zod_1.z.object({
        street: zod_1.z.string(),
        city: zod_1.z.string(),
        state: zod_1.z.string().length(2),
        postalCode: zod_1.z.string(),
        country: zod_1.z.literal("US"),
    }),
    ssnLast4: zod_1.z.string().regex(/^\d{4}$/).optional(),
    // For F-1 students: passport used instead of SSN
    passportNumber: zod_1.z.string().optional(),
    passportCountry: zod_1.z.string().length(3).optional(),
    passportExpiry: zod_1.z.string().optional(),
    visaType: zod_1.z.nativeEnum(VisaStatus),
    sevisId: zod_1.z.string().regex(/^N\d{10}$/).optional(),
});
//# sourceMappingURL=index.js.map