// services/identity-service/src/didit.service.ts
// ─── Didit NFC Passport + Liveness — Identity Verification Core ──────────────
// Handles: NFC chip verification, liveness check, face-match, Vecta ID Token mint

import crypto from "crypto";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import Redis from "ioredis";
import {
  DiditPassportData,
  DiditPassportDataSchema,
  VectaIDStatus,
  VisaStatus,
  VectaIDTokenPayload,
} from "@vecta/types";
import { encryptField } from "@vecta/crypto";
import { uploadSelfieToS3, getSignedSelfieUrl } from "@vecta/storage";
import { createLogger } from "@vecta/logger";
import { getPool } from "@vecta/database";

const logger = createLogger("identity-didit");

// ─── Constants ────────────────────────────────────────────────────────────────

const LIVENESS_THRESHOLD = 0.92;        // Didit minimum liveness score
const FACIAL_MATCH_THRESHOLD = 0.90;    // NFC chip photo vs selfie
const TOKEN_TTL_SECONDS = 60 * 60 * 24; // Vecta ID tokens expire in 24h

// ─── Didit API Client ─────────────────────────────────────────────────────────

interface DiditSessionResponse {
  session_id: string;
  status: "pending" | "completed" | "failed";
  liveness_score: number;
  facial_match_score: number;
  chip_verified: boolean;
  mrz: {
    surname: string;
    given_names: string;
    document_number: string;
    nationality: string;
    date_of_birth: string;
    sex: string;
    expiry_date: string;
    issuing_state: string;
  };
  selfie_image_base64: string;
  completed_at: string;
}

class DiditAPIClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  /** False until DIDIT_API_URL and DIDIT_API_KEY are set — avoids crashing the gateway at import time. */
  private readonly isApiConfigured: boolean;

  constructor() {
    this.baseUrl = process.env.DIDIT_API_URL ?? "";
    this.apiKey = process.env.DIDIT_API_KEY ?? "";
    this.webhookSecret = process.env.DIDIT_WEBHOOK_SECRET ?? "";
    this.isApiConfigured = Boolean(this.baseUrl && this.apiKey);
  }

  private ensureApiConfigured(): void {
    if (!this.isApiConfigured) {
      throw new DiditError(
        "Didit API is not configured. Set DIDIT_API_URL and DIDIT_API_KEY in the environment.",
      );
    }
  }

  isConfigured(): boolean {
    return this.isApiConfigured;
  }

  async createSession(options: {
    redirectUrl: string;
    webhookUrl: string;
    requiredDocumentTypes: string[];
  }): Promise<{ sessionId: string; sessionUrl: string }> {
    this.ensureApiConfigured();
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

    const data = await response.json() as { session_id: string; session_url: string };
    return { sessionId: data.session_id, sessionUrl: data.session_url };
  }

  async getSessionResult(sessionId: string): Promise<DiditSessionResponse> {
    this.ensureApiConfigured();
    const response = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}`, {
      headers: { "Authorization": `Bearer ${this.apiKey}` },
    });

    if (!response.ok) {
      throw new DiditError(`Didit session fetch failed: ${response.status}`);
    }
    return response.json() as Promise<DiditSessionResponse>;
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.isApiConfigured || !this.webhookSecret) {
      return false;
    }
    const expected = crypto
      .createHmac("sha256", this.webhookSecret)
      .update(payload)
      .digest("hex");
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature.replace("sha256=", ""), "hex")
    );
  }
}

// ─── Identity Service ─────────────────────────────────────────────────────────

export class IdentityService {
  private readonly didit: DiditAPIClient;
  private readonly jwtPrivateKey: string;
  private readonly jwtKid: string;  // Key ID for rotation

  constructor(
    private readonly db: Pool,
    private readonly redis: Redis
  ) {
    this.didit = new DiditAPIClient();
    this.jwtPrivateKey = process.env.VECTA_ID_JWT_PRIVATE_KEY ?? "";
    this.jwtKid = process.env.VECTA_ID_JWT_KID ?? "default";
  }

  private ensureJwtSigningConfigured(): void {
    if (!this.jwtPrivateKey) {
      throw new Error("JWT private key missing. Set VECTA_ID_JWT_PRIVATE_KEY (RS256 PEM).");
    }
  }

  // ─── Step 1: Create Didit NFC Session ───────────────────────────────────
  // Returns a URL the student's app opens via WebView/deep link for NFC scan.

  /** Poll Didit for session state (student app). */
  async getSessionStatus(sessionId: string): Promise<{
    status: string;
    kyc_status: string | null;
  } | null> {
    try {
      const session = await this.didit.getSessionResult(sessionId);
      const kyc_status =
        session.status === "completed"
          ? "APPROVED"
          : session.status === "failed"
            ? "REJECTED"
            : null;
      return { status: session.status, kyc_status };
    } catch {
      return null;
    }
  }

  async initiateVerification(studentId: string): Promise<{
    sessionId: string;
    verificationUrl: string;
  }> {
    const { sessionId, sessionUrl } = await this.didit.createSession({
      redirectUrl: `vectaapp://identity/callback?student=${studentId}`,
      webhookUrl: `${process.env.API_GATEWAY_URL}/webhooks/didit`,
      requiredDocumentTypes: ["PASSPORT"],
    });

    // Cache session → student mapping for webhook correlation
    await this.redis.setex(
      `vecta:didit:session:${sessionId}`,
      3600,
      studentId
    );

    logger.info({ event: "DIDIT_SESSION_CREATED", studentId, sessionId });

    return { sessionId, verificationUrl: sessionUrl };
  }

  // ─── Step 2: Process Didit Webhook Result ────────────────────────────────
  // Called when Didit POSTs the completed verification to our webhook endpoint.

  async processVerificationResult(
    sessionId: string,
    rawPayload: string,
    signature: string
  ): Promise<{ studentId: string; vectaIdToken: string }> {
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
    DiditPassportDataSchema.parse(passportData);  // Throws if invalid

    // 4. Enforce quality thresholds
    if (passportData.livenessScore < LIVENESS_THRESHOLD) {
      throw new LivenessThresholdError(
        `Liveness score ${passportData.livenessScore} below threshold ${LIVENESS_THRESHOLD}`
      );
    }
    if (passportData.facialMatchScore < FACIAL_MATCH_THRESHOLD) {
      throw new FacialMatchError(
        `Facial match ${passportData.facialMatchScore} below threshold ${FACIAL_MATCH_THRESHOLD}`
      );
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
    const { key: selfieS3Key } = await uploadSelfieToS3(
      studentId,
      Buffer.from(passportData.selfieImageBase64, "base64"),
      "image/jpeg",
    );

    // 7. Persist verification — encrypt sensitive fields at application layer
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      // Insert into didit_sessions
      await client.query(
        `INSERT INTO didit_sessions (
          student_id, session_id, liveness_score, facial_match,
          chip_verified, mrz_surname, mrz_given_names,
          mrz_doc_number_enc, mrz_nationality_enc, mrz_expiry_date, raw_response_enc
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (session_id) DO NOTHING`,
        [
          studentId,
          sessionId,
          passportData.livenessScore,
          passportData.facialMatchScore,
          passportData.chipVerified,
          passportData.mrz.surname,
          passportData.mrz.givenNames,
          encryptField(passportData.mrz.documentNumber),
          encryptField(passportData.mrz.nationality),  // Country of Origin — vaulted
          passportData.mrz.expiryDate,
          encryptField(JSON.stringify(session)),        // Full response
        ]
      );

      // Update student record — legal name + status
      await client.query(
        `UPDATE students SET
          legal_name = $1,
          vecta_id_status = $2,
          face_photo_s3_key = $3,
          passport_number_enc = $4,
          country_of_origin_enc = $5,
          didit_verified_at = NOW()
        WHERE id = $6`,
        [
          `${passportData.mrz.givenNames} ${passportData.mrz.surname}`,
          VectaIDStatus.IDENTITY_VERIFIED,
          selfieS3Key,
          await encryptField(passportData.mrz.documentNumber),
          await encryptField(passportData.mrz.nationality),
          studentId,
        ]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
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
        const { queryOne } = await import("@vecta/database");
        const student = await queryOne<{ id: string; email: string; full_name: string }>(
          "SELECT id, email, full_name FROM students WHERE id = $1",
          [studentId],
        );
        if (student) {
          const { sendKycApprovedEmail } = await import("./email.service");
          await sendKycApprovedEmail({ toEmail: student.email, studentName: student.full_name ?? "Student" });

          const { notifyStudent } = await import("./push.service");
          await notifyStudent(student.id, "KYC_APPROVED");
        }
      } catch (notifyErr) {
        logger.error({ notifyErr }, "KYC approved notification failed");
      }
    })();

    return { studentId, vectaIdToken };
  }

  // ─── Mint Vecta ID Token (JWT) ───────────────────────────────────────────
  // The JWT that represents a student's verified identity to landlords.
  // NEVER includes passport number, country of origin, or I-20 details.

  async mintVectaIDToken(studentId: string): Promise<string> {
    this.ensureJwtSigningConfigured();
    const result = await this.db.query(
      `SELECT
        s.id, s.legal_name, s.vecta_id_status, s.visa_type, s.visa_expiry_year,
        s.university_name, s.university_enrollment_verified,
        s.us_phone_number, s.verified_email, s.face_photo_s3_key,
        s.vecta_trust_score, s.trust_score_tier,
        s.esim_iccid,
        loc.id AS loc_id
       FROM students s
       LEFT JOIN letters_of_credit loc ON loc.student_id = s.id AND loc.expires_at > NOW()
       WHERE s.id = $1`,
      [studentId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Student ${studentId} not found`);
    }

    const student = result.rows[0];

    // Generate a short-lived signed URL for the selfie (landlord view)
    const facialPhotoUrl = student.face_photo_s3_key
      ? await getSignedSelfieUrl(student.face_photo_s3_key)
      : "";

    const jti = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    // Determine trust score tier label
    const trustScore = student.vecta_trust_score ?? 0;
    const trustScoreTier = this.getTrustScoreTier(trustScore);

    const payload: VectaIDTokenPayload = {
      sub: studentId,                                              // UUID only
      legalName: student.legal_name ?? "Pending Verification",
      facialPhotoUrl,
      idStatus: student.vecta_id_status,
      visaType: student.visa_type as VisaStatus,
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
    const token = jwt.sign(payload, this.jwtPrivateKey, {
      algorithm: "RS256",
      keyid: this.jwtKid,
    });

    // Register token in DB for revocation support
    await this.db.query(
      `INSERT INTO vecta_id_tokens (jti, student_id, issued_at, expires_at)
       VALUES ($1, $2, NOW(), NOW() + INTERVAL '${TOKEN_TTL_SECONDS} seconds')`,
      [jti, studentId]
    );

    return token;
  }

  // ─── Verify Incoming Token (Landlord Portal) ─────────────────────────────

  async verifyVectaIDToken(token: string, landlordIp: string, userAgent: string): Promise<{
    payload: VectaIDTokenPayload;
    verificationId: string;
  }> {
    const publicKey = process.env.VECTA_ID_JWT_PUBLIC_KEY!;

    let payload: VectaIDTokenPayload;
    try {
      payload = jwt.verify(token, publicKey, {
        algorithms: ["RS256"],
        issuer: "vecta.platform",
      }) as VectaIDTokenPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new TokenExpiredError("Vecta ID Token has expired. Please request a new one.");
      }
      throw new TokenVerificationError(`Token verification failed: ${(err as Error).message}`);
    }

    // Check revocation status in DB
    const revoked = await this.db.query(
      `SELECT revoked, revoke_reason FROM vecta_id_tokens WHERE jti = $1`,
      [payload.jti]
    );

    if (revoked.rows.length === 0 || revoked.rows[0].revoked) {
      throw new TokenRevokedError(
        `Token ${payload.jti} has been revoked: ${revoked.rows[0]?.revoke_reason ?? "no reason"}`
      );
    }

    // Log landlord verification event
    const logResult = await this.db.query(
      `INSERT INTO landlord_verification_logs (student_id, token_jti, landlord_ip, user_agent)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [payload.sub, payload.jti, landlordIp, userAgent]
    );

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

  private parseSessionToPassportData(session: DiditSessionResponse): DiditPassportData {
    return {
      mrz: {
        surname: session.mrz.surname,
        givenNames: session.mrz.given_names,
        documentNumber: session.mrz.document_number,
        nationality: session.mrz.nationality,
        dateOfBirth: session.mrz.date_of_birth,
        sex: session.mrz.sex as "M" | "F" | "X",
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

  private getTrustScoreTier(score: number): "EXCELLENT" | "GOOD" | "FAIR" | "BUILDING" {
    if (score >= 750) return "EXCELLENT";
    if (score >= 670) return "GOOD";
    if (score >= 580) return "FAIR";
    return "BUILDING";
  }
}

// ─── Custom Errors ────────────────────────────────────────────────────────────

export class DiditError extends Error {
  constructor(message: string) { super(message); this.name = "DiditError"; }
}
export class LivenessThresholdError extends DiditError {}
export class FacialMatchError extends DiditError {}
export class NFCChipError extends DiditError {}
export class TokenExpiredError extends Error {
  constructor(message: string) { super(message); this.name = "TokenExpiredError"; }
}
export class TokenVerificationError extends Error {
  constructor(message: string) { super(message); this.name = "TokenVerificationError"; }
}
export class TokenRevokedError extends Error {
  constructor(message: string) { super(message); this.name = "TokenRevokedError"; }
}

const _identityPool = getPool();
const _identityRedis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

export const identityService = new IdentityService(_identityPool, _identityRedis);

export function mintVectaIDToken(studentId: string): Promise<string> {
  return identityService.mintVectaIDToken(studentId);
}

export function verifyVectaIDToken(
  token: string,
  landlordIp: string,
  userAgent: string,
): ReturnType<IdentityService["verifyVectaIDToken"]> {
  return identityService.verifyVectaIDToken(token, landlordIp, userAgent);
}
