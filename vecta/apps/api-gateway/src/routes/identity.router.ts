/**
 * identity.router.ts — Identity & Banking routes for API Gateway
 *
 * POST /api/v1/identity/verify/initiate      — Start Didit NFC session
 * GET  /api/v1/identity/verify/:sessionId    — Poll session status
 * POST /api/v1/identity/token/mint           — Mint Vecta ID token (post-KYC)
 * GET  /api/v1/identity/token/verify         — Verify Vecta ID token (landlord)
 * POST /api/v1/identity/banking/provision    — Provision Unit.co DDA
 * GET  /api/v1/identity/banking/balance      — Get masked balance
 * POST /webhooks/didit                       — Didit webhook (public)
 * POST /webhooks/unit                        — Unit.co webhook (public)
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { identityService, mintVectaIDToken, verifyVectaIDToken } from '../../../../services/identity-service/src/didit.service';
import { baasService } from '../../../../services/identity-service/src/unit.service';
import { authMiddleware, requireKYC } from '@vecta/auth';
import { createLogger } from '@vecta/logger';
import { hmacVerify } from '@vecta/crypto';

const logger = createLogger('identity-router');
const router = Router();

// ---------------------------------------------------------------------------
// Didit NFC verification — initiate
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
        token:             z.string(),
        landlordIp:        z.string().optional(),
        landlordUserAgent: z.string().optional(),
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
// Didit webhook (public — HMAC-verified)
// ---------------------------------------------------------------------------

router.post('/webhooks/didit', async (req: Request, res: Response) => {
  const signature = req.headers['x-didit-signature'] as string;

  if (!signature) {
    res.status(400).json({ error: 'MISSING_SIGNATURE' });
    return;
  }

  const rawBody = JSON.stringify(req.body);
  const secret = process.env.DIDIT_WEBHOOK_SECRET ?? '';

  if (!hmacVerify(rawBody, signature, secret)) {
    logger.warn({ signature }, 'Didit webhook HMAC verification failed');
    res.status(401).json({ error: 'INVALID_SIGNATURE' });
    return;
  }

  try {
    await identityService.processVerificationResult(
      String(req.body?.sessionId ?? ''),
      rawBody,
      signature,
    );
    res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err }, 'Didit webhook processing failed');
    res.status(500).json({ error: 'WEBHOOK_PROCESSING_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Unit.co webhook (public — HMAC-verified)
// ---------------------------------------------------------------------------

router.post('/webhooks/unit', async (req: Request, res: Response) => {
  const signature = req.headers['x-unit-signature'] as string;

  if (!signature) {
    res.status(400).json({ error: 'MISSING_SIGNATURE' });
    return;
  }

  const rawBody = JSON.stringify(req.body);
  const secret = process.env.UNIT_WEBHOOK_SECRET ?? '';

  if (!hmacVerify(rawBody, signature, secret)) {
    logger.warn({}, 'Unit webhook HMAC verification failed');
    res.status(401).json({ error: 'INVALID_SIGNATURE' });
    return;
  }

  try {
    await baasService.handleKYCStatusUpdateFromWebhook(req.body);
    res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err }, 'Unit webhook processing failed');
    res.status(500).json({ error: 'WEBHOOK_PROCESSING_FAILED' });
  }
});


// ---------------------------------------------------------------------------
// Transactions — student-only (never exposed to landlord portal)
// ---------------------------------------------------------------------------

router.get('/identity/transactions', authMiddleware, requireKYC('APPROVED'), async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;
    const limit     = Math.min(parseInt(req.query.limit  as string ?? '20', 10), 50);
    const offset    = parseInt(req.query.offset as string ?? '0',  10);
    const since     = req.query.since as string | undefined;

    const { getStudentTransactions } = await import('../../../../services/identity-service/src/unit-transactions.service');
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

router.post('/identity/push-token', authMiddleware, async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;
    const { expoToken, deviceType } = z.object({
      expoToken:  z.string().startsWith('ExponentPushToken['),
      deviceType: z.enum(['ios', 'android']),
    }).parse(req.body);

    const { registerPushToken } = await import('../../../../services/identity-service/src/push.service');
    await registerPushToken(studentId, expoToken, deviceType);
    res.json({ registered: true });
  } catch (err) {
    logger.error({ err }, 'Push token registration failed');
    res.status(500).json({ error: 'PUSH_REGISTER_FAILED' });
  }
});

export { router as identityRouter };
