/**
 * identity.router.ts — Identity routes for API Gateway
 *
 * ── Vecta ID (new, in-house) ─────────────────────────────────────────────────
 * POST /api/v1/identity/vecta-id/verify      — Process NFC verification result
 *
 * ── Legacy: Didit (fallback) ─────────────────────────────────────────────────
 * POST /api/v1/identity/verify/initiate      — Start Didit NFC session
 * GET  /api/v1/identity/verify/:sessionId    — Poll session status
 *
 * ── Shared ───────────────────────────────────────────────────────────────────
 * POST /api/v1/identity/token/mint           — Mint Vecta ID token (post-KYC)
 * GET  /api/v1/identity/token/verify         — Verify Vecta ID token (landlord)
 * POST /api/v1/identity/banking/provision    — Provision ledger DDA
 * GET  /api/v1/identity/banking/balance      — Get masked balance
 * (Didit / Unit webhooks — see identity-webhooks.router.ts)
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { identityService, mintVectaIDToken, verifyVectaIDToken } from '../../../services/identity-service/src/didit.service';
import type { VectaIDVerifyRequest } from '../../../services/identity-service/src/vecta-id.service';
import { baasService } from '../../../services/identity-service/src/unit.service';
import { authMiddleware, requireKYC } from '@vecta/auth';
import { createLogger } from '@vecta/logger';
const logger = createLogger('identity-router');
const router = Router();

// ---------------------------------------------------------------------------
// VectaID: process NFC verification result from mobile app
// POST /api/v1/identity/vecta-id/verify
// ---------------------------------------------------------------------------

router.post('/vecta-id/verify', authMiddleware, async (req: Request, res: Response) => {
  try {
    const studentId = (req as Request & { vectaUser: { sub: string } }).vectaUser?.sub;
    const body = z.object({
      chipAuthenticated: z.boolean(),
      passiveAuthPassed: z.boolean(),
      activeAuthPassed:  z.boolean(),
      livenessScore:     z.number().min(0).max(1),
      facialMatchScore:  z.number().min(0).max(1),
      documentData: z.object({
        firstName:      z.string().trim().max(100).transform((v) => v.replace(/<[^>]*>/g, '').replace(/[<>'"]/g, '')),
        lastName:       z.string().trim().max(100).transform((v) => v.replace(/<[^>]*>/g, '').replace(/[<>'"]/g, '')),
        documentNumber: z.string().trim().max(32).transform((v) => v.replace(/<[^>]*>/g, '').replace(/[<>'"]/g, '')),
        nationality:    z.string().trim().max(8).transform((v) => v.replace(/<[^>]*>/g, '').replace(/[<>'"]/g, '')),
        dateOfBirth:    z.string().trim().max(32),
        expiryDate:     z.string().trim().max(32),
        issuingCountry: z.string().trim().max(8).transform((v) => v.replace(/<[^>]*>/g, '').replace(/[<>'"]/g, '')),
      }),
      biometricPhotoHash: z.string().optional().default(''),
    }).parse(req.body) as Omit<VectaIDVerifyRequest, 'studentId'>;

    const { VectaIDService } = await import('../../../services/identity-service/src/vecta-id.service');
    const { getPool } = await import('@vecta/database');
    const service = new VectaIDService(getPool());
    const result  = await service.processVerification({ studentId, ...body } as VectaIDVerifyRequest);

    res.json({
      kycStatus:    result.kycStatus,
      vectaIdToken: result.vectaIdToken,
      failureReason:result.failureReason,
      provider:     'vecta-id',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', issues: err.issues });
    }
    logger.error({ err }, '[VectaID] Verification processing failed');
    res.status(500).json({ error: 'VECTA_ID_VERIFY_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Didit NFC verification — initiate (legacy fallback)
// ---------------------------------------------------------------------------

router.post('/verify/initiate', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { studentId } = z
      .object({ studentId: z.string().uuid() })
      .parse(req.body);

    const session = await identityService.initiateVerification(studentId);

    res.status(201).json({
      sessionId: session.sessionId,
      verificationUrl: session.verificationUrl,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to initiate Didit session');
    res.status(500).json({ error: 'VERIFICATION_INIT_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Poll Didit session status
// ---------------------------------------------------------------------------

router.get('/verify/:sessionId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(req.params);
    const row = await identityService.getSessionStatus(sessionId);

    if (!row) {
      res.status(404).json({ error: 'SESSION_NOT_FOUND' });
      return;
    }

    res.json({
      status: row.status,
      kycStatus: row.kyc_status ?? null,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get session status');
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// Mint Vecta ID Token (called after KYC approved)
// ---------------------------------------------------------------------------

router.post(
  '/token/mint',
  authMiddleware,
  requireKYC('APPROVED'),
  async (req: Request, res: Response) => {
    try {
      const studentId = req.vectaUser!.sub;
      const token = await mintVectaIDToken(studentId);
      res.status(201).json({ token });
    } catch (err) {
      logger.error({ err }, 'Failed to mint Vecta ID token');
      res.status(500).json({ error: 'TOKEN_MINT_FAILED' });
    }
  },
);

// ---------------------------------------------------------------------------
// Verify Vecta ID Token — used by landlord portal (server-side)
// ---------------------------------------------------------------------------

router.post('/token/verify', async (req: Request, res: Response) => {
  try {
    const { token, landlordIp, landlordUserAgent } = z
      .object({
        token:             z.string().min(10).max(8192),
        landlordIp:        z.string().trim().max(128).transform((v) => v.replace(/<[^>]*>/g, '').replace(/[<>'"]/g, '')).optional(),
        landlordUserAgent: z.string().trim().max(512).transform((v) => v.replace(/<[^>]*>/g, '').replace(/[<>'"]/g, '')).optional(),
      })
      .parse(req.body);

    const view = await verifyVectaIDToken(
      token,
      landlordIp ?? req.ip ?? 'unknown',
      landlordUserAgent ?? req.headers['user-agent'] ?? 'unknown',
    );

    if (!view) {
      res.status(404).json({ error: 'STUDENT_NOT_FOUND' });
      return;
    }

    res.json(view);
  } catch (err) {
    logger.error({ err }, 'Token verification failed');
    if (err instanceof Error && err.message.includes('expired')) {
      res.status(401).json({ error: 'TOKEN_EXPIRED' });
      return;
    }
    res.status(401).json({ error: 'INVALID_TOKEN' });
  }
});

// ---------------------------------------------------------------------------
// Provision Unit.co DDA
// ---------------------------------------------------------------------------

router.post(
  '/banking/provision',
  authMiddleware,
  requireKYC('APPROVED'),
  async (req: Request, res: Response) => {
    try {
      const studentId = req.vectaUser!.sub;
      const result = await baasService.provisionStudentAccountByStudentId(studentId);
      res.status(201).json({
        accountProvisioned: true,
        kycStatus: result.kycStatus,
      });
    } catch (err) {
      logger.error({ err }, 'Unit.co provisioning failed');
      res.status(500).json({ error: 'BANKING_PROVISION_FAILED' });
    }
  },
);

// ---------------------------------------------------------------------------
// Get masked balance (last 4 + masked amount range)
// ---------------------------------------------------------------------------

router.get(
  '/banking/balance',
  authMiddleware,
  requireKYC('APPROVED'),
  async (req: Request, res: Response) => {
    try {
      const studentId = req.vectaUser!.sub;
      const balance = await baasService.getMaskedBalance(studentId);
      res.json(balance);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch balance');
      res.status(500).json({ error: 'BALANCE_FETCH_FAILED' });
    }
  },
);

// ---------------------------------------------------------------------------
// Transactions — student-only (never exposed to landlord portal)
// ---------------------------------------------------------------------------

router.get('/transactions', authMiddleware, requireKYC('APPROVED'), async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;
    const limit     = Math.min(parseInt(req.query.limit  as string ?? '20', 10), 50);
    const offset    = parseInt(req.query.offset as string ?? '0',  10);
    const since     = req.query.since as string | undefined;

    const { getStudentTransactions } = await import('../../../services/identity-service/src/unit-transactions.service');
    const result = await getStudentTransactions(studentId, { limit, offset, since });
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Transactions fetch failed');
    res.status(500).json({ error: 'TRANSACTIONS_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Push token registration
// ---------------------------------------------------------------------------

router.post('/push-token', authMiddleware, async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;
    const { expoToken, deviceType } = z.object({
      expoToken:  z.string().startsWith('ExponentPushToken['),
      deviceType: z.enum(['ios', 'android']),
    }).parse(req.body);

    const { registerPushToken } = await import('../../../services/identity-service/src/push.service');
    await registerPushToken(studentId, expoToken, deviceType);
    res.json({ registered: true });
  } catch (err) {
    logger.error({ err }, 'Push token registration failed');
    res.status(500).json({ error: 'PUSH_REGISTER_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Generate Vecta ID Card
// POST /api/v1/identity/generate-id-card
// ---------------------------------------------------------------------------

router.post(
  '/generate-id-card',
  authMiddleware,
  requireKYC('APPROVED'),
  async (req: Request, res: Response) => {
    try {
      const studentId = req.vectaUser!.sub;
      const { getPool } = await import('@vecta/database');
      const db = getPool();

      // Fetch student data
      const { rows } = await db.query(
        `SELECT s.id, s.full_name, s.university_name, s.program_of_study,
                s.visa_type, s.visa_expiry_year, s.kyc_status,
                s.vecta_id_number, s.id_card_pdf_url, s.id_card_front_url,
                s.id_card_issued_at
         FROM students s WHERE s.id = $1`,
        [studentId],
      );

      if (!rows[0]) {
        res.status(404).json({ error: 'STUDENT_NOT_FOUND' });
        return;
      }

      const student = rows[0] as {
        id: string; full_name: string; university_name: string;
        program_of_study: string; visa_type: string; visa_expiry_year: number;
        kyc_status: string; vecta_id_number: string | null;
        id_card_pdf_url: string | null; id_card_front_url: string | null;
        id_card_issued_at: string | null;
      };

      // Generate a new VID number if needed
      const { generateVectaIDNumber, generateVectaIDCard } =
        await import('../../../services/identity-service/src/vecta-id-card.service');

      const vectaIdNumber = student.vecta_id_number
        ?? await generateVectaIDNumber(db);

      const issuedAt  = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

      // Fetch biometric photo if available (from KYC record)
      let photoBase64 = '';
      try {
        const photoRow = await db.query(
          `SELECT biometric_photo_hash FROM kyc_records WHERE student_id = $1
           ORDER BY created_at DESC LIMIT 1`,
          [studentId],
        );
        // Photo hash only — actual photo fetched from vault if stored
        photoBase64 = photoRow.rows[0]?.biometric_photo_hash ?? '';
      } catch { /* non-critical */ }

      const cardData = {
        studentId,
        vectaIdNumber,
        legalName:      student.full_name,
        university:     student.university_name,
        programOfStudy: student.program_of_study,
        visaType:       student.visa_type ?? 'F-1',
        visaExpiryYear: student.visa_expiry_year,
        issuedAt,
        expiresAt,
        photoBase64,
        verificationUrl: `https://verify.vecta.io/id/${vectaIdNumber}`,
        nfcVerified:     student.kyc_status === 'APPROVED',
        kycStatus:       student.kyc_status,
      };

      const result = await generateVectaIDCard(cardData);

      // Persist URLs and VID number
      await db.query(
        `UPDATE students SET
           vecta_id_number    = $1,
           id_card_pdf_url    = $2,
           id_card_front_url  = $3,
           id_card_back_url   = $4,
           id_card_issued_at  = $5,
           id_card_expires_at = $6
         WHERE id = $7`,
        [
          vectaIdNumber,
          result.s3PdfUrl,
          result.s3FrontUrl,
          result.s3BackUrl,
          issuedAt,
          expiresAt,
          studentId,
        ],
      );

      logger.info({ studentId, vectaIdNumber }, 'Vecta ID card generated and saved');

      res.status(201).json({
        pdfUrl:        result.s3PdfUrl,
        frontUrl:      result.s3FrontUrl,
        backUrl:       result.s3BackUrl,
        vectaIdNumber,
        issuedAt,
        expiresAt,
      });
    } catch (err) {
      logger.error({ err }, '[VectaIDCard] Generation failed');
      res.status(500).json({ error: 'ID_CARD_GENERATION_FAILED' });
    }
  },
);

// ---------------------------------------------------------------------------
// Get existing ID card
// GET /api/v1/identity/id-card
// ---------------------------------------------------------------------------

router.get('/id-card', authMiddleware, async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;
    const { getPool } = await import('@vecta/database');
    const { rows } = await getPool().query(
      `SELECT vecta_id_number, id_card_pdf_url, id_card_front_url,
              id_card_back_url, id_card_issued_at, id_card_expires_at, kyc_status
       FROM students WHERE id = $1`,
      [studentId],
    );

    if (!rows[0] || !rows[0].id_card_pdf_url) {
      res.json({
        exists:     false,
        kycStatus:  rows[0]?.kyc_status ?? 'PENDING',
      });
      return;
    }

    const s = rows[0] as {
      vecta_id_number: string; id_card_pdf_url: string;
      id_card_front_url: string; id_card_back_url: string;
      id_card_issued_at: string; id_card_expires_at: string;
      kyc_status: string;
    };

    const now     = new Date();
    const expires = new Date(s.id_card_expires_at);
    const status  = expires < now ? 'EXPIRED' : 'ACTIVE';

    res.json({
      exists:         true,
      vectaIdNumber:  s.vecta_id_number,
      pdfUrl:         s.id_card_pdf_url,
      frontUrl:       s.id_card_front_url,
      backUrl:        s.id_card_back_url,
      issuedAt:       s.id_card_issued_at,
      expiresAt:      s.id_card_expires_at,
      status,
      kycStatus:      s.kyc_status,
      verificationUrl: `https://verify.vecta.io/id/${s.vecta_id_number}`,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch ID card');
    res.status(500).json({ error: 'ID_CARD_FETCH_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Public verify endpoint — zero-knowledge facts only (NO auth required)
// GET /api/v1/identity/verify/:vectaIdNumber
// ---------------------------------------------------------------------------

router.get('/verify/:vectaIdNumber', async (req: Request, res: Response) => {
  try {
    const { vectaIdNumber } = req.params;

    // Strict format: VID-XXXX-XXXX-XXXX
    if (!/^VID-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(vectaIdNumber)) {
      res.status(400).json({ valid: false, error: 'INVALID_FORMAT' });
      return;
    }

    const { getPool } = await import('@vecta/database');
    const db = getPool();
    const { rows } = await db.query(
      `SELECT s.full_name, s.university_name, s.visa_type, s.visa_expiry_year,
              s.kyc_status, s.id_card_issued_at, s.id_card_expires_at,
              s.id_card_front_url, s.id,
              CASE WHEN k.id IS NOT NULL THEN true ELSE false END AS nfc_verified
       FROM students s
       LEFT JOIN kyc_records k ON k.student_id = s.id AND k.status = 'APPROVED'
       WHERE s.vecta_id_number = $1`,
      [vectaIdNumber],
    );

    if (!rows[0] || !rows[0].id_card_issued_at) {
      res.status(404).json({ valid: false, error: 'NOT_FOUND' });
      return;
    }

    const s = rows[0] as {
      full_name: string; university_name: string; visa_type: string;
      visa_expiry_year: number; kyc_status: string;
      id_card_issued_at: string; id_card_expires_at: string;
      id_card_front_url: string; id: string; nfc_verified: boolean;
    };

    const expired = new Date(s.id_card_expires_at) < new Date();
    const valid   = !expired && s.kyc_status === 'APPROVED';

    // Log verification
    await db.query(
      `INSERT INTO vecta_id_verifications
         (student_id, vecta_id_number, verified_by_ip, result, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        s.id,
        vectaIdNumber,
        req.ip ?? 'unknown',
        valid ? 'VALID' : 'EXPIRED',
        req.headers['user-agent'] ?? 'unknown',
      ],
    ).catch(() => { /* non-critical */ });

    res.json({
      valid,
      name:          s.full_name,
      university:    s.university_name,
      visaStatus:    s.kyc_status === 'APPROVED' ? 'F-1 ACTIVE' : 'PENDING',
      visaExpiryYear: s.visa_expiry_year,
      nfcVerified:   s.nfc_verified,
      issuedAt:      s.id_card_issued_at,
      expiresAt:     s.id_card_expires_at,
      frontImageUrl: s.id_card_front_url,
      // intentionally omitted: passport number, DOB, nationality, balance
    });
  } catch (err) {
    logger.error({ err }, 'Public verify failed');
    res.status(500).json({ valid: false, error: 'VERIFY_FAILED' });
  }
});

export { router as identityRouter };
