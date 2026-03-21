/**
 * apps/api-gateway/src/routes/protocol.router.ts
 *
 * Trust Certificate Protocol API — beyond tenant validation.
 *
 *   GET  /api/v1/protocol/manifest            — what claims this student can issue
 *   POST /api/v1/protocol/visa-proof          — issue a Visa Status Proof certificate
 *   POST /api/v1/protocol/credit-proof        — issue a Credit Portability certificate
 *   POST /api/v1/protocol/verify              — verify any claim type (tenant/visa/credit)
 *
 *   POST /api/v1/protocol/liquidity/check     — check liquidity eligibility
 *   POST /api/v1/protocol/liquidity/allocate  — allocate from pool
 *   GET  /api/v1/protocol/liquidity/pools     — pool health (admin)
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createLogger, logAuditEvent } from '@vecta/logger';
import { queryOne } from '@vecta/database';
import { authMiddleware, requireKYC } from '@vecta/auth';
import {
  issueVisaCertificate,
  issueCreditCertificate,
  verifyProtocolCertificate,
  buildProtocolManifest,
  type VisaClaimAttributes,
  type CreditClaimAttributes,
} from '@vecta/auth';
import {
  checkLiquidityEligibility,
  allocateLiquidity,
  getPoolStats,
} from '../../../../services/compliance-service/src/liquidity-engine';

const logger = createLogger('protocol-router');
const router = Router();

// ---------------------------------------------------------------------------
// GET /protocol/manifest — what claims can this student issue?
// ---------------------------------------------------------------------------

router.get('/protocol/manifest', authMiddleware, requireKYC('APPROVED'), async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;

    const student = await queryOne<{
      kyc_status:          string;
      nfc_chip_verified:   boolean | null;
      plaid_connected:     boolean;
      nova_verified:       boolean;
    }>(
      `SELECT
         s.kyc_status,
         ds.chip_verified AS nfc_chip_verified,
         (spc.id IS NOT NULL) AS plaid_connected,
         (s.trust_score IS NOT NULL) AS nova_verified
       FROM students s
       LEFT JOIN LATERAL (
         SELECT chip_verified FROM didit_sessions WHERE student_id = s.id
         ORDER BY created_at DESC LIMIT 1
       ) ds ON TRUE
       LEFT JOIN student_plaid_connections spc
         ON spc.student_id = s.id AND spc.status = 'active'
       WHERE s.id = $1`,
      [studentId],
    );

    if (!student) { res.status(404).json({ error: 'STUDENT_NOT_FOUND' }); return; }

    const manifest = buildProtocolManifest({
      studentId,
      kycApproved:    student.kyc_status === 'APPROVED',
      nfcVerified:    student.nfc_chip_verified ?? false,
      plaidConnected: student.plaid_connected,
      novaVerified:   student.nova_verified,
    });

    res.json(manifest);
  } catch (err) {
    logger.error({ err }, 'Protocol manifest failed');
    res.status(500).json({ error: 'MANIFEST_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// POST /protocol/visa-proof — issue F-1 visa status certificate
// ---------------------------------------------------------------------------

router.post('/protocol/visa-proof', authMiddleware, requireKYC('APPROVED'), async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;

    const student = await queryOne<{
      university_name:     string | null;
      program_of_study:    string | null;
      visa_expiry_year:    number | null;
      nfc_chip_verified:   boolean | null;
      liveness_score:      number | null;
      enrollment_active:   boolean;
    }>(
      `SELECT
         s.university_name, s.program_of_study, s.visa_expiry_year,
         ds.chip_verified AS nfc_chip_verified,
         ds.liveness_score,
         TRUE AS enrollment_active
       FROM students s
       LEFT JOIN LATERAL (
         SELECT chip_verified, liveness_score FROM didit_sessions
         WHERE student_id = s.id ORDER BY created_at DESC LIMIT 1
       ) ds ON TRUE
       WHERE s.id = $1 AND s.kyc_status = 'APPROVED'`,
      [studentId],
    );

    if (!student) { res.status(422).json({ error: 'KYC_NOT_APPROVED' }); return; }
    if (!student.nfc_chip_verified) {
      res.status(422).json({
        error:   'NFC_REQUIRED',
        message: 'Visa status proof requires NFC passport chip verification.',
      });
      return;
    }

    const visaType = (req.body.visaType as string) || 'F-1';
    const i20Year  = parseInt(req.body.i20ExpiryYear as string, 10)
      || (student.visa_expiry_year ?? new Date().getFullYear() + 1);

    const attrs: VisaClaimAttributes = {
      claimType:          'VISA_STATUS_PROOF',
      claimVersion:       '1.0',
      studentId,
      universityName:     student.university_name ?? 'Unknown University',
      programOfStudy:     student.program_of_study ?? 'General Studies',
      visaType:           visaType as VisaClaimAttributes['visaType'],
      visaExpiryYear:     student.visa_expiry_year ?? new Date().getFullYear() + 1,
      i20ExpiryYear:      i20Year,
      verificationMethod: student.nfc_chip_verified ? 'NFC_CHIP' : 'OCR_ONLY',
      livenessVerified:   (student.liveness_score ?? 0) >= 0.92,
      enrollmentActive:   student.enrollment_active,
      dsoVerified:        false,   // requires DSO API integration
    };

    const cert = issueVisaCertificate(attrs);

    logAuditEvent('VISA_PROOF_ISSUED', studentId, cert.certId, {
      visaType:       visaType,
      visaExpiryYear: attrs.visaExpiryYear,
      assertions:     cert.assertions,
    });

    res.status(201).json({ certificate: cert });
  } catch (err) {
    logger.error({ err }, 'Visa proof issuance failed');
    res.status(500).json({ error: 'VISA_PROOF_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// POST /protocol/credit-proof — issue credit portability certificate
// ---------------------------------------------------------------------------

router.post('/protocol/credit-proof', authMiddleware, requireKYC('APPROVED'), async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;

    const student = await queryOne<{
      trust_score:          number | null;
      trust_score_tier:     string | null;
      balance_tier:         string | null;
      guaranteed_months:    number | null;
      plaid_connected:      boolean;
      country_of_origin_enc: string | null;
    }>(
      `SELECT
         s.trust_score, s.trust_score_tier,
         CASE
           WHEN spc.verified_balance_usd >= 100000 THEN 'VERY_HIGH'
           WHEN spc.verified_balance_usd >= 50000  THEN 'HIGH'
           WHEN spc.verified_balance_usd >= 10000  THEN 'MEDIUM'
           ELSE 'LOW'
         END AS balance_tier,
         loc.guaranteed_months,
         (spc.id IS NOT NULL) AS plaid_connected,
         s.country_of_origin_enc
       FROM students s
       LEFT JOIN student_plaid_connections spc ON spc.student_id = s.id AND spc.status = 'active'
       LEFT JOIN LATERAL (
         SELECT guaranteed_months FROM letters_of_credit
         WHERE student_id = s.id AND expires_at > NOW()
         ORDER BY generated_at DESC LIMIT 1
       ) loc ON TRUE
       WHERE s.id = $1 AND s.kyc_status = 'APPROVED'`,
      [studentId],
    );

    if (!student) { res.status(422).json({ error: 'KYC_NOT_APPROVED' }); return; }
    if (!student.trust_score) {
      res.status(422).json({
        error:   'CREDIT_NOT_VERIFIED',
        message: 'Credit portability proof requires completed Nova Credit check.',
      });
      return;
    }
    if (!student.plaid_connected) {
      res.status(422).json({
        error:   'BANK_NOT_CONNECTED',
        message: 'Credit portability proof requires a connected bank account.',
      });
      return;
    }

    // Decrypt country — used only for sourceCountry field (not PII exposure)
    const { decryptField } = await import('@vecta/crypto');
    let sourceCountry = 'INTL';
    if (student.country_of_origin_enc) {
      try {
        const decrypted = await decryptField(student.country_of_origin_enc);
        // Map to 2-letter ISO code for the certificate (not the full name)
        sourceCountry = decrypted.slice(0, 2).toUpperCase();
      } catch { /* use fallback */ }
    }

    const tier = (student.trust_score_tier ?? 'BUILDING') as CreditClaimAttributes['usCreditScoreTier'];
    const tierRanges: Record<string, [number, number]> = {
      EXCELLENT: [740, 850], GOOD: [670, 739], FAIR: [580, 669], BUILDING: [300, 579],
    };
    const [min, max] = tierRanges[tier] ?? [300, 579];

    const attrs: CreditClaimAttributes = {
      claimType:           'CREDIT_PORTABILITY_PROOF',
      claimVersion:        '1.0',
      studentId,
      usCreditScoreTier:   tier,
      usCreditScoreMin:    min,
      usCreditScoreMax:    max,
      creditHistoryMonths: 24,   // Nova Credit default lookback
      sourceCountry,
      liquidityTier:       (student.balance_tier ?? 'LOW') as CreditClaimAttributes['liquidityTier'],
      guaranteeMonths:     student.guaranteed_months ?? 0,
      novaVerified:        student.trust_score !== null,
      plaidVerified:       student.plaid_connected,
    };

    const cert = issueCreditCertificate(attrs);

    logAuditEvent('CREDIT_PROOF_ISSUED', studentId, cert.certId, {
      tier:               tier,
      liquidityTier:      attrs.liquidityTier,
      guaranteeMonths:    attrs.guaranteeMonths,
      assertions:         cert.assertions,
    });

    res.status(201).json({ certificate: cert });
  } catch (err) {
    logger.error({ err }, 'Credit proof issuance failed');
    res.status(500).json({ error: 'CREDIT_PROOF_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// POST /protocol/verify — verify any claim type
// ---------------------------------------------------------------------------

router.post('/protocol/verify', async (req: Request, res: Response) => {
  try {
    const body = z.object({
      certificate: z.object({
        certId:        z.string(),
        claimType:     z.enum(['TENANT_PROOF', 'VISA_STATUS_PROOF', 'CREDIT_PORTABILITY_PROOF']),
        canonicalHash: z.string().regex(/^[0-9a-f]{64}$/),
        signature:     z.string().regex(/^[0-9a-f]{128}$/),
        publicKeyHex:  z.string().min(60),
        attributes:    z.record(z.unknown()),
        assertions:    z.record(z.unknown()),
        expiresAt:     z.string(),
        issuedAt:      z.string(),
        issuer:        z.string(),
        version:       z.string(),
      }),
    }).safeParse(req.body);

    if (!body.success) {
      res.status(400).json({ error: 'INVALID_PAYLOAD', details: body.error.flatten() });
      return;
    }

    if (body.data.certificate.claimType === 'TENANT_PROOF') {
      // Delegate to the existing certificate verify endpoint logic
      const { verifyCertificate } = await import('@vecta/auth');
      const result = verifyCertificate(body.data.certificate as Parameters<typeof verifyCertificate>[0]);
      res.json({ valid: result.valid, reason: result.reason, claimType: 'TENANT_PROOF', recomputedHash: result.recomputedHash });
    } else {
      const result = verifyProtocolCertificate(body.data.certificate as Parameters<typeof verifyProtocolCertificate>[0]);
      res.json(result);
    }
  } catch (err) {
    logger.error({ err }, 'Protocol verify failed');
    res.status(500).json({ error: 'VERIFY_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Liquidity endpoints
// ---------------------------------------------------------------------------

router.post('/protocol/liquidity/check', authMiddleware, requireKYC('APPROVED'), async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;

    const body = z.object({
      certId:        z.string().uuid(),
      city:          z.string().min(2).max(100),
      monthlyRent:   z.number().positive().max(20_000),
      guaranteeTier: z.string(),
    }).parse(req.body);

    const student = await queryOne<{ university_name: string | null }>(
      'SELECT university_name FROM students WHERE id = $1', [studentId],
    );

    const decision = await checkLiquidityEligibility({
      studentId,
      universityName: student?.university_name ?? '',
      city:           body.city,
      monthlyRent:    body.monthlyRent,
      guaranteeTier:  body.guaranteeTier,
      certId:         body.certId,
    });

    res.json(decision);
  } catch (err) {
    logger.error({ err }, 'Liquidity check failed');
    res.status(500).json({ error: 'LIQUIDITY_CHECK_FAILED' });
  }
});

router.post('/protocol/liquidity/allocate', authMiddleware, requireKYC('APPROVED'), async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;

    const body = z.object({
      certId:            z.string().uuid(),
      leaseApplicationId: z.string().uuid(),
      poolId:            z.string().uuid(),
      strategy:          z.enum(['GUARANTEED_RENT', 'UNIVERSITY_BACKED', 'CORPORATE_PARTNER']),
      monthlyRent:       z.number().positive(),
      monthsCovered:     z.number().int().min(1).max(3),
      badgeText:         z.string().max(200),
    }).parse(req.body);

    const result = await allocateLiquidity({
      studentId,
      certId:            body.certId,
      leaseApplicationId: body.leaseApplicationId,
      poolId:            body.poolId,
      strategy:          body.strategy,
      monthlyRent:       body.monthlyRent,
      monthsCovered:     body.monthsCovered,
      badgeText:         body.badgeText,
    });

    res.status(201).json(result);
  } catch (err) {
    logger.error({ err }, 'Liquidity allocation failed');
    res.status(500).json({
      error:   'ALLOCATION_FAILED',
      message: err instanceof Error ? err.message : 'Allocation failed',
    });
  }
});

router.get('/protocol/liquidity/pools', async (req: Request, res: Response) => {
  // Admin-only (OFFICER_KEY required in production)
  try {
    const stats = await getPoolStats();
    res.json({ pools: stats, fetchedAt: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, 'Pool stats failed');
    res.status(500).json({ error: 'POOL_STATS_FAILED' });
  }
});


// ---------------------------------------------------------------------------
// GET /keys/jwks — public key registry for third-party verifiers
// No auth. CORS open. 24h cache.
// ---------------------------------------------------------------------------

router.get('/keys/jwks', async (_req: Request, res: Response) => {
  try {
    const { buildJWKS } = await import('@vecta/auth');
    const jwks = buildJWKS();
    res
      .set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600')
      .set('Access-Control-Allow-Origin', '*')
      .set('X-Vecta-Protocol-Version', '1.0')
      .json(jwks);
  } catch (err) {
    logger.error({ err }, 'JWKS endpoint failed');
    res.status(503).json({ error: 'KEY_REGISTRY_UNAVAILABLE' });
  }
});

// ---------------------------------------------------------------------------
// GET /keys/rotate-status — ops view of key rotation state (admin-only)
// ---------------------------------------------------------------------------

router.get('/keys/rotate-status', async (req: Request, res: Response) => {
  if (req.headers['x-officer-key'] !== (process.env.COMPLIANCE_OFFICER_KEY ?? '')) {
    res.status(401).json({ error: 'OFFICER_AUTH_REQUIRED' }); return;
  }
  try {
    const { getKeyRegistry } = await import('@vecta/auth');
    const reg  = getKeyRegistry();
    const keys = reg.getAllPublicKeys().map(({ keyId, algorithm, notBefore, notAfter, status }) => ({
      keyId, algorithm, notBefore, notAfter, status,
      currentlyActive: keyId === reg.getCurrentKeyId(),
    }));
    res.json({ keys, activeKeyId: reg.getCurrentKeyId() });
  } catch (err) {
    logger.error({ err }, 'Key status failed');
    res.status(500).json({ error: 'KEY_STATUS_FAILED' });
  }
});

export { router as protocolRouter };
