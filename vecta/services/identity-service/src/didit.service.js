"use strict";
// services/identity-service/src/didit.service.ts
// ─── Didit NFC Passport + Liveness — Identity Verification Core ──────────────
// Handles: NFC chip verification, liveness check, face-match, Vecta ID Token mint
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.identityService = exports.TokenRevokedError = exports.TokenVerificationError = exports.TokenExpiredError = exports.NFCChipError = exports.FacialMatchError = exports.LivenessThresholdError = exports.DiditError = exports.IdentityService = void 0;
exports.mintVectaIDToken = mintVectaIDToken;
exports.verifyVectaIDToken = verifyVectaIDToken;
const crypto_1 = __importDefault(require("crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const ioredis_1 = __importDefault(require("ioredis"));
const types_1 = require("@vecta/types");
const crypto_2 = require("@vecta/crypto");
const storage_1 = require("@vecta/storage");
const logger_1 = require("@vecta/logger");
const database_1 = require("@vecta/database");
const logger = (0, logger_1.createLogger)("identity-didit");
// ─── Constants ────────────────────────────────────────────────────────────────
const LIVENESS_THRESHOLD = 0.92; // Didit minimum liveness score
const FACIAL_MATCH_THRESHOLD = 0.90; // NFC chip photo vs selfie
const TOKEN_TTL_SECONDS = 60 * 60 * 24; // Vecta ID tokens expire in 24h
class DiditAPIClient {
    baseUrl;
    apiKey;
    webhookSecret;
    constructor() {
        this.baseUrl = process.env.DIDIT_API_URL;
        this.apiKey = process.env.DIDIT_API_KEY;
        this.webhookSecret = process.env.DIDIT_WEBHOOK_SECRET;
        if (!this.baseUrl || !this.apiKey) {
            throw new Error("Didit API configuration missing. Set DIDIT_API_URL and DIDIT_API_KEY.");
        }
    }
    async createSession(options) {
        const response = await fetch(`${this.baseUrl}/v1/sessions`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                redirect_url: options.redirectUrl,
                webhook_url: options.webhookUrl,
                document_types: options.requiredDocumentTypes,
                features: ["NFC_CHIP", "LIVENESS", "FACIAL_MATCH"],
                vendor_data: `vecta-${Date.now()}`,
            }),
        });
        if (!response.ok) {
            const err = await response.text();
            throw new DiditError(`Failed to create Didit session: ${response.status} ${err}`);
        }
        const data = await response.json();
        return { sessionId: data.session_id, sessionUrl: data.session_url };
    }
    async getSessionResult(sessionId) {
        const response = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}`, {
            headers: { "Authorization": `Bearer ${this.apiKey}` },
        });
        if (!response.ok) {
            throw new DiditError(`Didit session fetch failed: ${response.status}`);
        }
        return response.json();
    }
    verifyWebhookSignature(payload, signature) {
        const expected = crypto_1.default
            .createHmac("sha256", this.webhookSecret)
            .update(payload)
            .digest("hex");
        return crypto_1.default.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature.replace("sha256=", ""), "hex"));
    }
}
// ─── Identity Service ─────────────────────────────────────────────────────────
class IdentityService {
    db;
    redis;
    didit;
    jwtPrivateKey;
    jwtKid; // Key ID for rotation
    constructor(db, redis) {
        this.db = db;
        this.redis = redis;
        this.didit = new DiditAPIClient();
        this.jwtPrivateKey = process.env.VECTA_ID_JWT_PRIVATE_KEY;
        this.jwtKid = process.env.VECTA_ID_JWT_KID;
        if (!this.jwtPrivateKey) {
            throw new Error("JWT private key missing. Set VECTA_ID_JWT_PRIVATE_KEY (RS256 PEM).");
        }
    }
    // ─── Step 1: Create Didit NFC Session ───────────────────────────────────
    // Returns a URL the student's app opens via WebView/deep link for NFC scan.
    /** Poll Didit for session state (student app). */
    async getSessionStatus(sessionId) {
        try {
            const session = await this.didit.getSessionResult(sessionId);
            const kyc_status = session.status === "completed"
                ? "APPROVED"
                : session.status === "failed"
                    ? "REJECTED"
                    : null;
            return { status: session.status, kyc_status };
        }
        catch {
            return null;
        }
    }
    async initiateVerification(studentId) {
        const { sessionId, sessionUrl } = await this.didit.createSession({
            redirectUrl: `vectaapp://identity/callback?student=${studentId}`,
            webhookUrl: `${process.env.API_GATEWAY_URL}/webhooks/didit`,
            requiredDocumentTypes: ["PASSPORT"],
        });
        // Cache session → student mapping for webhook correlation
        await this.redis.setex(`vecta:didit:session:${sessionId}`, 3600, studentId);
        logger.info({ event: "DIDIT_SESSION_CREATED", studentId, sessionId });
        return { sessionId, verificationUrl: sessionUrl };
    }
    // ─── Step 2: Process Didit Webhook Result ────────────────────────────────
    // Called when Didit POSTs the completed verification to our webhook endpoint.
    async processVerificationResult(sessionId, rawPayload, signature) {
        // 1. Verify webhook authenticity
        if (!this.didit.verifyWebhookSignature(rawPayload, signature)) {
            throw new DiditError("Invalid Didit webhook signature. Rejecting.");
        }
        // 2. Fetch full session result from Didit API
        const session = await this.didit.getSessionResult(sessionId);
        if (session.status !== "completed") {
            throw new DiditError(`Session ${sessionId} is not completed: ${session.status}`);
        }
        // 3. Parse and validate data
        const passportData = this.parseSessionToPassportData(session);
        types_1.DiditPassportDataSchema.parse(passportData); // Throws if invalid
        // 4. Enforce quality thresholds
        if (passportData.livenessScore < LIVENESS_THRESHOLD) {
            throw new LivenessThresholdError(`Liveness score ${passportData.livenessScore} below threshold ${LIVENESS_THRESHOLD}`);
        }
        if (passportData.facialMatchScore < FACIAL_MATCH_THRESHOLD) {
            throw new FacialMatchError(`Facial match ${passportData.facialMatchScore} below threshold ${FACIAL_MATCH_THRESHOLD}`);
        }
        if (!passportData.chipVerified) {
            throw new NFCChipError("NFC chip verification failed. Document may be non-genuine.");
        }
        // 5. Look up student from Redis cache
        const studentId = await this.redis.get(`vecta:didit:session:${sessionId}`);
        if (!studentId) {
            throw new DiditError(`No student mapping found for session ${sessionId}`);
        }
        // 6. Upload selfie to S3 (private bucket)
        const { key: selfieS3Key } = await (0, storage_1.uploadSelfieToS3)(studentId, Buffer.from(passportData.selfieImageBase64, "base64"), "image/jpeg");
        // 7. Persist verification — encrypt sensitive fields at application layer
        const client = await this.db.connect();
        try {
            await client.query("BEGIN");
            // Insert into didit_sessions
            await client.query(`INSERT INTO didit_sessions (
          student_id, session_id, liveness_score, facial_match,
          chip_verified, mrz_surname, mrz_given_names,
          mrz_doc_number_enc, mrz_nationality_enc, mrz_expiry_date, raw_response_enc
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (session_id) DO NOTHING`, [
                studentId,
                sessionId,
                passportData.livenessScore,
                passportData.facialMatchScore,
                passportData.chipVerified,
                passportData.mrz.surname,
                passportData.mrz.givenNames,
                (0, crypto_2.encryptField)(passportData.mrz.documentNumber),
                (0, crypto_2.encryptField)(passportData.mrz.nationality), // Country of Origin — vaulted
                passportData.mrz.expiryDate,
                (0, crypto_2.encryptField)(JSON.stringify(session)), // Full response
            ]);
            // Update student record — legal name + status
            await client.query(`UPDATE students SET
          legal_name = $1,
          vecta_id_status = $2,
          face_photo_s3_key = $3,
          passport_number_enc = $4,
          country_of_origin_enc = $5,
          didit_verified_at = NOW()
        WHERE id = $6`, [
                `${passportData.mrz.givenNames} ${passportData.mrz.surname}`,
                types_1.VectaIDStatus.IDENTITY_VERIFIED,
                selfieS3Key,
                await (0, crypto_2.encryptField)(passportData.mrz.documentNumber),
                await (0, crypto_2.encryptField)(passportData.mrz.nationality),
                studentId,
            ]);
            await client.query("COMMIT");
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
        // 8. Mint Vecta ID Token
        const vectaIdToken = await this.mintVectaIDToken(studentId);
        // 9. Invalidate any cached Didit session data
        await this.redis.del(`vecta:didit:session:${sessionId}`);
        logger.info({ event: "IDENTITY_VERIFIED", studentId, sessionId });
        // Fire-and-forget: notify student KYC is approved
        void (async () => {
            try {
                const { queryOne } = await Promise.resolve().then(() => __importStar(require("@vecta/database")));
                const student = await queryOne("SELECT id, email, full_name FROM students WHERE id = $1", [studentId]);
                if (student) {
                    const { sendKycApprovedEmail } = await Promise.resolve().then(() => __importStar(require("./email.service")));
                    await sendKycApprovedEmail({ toEmail: student.email, studentName: student.full_name ?? "Student" });
                    const { notifyStudent } = await Promise.resolve().then(() => __importStar(require("./push.service")));
                    await notifyStudent(student.id, "KYC_APPROVED");
                }
            }
            catch (notifyErr) {
                logger.error({ notifyErr }, "KYC approved notification failed");
            }
        })();
        return { studentId, vectaIdToken };
    }
    // ─── Mint Vecta ID Token (JWT) ───────────────────────────────────────────
    // The JWT that represents a student's verified identity to landlords.
    // NEVER includes passport number, country of origin, or I-20 details.
    async mintVectaIDToken(studentId) {
        const result = await this.db.query(`SELECT
        s.id, s.legal_name, s.vecta_id_status, s.visa_type, s.visa_expiry_year,
        s.university_name, s.university_enrollment_verified,
        s.us_phone_number, s.verified_email, s.face_photo_s3_key,
        s.vecta_trust_score, s.trust_score_tier,
        s.esim_iccid,
        loc.id AS loc_id
       FROM students s
       LEFT JOIN letters_of_credit loc ON loc.student_id = s.id AND loc.expires_at > NOW()
       WHERE s.id = $1`, [studentId]);
        if (result.rows.length === 0) {
            throw new Error(`Student ${studentId} not found`);
        }
        const student = result.rows[0];
        // Generate a short-lived signed URL for the selfie (landlord view)
        const facialPhotoUrl = student.face_photo_s3_key
            ? await (0, storage_1.getSignedSelfieUrl)(student.face_photo_s3_key)
            : "";
        const jti = crypto_1.default.randomUUID();
        const now = Math.floor(Date.now() / 1000);
        // Determine trust score tier label
        const trustScore = student.vecta_trust_score ?? 0;
        const trustScoreTier = this.getTrustScoreTier(trustScore);
        const payload = {
            sub: studentId, // UUID only
            legalName: student.legal_name ?? "Pending Verification",
            facialPhotoUrl,
            idStatus: student.vecta_id_status,
            visaType: student.visa_type,
            visaExpiryYear: student.visa_expiry_year ?? 0,
            universityName: student.university_name ?? "",
            universityEnrollmentVerified: student.university_enrollment_verified,
            usPhoneNumber: student.us_phone_number ?? "",
            verifiedEmail: student.verified_email,
            vectaTrustScore: trustScore,
            trustScoreTier,
            solvencyGuaranteeMonths: 12,
            letterOfCreditId: student.loc_id ?? "",
            rentSplitEnabled: true,
            iat: now,
            exp: now + TOKEN_TTL_SECONDS,
            iss: "vecta.platform",
            jti,
        };
        // Sign with RS256 — asymmetric so landlord portal can verify without secret
        const token = jsonwebtoken_1.default.sign(payload, this.jwtPrivateKey, {
            algorithm: "RS256",
            keyid: this.jwtKid,
        });
        // Register token in DB for revocation support
        await this.db.query(`INSERT INTO vecta_id_tokens (jti, student_id, issued_at, expires_at)
       VALUES ($1, $2, NOW(), NOW() + INTERVAL '${TOKEN_TTL_SECONDS} seconds')`, [jti, studentId]);
        return token;
    }
    // ─── Verify Incoming Token (Landlord Portal) ─────────────────────────────
    async verifyVectaIDToken(token, landlordIp, userAgent) {
        const publicKey = process.env.VECTA_ID_JWT_PUBLIC_KEY;
        let payload;
        try {
            payload = jsonwebtoken_1.default.verify(token, publicKey, {
                algorithms: ["RS256"],
                issuer: "vecta.platform",
            });
        }
        catch (err) {
            if (err instanceof jsonwebtoken_1.default.TokenExpiredError) {
                throw new TokenExpiredError("Vecta ID Token has expired. Please request a new one.");
            }
            throw new TokenVerificationError(`Token verification failed: ${err.message}`);
        }
        // Check revocation status in DB
        const revoked = await this.db.query(`SELECT revoked, revoke_reason FROM vecta_id_tokens WHERE jti = $1`, [payload.jti]);
        if (revoked.rows.length === 0 || revoked.rows[0].revoked) {
            throw new TokenRevokedError(`Token ${payload.jti} has been revoked: ${revoked.rows[0]?.revoke_reason ?? "no reason"}`);
        }
        // Log landlord verification event
        const logResult = await this.db.query(`INSERT INTO landlord_verification_logs (student_id, token_jti, landlord_ip, user_agent)
       VALUES ($1, $2, $3, $4) RETURNING id`, [payload.sub, payload.jti, landlordIp, userAgent]);
        const verificationId = logResult.rows[0].id;
        logger.info({
            event: "LANDLORD_VERIFICATION",
            studentId: payload.sub,
            jti: payload.jti,
            landlordIp,
            verificationId,
        });
        return { payload, verificationId };
    }
    // ─── Helpers ─────────────────────────────────────────────────────────────
    parseSessionToPassportData(session) {
        return {
            mrz: {
                surname: session.mrz.surname,
                givenNames: session.mrz.given_names,
                documentNumber: session.mrz.document_number,
                nationality: session.mrz.nationality,
                dateOfBirth: session.mrz.date_of_birth,
                sex: session.mrz.sex,
                expiryDate: session.mrz.expiry_date,
                issuingState: session.mrz.issuing_state,
            },
            livenessScore: session.liveness_score,
            facialMatchScore: session.facial_match_score,
            chipVerified: session.chip_verified,
            selfieImageBase64: session.selfie_image_base64,
            sessionId: session.session_id,
            verifiedAt: session.completed_at,
        };
    }
    getTrustScoreTier(score) {
        if (score >= 750)
            return "EXCELLENT";
        if (score >= 670)
            return "GOOD";
        if (score >= 580)
            return "FAIR";
        return "BUILDING";
    }
}
exports.IdentityService = IdentityService;
// ─── Custom Errors ────────────────────────────────────────────────────────────
class DiditError extends Error {
    constructor(message) { super(message); this.name = "DiditError"; }
}
exports.DiditError = DiditError;
class LivenessThresholdError extends DiditError {
}
exports.LivenessThresholdError = LivenessThresholdError;
class FacialMatchError extends DiditError {
}
exports.FacialMatchError = FacialMatchError;
class NFCChipError extends DiditError {
}
exports.NFCChipError = NFCChipError;
class TokenExpiredError extends Error {
    constructor(message) { super(message); this.name = "TokenExpiredError"; }
}
exports.TokenExpiredError = TokenExpiredError;
class TokenVerificationError extends Error {
    constructor(message) { super(message); this.name = "TokenVerificationError"; }
}
exports.TokenVerificationError = TokenVerificationError;
class TokenRevokedError extends Error {
    constructor(message) { super(message); this.name = "TokenRevokedError"; }
}
exports.TokenRevokedError = TokenRevokedError;
const _identityPool = (0, database_1.getPool)();
const _identityRedis = new ioredis_1.default(process.env.REDIS_URL ?? "redis://localhost:6379");
exports.identityService = new IdentityService(_identityPool, _identityRedis);
function mintVectaIDToken(studentId) {
    return exports.identityService.mintVectaIDToken(studentId);
}
function verifyVectaIDToken(token, landlordIp, userAgent) {
    return exports.identityService.verifyVectaIDToken(token, landlordIp, userAgent);
}
//# sourceMappingURL=didit.service.js.map