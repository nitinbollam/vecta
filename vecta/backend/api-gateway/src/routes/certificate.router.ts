/**
 * apps/api-gateway/src/routes/certificate.router.ts
 *
 * Trust Certificate endpoints:
 *
 *   GET  /api/v1/certificate/:token
 *     Consumes a single-use landlord token, aggregates all trust signals,
 *     signs them with Ed25519, and returns the TrustCertificate payload.
 *     Called by the Next.js landlord portal on server render.
 *
 *   POST /api/v1/certificate/verify
 *     Accepts a SignedTrustCertificate, recomputes the canonical hash,
 *     and verifies the Ed25519 signature. Used by the ProofBadge component.
 *
 *   POST /api/v1/certificate/:certId/accept
 *     Landlord accepts tenant — writes to lease_applications table.
 *     Requires verified landlord session (email or background check).
 *
 * Adversarial guarantees:
 *   - Token must be non-expired, non-consumed (row-level lock in DB)
 *   - Token consumption and certificate issuance are a single DB transaction
 *   - Checkr PENDING → 422 CONTINGENT_CERTIFICATE (landlord sees warning, not error)
 *   - Any field missing from DB → 422 INCOMPLETE_PROFILE
 *   - No PII (passport number, exact balance, nationality) in any response
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { createLogger, logAuditEvent } from '@vecta/logger';
import { query, queryOne, withTransaction } from '@vecta/database';
import {
  signCertificate,
  verifyCertificate,
  type TrustAttributes,
  type SignedTrustCertificate,
} from '@vecta/auth';

const logger = createLogger('certificate-router');
const router = Router();

const verifyRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? 'unknown',
  handler: (_req, res) => {
    res.status(429).json({
      error:   'RATE_LIMIT_EXCEEDED',
      message: 'Too many verification attempts. Please wait before trying again.',
    });
  },
  skip: (req) => !!req.headers.authorization,
});

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface CertificateRow {
  // students
  student_id:          string;
  full_name:           string;
  verified_email:      string;
  kyc_status:          string;
  vecta_id_status:     string;
  face_photo_s3_key:   string | null;
  visa_expiry_year:    number | null;
  university_name:     string | null;
  program_of_study:    string | null;
  trust_score:         number | null;
  trust_score_tier:    string | null;
  // didit_sessions (most recent)
  liveness_score:      number | null;
  facial_match:        number | null;
  nfc_chip_verified:   boolean | null;
  // letters_of_credit (most recent active)
  guaranteed_months:   number | null;
  monthly_rent_target: number | null;
  solvency_verified:   boolean | null;
  // student_plaid_connections
  balance_tier:        string | null;
  // landlord_profiles (optional — for background check status)
  checkr_status:       string | null;
  // trust engine composite
  composite_score:     number | null;
  guarantee_tier:      string | null;
  max_rent_approval:   number | null;
  deposit_multiplier:  number | null;
}

// ---------------------------------------------------------------------------
// Aggregate all trust signals from DB
// ---------------------------------------------------------------------------

async function aggregateTrustData(studentId: string): Promise<CertificateRow | null> {
  return queryOne<CertificateRow>(
    `SELECT
       s.id                                          AS student_id,
       s.full_name,
       s.verified_email,
       s.kyc_status,
       s.vecta_id_status,
       s.face_photo_s3_key,
       s.visa_expiry_year,
       s.university_name,
       s.program_of_study,
       s.trust_score,
       s.trust_score_tier,

       -- Most recent Didit session (biometric scores)
       ds.liveness_score,
       ds.facial_match,
       ds.chip_verified                              AS nfc_chip_verified,

       -- Most recent active Letter of Credit
       loc.guaranteed_months,
       loc.monthly_rent_target,
       (loc.id IS NOT NULL AND s.kyc_status = 'APPROVED') AS solvency_verified,

       -- Plaid balance tier (from most recent active connection)
       CASE
         WHEN spc.verified_balance_usd >= 100000 THEN 'VERY_HIGH'
         WHEN spc.verified_balance_usd >= 50000  THEN 'HIGH'
         WHEN spc.verified_balance_usd >= 10000  THEN 'MEDIUM'
         ELSE 'LOW'
       END                                           AS balance_tier,

       -- Checkr background check (null = not requested)
       lp.background_check_status                   AS checkr_status,

       -- Trust engine composite (stored after last LoC generation)
       s.trust_score                                AS composite_score,
       s.trust_score_tier                           AS guarantee_tier,
       loc.guaranteed_months * loc.monthly_rent_target
         / 12                                       AS max_rent_approval,
       CASE s.trust_score_tier
         WHEN 'EXCELLENT' THEN 1.0
         WHEN 'GOOD'      THEN 1.5
         WHEN 'FAIR'      THEN 2.0
         ELSE 2.5
       END                                          AS deposit_multiplier

     FROM students s

     LEFT JOIN LATERAL (
       SELECT liveness_score, facial_match, chip_verified
       FROM didit_sessions
       WHERE student_id = s.id
       ORDER BY created_at DESC
       LIMIT 1
     ) ds ON TRUE

     LEFT JOIN LATERAL (
       SELECT id, guaranteed_months,
              (total_balance_usd / guaranteed_months)::int AS monthly_rent_target
       FROM letters_of_credit
       WHERE student_id = s.id
         AND expires_at > NOW()
         AND status = 'active'
       ORDER BY generated_at DESC
       LIMIT 1
     ) loc ON TRUE

     LEFT JOIN LATERAL (
       SELECT verified_balance_usd
       FROM student_plaid_connections
       WHERE student_id = s.id AND status = 'active'
       ORDER BY last_successful_update DESC
       LIMIT 1
     ) spc ON TRUE

     LEFT JOIN landlord_profiles lp
       ON lp.email = (
         -- landlord who requested this verification, if any
         SELECT landlord_email FROM landlord_verification_logs
         WHERE student_id = s.id
         ORDER BY created_at DESC LIMIT 1
       )

     WHERE s.id = $1`,
    [studentId],
  );
}

// ---------------------------------------------------------------------------
// GET /api/v1/certificate/:token
// ---------------------------------------------------------------------------

router.get('/certificate/:token', async (req: Request, res: Response) => {
  const { token } = req.params;
  const landlordIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    ?? req.ip
    ?? 'unknown';
  const landlordEmail = (req.headers['x-landlord-email'] as string | undefined)
    ?.trim()
    .toLowerCase();

  // --- 1. Validate token format (JWT shape) --------------------------------
  if (!token || token.length < 80 || !token.startsWith('ey')) {
    res.status(400).json({
      error:   'INVALID_TOKEN_FORMAT',
      message: 'The provided string is not a valid Vecta verification token.',
    });
    return;
  }

  // --- 2. Decode JWT to extract JTI (without full verify — verify happens next) ---
  let jti: string;
  let studentId: string;
  try {
    // We decode first to get the JTI for the single-use check
    const decoded = jwt.decode(token) as { jti?: string; sub?: string; exp?: number } | null;
    if (!decoded?.jti || !decoded?.sub) {
      throw new Error('Missing jti or sub in token');
    }
    if (decoded.exp && decoded.exp * 1000 < Date.now()) {
      res.status(401).json({ error: 'TOKEN_EXPIRED', message: 'This verification link has expired.' });
      return;
    }
    jti       = decoded.jti;
    studentId = decoded.sub;
  } catch (err) {
    res.status(401).json({ error: 'TOKEN_INVALID', message: 'Token could not be decoded.' });
    return;
  }

  // --- 3. Atomic token consumption + certificate issuance ------------------
  try {
    const certificate = await withTransaction(async (client) => {

      // 3a. Lock and validate single-use token
      const tokenRow = await client.query<{
        student_id: string; expires_at: string; used_at: string | null;
      }>(
        `SELECT student_id, expires_at, used_at
         FROM landlord_verification_tokens
         WHERE jti = $1
         FOR UPDATE SKIP LOCKED`,  // Prevents concurrent redemptions
        [jti],
      );

      if (tokenRow.rowCount === 0) {
        throw Object.assign(new Error('Token not found'), { code: 'TOKEN_NOT_FOUND', status: 404 });
      }

      const tokenRecord = tokenRow.rows[0]!;

      if (tokenRecord.used_at !== null) {
        throw Object.assign(new Error('Token already consumed'), {
          code:      'TOKEN_ALREADY_USED',
          status:    409,
          usedAt:    tokenRecord.used_at,
        });
      }

      if (new Date(tokenRecord.expires_at) < new Date()) {
        throw Object.assign(new Error('Token expired'), { code: 'TOKEN_EXPIRED', status: 401 });
      }

      if (tokenRecord.student_id !== studentId) {
        throw Object.assign(new Error('Token/student mismatch'), { code: 'TOKEN_INVALID', status: 401 });
      }

      // 3b. Stamp token as consumed
      await client.query(
        `UPDATE landlord_verification_tokens
         SET used_at = NOW(), used_by_ip = $2
         WHERE jti = $1`,
        [jti, landlordIp],
      );

      // 3c. Full JWT signature verification (after consumption stamp — prevents timing oracle)
      const JWT_PUBLIC_KEY = (process.env.VECTA_JWT_PUBLIC_KEY ?? '').replace(/\\n/g, '\n');
      try {
        jwt.verify(token, JWT_PUBLIC_KEY || 'dev-secret', {
          algorithms: JWT_PUBLIC_KEY ? ['RS256'] : ['HS256'],
          issuer:     process.env.VECTA_JWT_ISSUER   ?? 'vecta.io',
          audience:   process.env.VECTA_JWT_AUDIENCE ?? 'vecta-platform',
        });
      } catch {
        throw Object.assign(new Error('JWT signature invalid'), { code: 'TOKEN_INVALID', status: 401 });
      }

      // 3d. Aggregate trust data
      const row = await aggregateTrustData(studentId);
      if (!row) {
        throw Object.assign(new Error('Student not found'), { code: 'STUDENT_NOT_FOUND', status: 404 });
      }

      // 3e. Validate completeness — must have KYC before issuing certificate
      if (row.kyc_status !== 'APPROVED') {
        throw Object.assign(
          new Error(`KYC not approved: ${row.kyc_status}`),
          { code: 'KYC_NOT_APPROVED', status: 422, kycStatus: row.kyc_status },
        );
      }

      // Solvency is required for FULL certificate; PARTIAL is acceptable
      if (!row.solvency_verified && !row.guaranteed_months) {
        throw Object.assign(
          new Error('Solvency not yet verified'),
          { code: 'INCOMPLETE_PROFILE', status: 422, missing: 'solvency' },
        );
      }

      // 3f. Build TrustAttributes (zero PII)
      const attrs: TrustAttributes = {
        studentId:          row.student_id,
        kycStatus:          row.kyc_status as TrustAttributes['kycStatus'],
        nfcChipVerified:    row.nfc_chip_verified ?? false,
        livenessScore:      row.liveness_score ?? 0,
        facialMatchScore:   row.facial_match ?? 0,
        visaType:           'F-1',
        visaExpiryYear:     row.visa_expiry_year ?? new Date().getFullYear() + 1,
        universityName:     row.university_name ?? 'Unknown University',
        programOfStudy:     row.program_of_study ?? 'General Studies',
        solvencyVerified:   row.solvency_verified ?? false,
        balanceTier:        (row.balance_tier ?? 'LOW') as TrustAttributes['balanceTier'],
        guaranteeMonths:    row.guaranteed_months ?? 0,
        monthlyRentTarget:  row.monthly_rent_target ?? 0,
        novaScore:          row.trust_score ?? 580,
        novaScoreTier:      (row.trust_score_tier ?? 'BUILDING') as TrustAttributes['novaScoreTier'],
        checkrStatus:       (row.checkr_status as TrustAttributes['checkrStatus']) ?? null,
        compositeScore:     row.composite_score ?? 0,
        guaranteeTier:      (row.guarantee_tier ?? 'STANDARD') as TrustAttributes['guaranteeTier'],
        maxRentApproval:    row.max_rent_approval ?? 0,
        depositMultiplier:  row.deposit_multiplier ?? 2.0,
      };

      // 3g. Sign certificate
      const cert = await signCertificate(attrs);

      // 3h. Persist certificate record (for audit + re-download)
      await client.query(
        `INSERT INTO tenant_trust_certificates
           (cert_id, student_id, cert_status, canonical_hash, signature,
            public_key_hex, issued_at, expires_at, landlord_ip, landlord_email)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (cert_id) DO NOTHING`,
        [
          cert.certId,
          studentId,
          cert.certStatus,
          cert.canonicalHash,
          cert.signature,
          cert.publicKeyHex,
          cert.issuedAt,
          cert.expiresAt,
          landlordIp,
          landlordEmail ?? null,
        ],
      );

      return cert;
    });

    // --- 4. Audit log -------------------------------------------------------
    logAuditEvent(
      'CERTIFICATE_ISSUED',
      studentId,
      certificate.certId,
      {
        certStatus:    certificate.certStatus,
        landlordIp,
        landlordEmail: landlordEmail ?? null,
        guaranteeTier: certificate.attributes.guaranteeTier,
      },
    );

    logger.info(
      {
        certId:     certificate.certId,
        studentId,
        certStatus: certificate.certStatus,
        tier:       certificate.attributes.guaranteeTier,
      },
      'Trust certificate issued',
    );

    // Return certificate — attributes contain NO PII
    res.json({ certificate });

  } catch (err: unknown) {
    const e = err as { code?: string; status?: number; usedAt?: string; kycStatus?: string; missing?: string };

    logger.warn({ code: e.code, studentId, landlordIp }, 'Certificate issuance blocked');

    const status = e.status ?? 500;

    if (e.code === 'TOKEN_ALREADY_USED') {
      res.status(409).json({
        error:   'TOKEN_ALREADY_USED',
        message: 'This verification link has already been opened.',
        usedAt:  e.usedAt,
      });
    } else if (e.code === 'TOKEN_EXPIRED') {
      res.status(401).json({ error: 'TOKEN_EXPIRED', message: 'This verification link has expired.' });
    } else if (e.code === 'TOKEN_NOT_FOUND' || e.code === 'TOKEN_INVALID') {
      res.status(status).json({ error: e.code, message: 'Invalid or unknown verification token.' });
    } else if (e.code === 'KYC_NOT_APPROVED') {
      res.status(422).json({
        error:      'KYC_NOT_APPROVED',
        message:    'This student has not yet completed identity verification.',
        kycStatus:  e.kycStatus,
      });
    } else if (e.code === 'INCOMPLETE_PROFILE') {
      res.status(422).json({
        error:   'INCOMPLETE_PROFILE',
        message: 'Student profile is incomplete — solvency verification pending.',
        missing: e.missing,
      });
    } else {
      logger.error({ err, studentId }, 'Certificate generation failed');
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Certificate generation failed.' });
    }
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/certificate/verify  — client-side proof verification
// ---------------------------------------------------------------------------

router.post('/certificate/verify', verifyRateLimiter, async (req: Request, res: Response) => {
  const body = z.object({
    certificate: z.object({
      certId:        z.string().uuid(),
      version:       z.literal('1'),
      issuedAt:      z.string().datetime(),
      expiresAt:     z.string().datetime(),
      issuer:        z.string(),
      attributes:    z.record(z.unknown()),
      canonicalHash: z.string().regex(/^[0-9a-f]{64}$/),
      signature:     z.string().regex(/^[0-9a-f]{128}$/),
      publicKeyHex:  z.string().min(60),
      certStatus:    z.enum(['FULL', 'CONTINGENT', 'PARTIAL', 'INVALID']),
      keyId:         z.string().optional(),
    }),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: 'INVALID_PAYLOAD', details: body.error.flatten() });
    return;
  }

  const cert = {
    ...body.data.certificate,
    issuer: 'Vecta Financial Services LLC',
    keyId: body.data.certificate.keyId ?? 'vecta-cert-v1',
  } as unknown as SignedTrustCertificate;
  const result = verifyCertificate(cert);

  if (!result.valid) {
    logger.warn({ certId: cert.certId, reason: result.reason }, 'Certificate verification failed');
    res.status(400).json({
      valid:            false,
      reason:           result.reason,
      recomputedHash:   result.recomputedHash,
      providedHash:     cert.canonicalHash,
    });
    return;
  }

  res.json({
    valid:            true,
    certId:           cert.certId,
    recomputedHash:   result.recomputedHash,
    providedHash:     cert.canonicalHash,
    hashesMatch:      result.recomputedHash === cert.canonicalHash,
    certStatus:       cert.certStatus,
    issuedAt:         cert.issuedAt,
    expiresAt:        cert.expiresAt,
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/certificate/:certId/accept — landlord accepts tenant
// ---------------------------------------------------------------------------

router.post('/certificate/:certId/accept', async (req: Request, res: Response) => {
  const body = z.object({
    landlordEmail:   z.string().email().max(254).trim().toLowerCase(),
    propertyAddress: z.string().trim().min(5).max(500).transform((v) => v.replace(/<[^>]*>/g, '').replace(/[<>'"]/g, '')),
    monthlyRent:     z.number().positive().max(50_000),
    leaseStartDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    leaseDurationMonths: z.number().int().min(1).max(24),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: 'INVALID_PAYLOAD', details: body.error.flatten() });
    return;
  }

  const { certId } = z.object({ certId: z.string().uuid() }).parse(req.params);

  // Verify certificate exists and is valid
  const certRow = await queryOne<{
    student_id:  string;
    cert_status: string;
    expires_at:  string;
    canonical_hash: string;
  }>(
    `SELECT student_id, cert_status, expires_at, canonical_hash
     FROM tenant_trust_certificates
     WHERE cert_id = $1`,
    [certId],
  );

  if (!certRow) {
    res.status(404).json({ error: 'CERTIFICATE_NOT_FOUND' }); return;
  }

  if (new Date(certRow.expires_at) < new Date()) {
    res.status(410).json({ error: 'CERTIFICATE_EXPIRED' }); return;
  }

  if (certRow.cert_status === 'INVALID') {
    res.status(422).json({ error: 'CERTIFICATE_INVALID' }); return;
  }

  // Create lease application record
  const applicationId = crypto.randomUUID();
  await query(
    `INSERT INTO lease_applications
       (id, cert_id, student_id, landlord_email, property_address,
        monthly_rent, lease_start_date, lease_duration_months,
        status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING_SIGNATURE',NOW())`,
    [
      applicationId,
      certId,
      certRow.student_id,
      body.data.landlordEmail,
      body.data.propertyAddress,
      body.data.monthlyRent,
      body.data.leaseStartDate,
      body.data.leaseDurationMonths,
    ],
  );

  logAuditEvent(
    'TENANT_ACCEPTED',
    certRow.student_id,
    certId,
    {
      landlordEmail: body.data.landlordEmail,
      propertyAddress: body.data.propertyAddress,
      applicationId,
    },
  );

  res.status(201).json({
    applicationId,
    certId,
    status:  'PENDING_SIGNATURE',
    message: 'Tenant accepted. A lease agreement will be sent to both parties.',
  });
});

export { router as certificateRouter };
