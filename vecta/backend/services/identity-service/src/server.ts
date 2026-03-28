/**
 * services/identity-service/src/server.ts
 *
 * Identity microservice — NFC passport verification + US banking.
 *
 * Routes:
 *   GET  /health
 *   POST /verify/initiate          — start Didit NFC session
 *   GET  /verify/:sessionId        — poll session status
 *   POST /token/mint               — mint Vecta ID token (post-KYC)
 *   POST /token/verify             — verify token (landlord use)
 *   POST /banking/provision        — provision Unit.co DDA
 *   GET  /banking/balance/:id      — masked balance
 *   POST /selfie-url               — refresh signed selfie URL
 *   POST /webhooks/didit           — Didit webhook (HMAC verified)
 *   POST /webhooks/unit            — Unit webhook (HMAC verified)
 */

import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { identityService, mintVectaIDToken, verifyVectaIDToken } from './didit.service';
import { baasService } from './unit.service';
import { checkDatabaseHealth, closePool } from '@vecta/database';
import { createLogger } from '@vecta/logger';
import { hmacVerify } from '@vecta/crypto';
import { getSignedSelfieUrl } from '@vecta/storage';
import {
  registerToken,
  consumeToken,
  buildLandlordContext,
  filterViewForTier,
  verifyInternalRequest,
} from '@vecta/auth';

const logger = createLogger('identity-service');
const app    = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '4mb' }));

function internalAuth(req: Request, res: Response, next: NextFunction) {
  const bodyJson =
    ['GET', 'HEAD', 'DELETE'].includes(req.method) ? '' : JSON.stringify(req.body ?? {});
  if (
    !verifyInternalRequest(
      req.method,
      req.path,
      bodyJson,
      req.headers as Record<string, string | string[] | undefined>,
    )
  ) {
    res.status(401).json({ error: 'INVALID_INTERNAL_AUTH' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get('/health', async (_req, res) => {
  const db = await checkDatabaseHealth();
  res.status(db.ok ? 200 : 503).json({
    status: db.ok ? 'ok' : 'degraded',
    service: 'identity-service',
    timestamp: new Date().toISOString(),
    db,
  });
});

// ---------------------------------------------------------------------------
// Didit — initiate NFC session
// ---------------------------------------------------------------------------
app.post('/verify/initiate', internalAuth, async (req: Request, res: Response) => {
  try {
    const { studentId } = z.object({ studentId: z.string().uuid() }).parse(req.body);
    const session = await identityService.initiateVerification(studentId);
    res.status(201).json(session);
  } catch (err) {
    logger.error({ err }, 'Verification initiation failed');
    res.status(500).json({ error: 'VERIFICATION_INIT_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Didit — poll session status
// ---------------------------------------------------------------------------
app.get('/verify/:sessionId', internalAuth, async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    if (!sessionId) {
      res.status(400).json({ error: 'MISSING_SESSION_ID' });
      return;
    }
    const row = await identityService.getSessionStatus(sessionId);
    if (!row) { res.status(404).json({ error: 'SESSION_NOT_FOUND' }); return; }
    res.json({ status: row.status, kycStatus: row.kyc_status ?? null });
  } catch (err) {
    logger.error({ err }, 'Session poll failed');
    res.status(500).json({ error: 'POLL_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Mint Vecta ID token
// ---------------------------------------------------------------------------
app.post('/token/mint', internalAuth, async (req: Request, res: Response) => {
  try {
    const { studentId } = z.object({ studentId: z.string().uuid() }).parse(req.body);
    const token = await mintVectaIDToken(studentId);

    const parts = token.split('.');
    const payloadB64 = parts[1];
    if (!payloadB64) {
      res.status(500).json({ error: 'TOKEN_MALFORMED' });
      return;
    }
    const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as {
      jti: string;
      exp: number;
    };
    await registerToken(
      decoded.jti,
      studentId,
      new Date(decoded.exp * 1000),
    );

    res.status(201).json({ token });
  } catch (err) {
    logger.error({ err }, 'Token mint failed');
    res.status(500).json({ error: 'TOKEN_MINT_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Verify token — for landlord portal server-side use
// ---------------------------------------------------------------------------
app.post('/token/verify', async (req: Request, res: Response) => {
  try {
    const { token, landlordIp, landlordUserAgent } = z.object({
      token:             z.string(),
      landlordIp:        z.string().optional(),
      landlordUserAgent: z.string().optional(),
    }).parse(req.body);

    // Decode JTI from token (without full verify — just to get the identifier)
    let jtiPreview: string | null = null;
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        jtiPreview = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()).jti ?? null;
      }
    } catch { /* ignore */ }

    // Enforce single-use
    if (jtiPreview) {
      const consumed = await consumeToken(jtiPreview, landlordIp ?? 'unknown');
      if (!consumed.ok) {
        if (consumed.reason === 'ALREADY_USED') {
          res.status(409).json({
            error: 'TOKEN_ALREADY_USED',
            message: 'This verification link has already been opened.',
            usedAt:   consumed.usedAt?.toISOString(),
            usedByIp: consumed.usedByIp,
          });
          return;
        }
        if (consumed.reason === 'EXPIRED') {
          res.status(401).json({ error: 'TOKEN_EXPIRED' }); return;
        }
      }
    }

    const verified = await verifyVectaIDToken(
      token,
      landlordIp ?? 'unknown',
      landlordUserAgent ?? 'unknown',
    );
    const p = verified.payload;
    const fullView: Record<string, unknown> = {
      fullName: p.legalName,
      selfieUrl: p.facialPhotoUrl,
      idStatus: p.idStatus,
      visaType: p.visaType,
      universityName: p.universityName,
      vectaTrustScore: p.vectaTrustScore,
      trustScoreTier: p.trustScoreTier,
      usPhoneNumber: p.usPhoneNumber,
      verifiedEmail: p.verifiedEmail,
      tokenExpiresAt: p.exp,
      generatedAt: p.iat,
      letterOfCreditId: p.letterOfCreditId,
      solvencyGuaranteeMonths: p.solvencyGuaranteeMonths,
      rentSplitEnabled: p.rentSplitEnabled,
    };

    const ctx = await buildLandlordContext(
      landlordIp ?? 'unknown',
      landlordUserAgent ?? 'unknown',
      req.body.landlordEmail as string | undefined,
    );
    const tieredView = filterViewForTier(fullView, ctx);

    res.json({ view: tieredView, tier: ctx.tier });

    const studentIdForNotify = p.sub;

    void (async () => {
      try {
        const { queryOne } = await import('@vecta/database');
        const student = await queryOne<{ id: string; email: string; legal_name: string | null }>(
          'SELECT id, email, legal_name FROM students WHERE id = $1',
          [studentIdForNotify],
        );
        if (student) {
          const { sendStudentTokenUsedEmail } = await import('./email.service');
          await sendStudentTokenUsedEmail({
            toEmail:     student.email,
            studentName: student.legal_name ?? 'Student',
            usedAt:      new Date(),
            tokensUrl:   `${process.env.EXPO_PUBLIC_API_URL?.replace('/api/v1','') ?? 'vecta://'}profile/tokens`,
          });
          // Push notification
          const { notifyStudent } = await import('./push.service');
          await notifyStudent(student.id, 'TOKEN_USED');
        }
      } catch (notifyErr) {
        const { createLogger } = await import('@vecta/logger');
        createLogger('identity-server').error({ notifyErr }, 'Token-used notification failed');
      }
    })();
  } catch (err) {
    logger.error({ err }, 'Token verification failed');
    const isExpired = err instanceof Error && err.message.toLowerCase().includes('expired');
    res.status(401).json({ error: isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN' });
  }
});

// ---------------------------------------------------------------------------
// Unit.co — provision DDA
// ---------------------------------------------------------------------------
app.post('/banking/provision', internalAuth, async (req: Request, res: Response) => {
  try {
    const { studentId } = z.object({ studentId: z.string().uuid() }).parse(req.body);
    const result = await baasService.provisionStudentAccountByStudentId(studentId);
    res.status(201).json({ accountProvisioned: true, kycStatus: result.kycStatus });
  } catch (err) {
    logger.error({ err }, 'Unit provisioning failed');
    res.status(500).json({ error: 'BANKING_PROVISION_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Masked balance
// ---------------------------------------------------------------------------
app.get('/banking/balance/:studentId', internalAuth, async (req: Request, res: Response) => {
  try {
    const studentId = req.params.studentId;
    if (!studentId) {
      res.status(400).json({ error: 'MISSING_STUDENT_ID' });
      return;
    }
    const balance = await baasService.getMaskedBalance(studentId);
    res.json(balance);
  } catch (err) {
    logger.error({ err }, 'Balance fetch failed');
    res.status(500).json({ error: 'BALANCE_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Refresh signed selfie URL (15-min TTL)
// ---------------------------------------------------------------------------
app.post('/selfie-url', internalAuth, async (req: Request, res: Response) => {
  try {
    const { selfieKey } = z.object({ selfieKey: z.string() }).parse(req.body);
    const url = await getSignedSelfieUrl(selfieKey);
    res.json({ url });
  } catch (err) {
    logger.error({ err }, 'Selfie URL refresh failed');
    res.status(500).json({ error: 'SELFIE_URL_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Didit webhook (public route — HMAC verified internally)
// ---------------------------------------------------------------------------
app.post('/webhooks/didit', async (req: Request, res: Response) => {
  const sig    = req.headers['x-didit-signature'] as string;
  const secret = process.env.DIDIT_WEBHOOK_SECRET ?? '';
  if (!sig || !hmacVerify(JSON.stringify(req.body), sig, secret)) {
    res.status(401).json({ error: 'INVALID_SIGNATURE' }); return;
  }
  try {
    const rawPayload = JSON.stringify(req.body);
    const body = req.body as { session_id?: string; id?: string };
    const sessionId = body.session_id ?? body.id;
    if (!sessionId) {
      res.status(400).json({ error: 'MISSING_SESSION_ID' });
      return;
    }
    await identityService.processVerificationResult(sessionId, rawPayload, sig);
    res.json({ received: true });
  } catch (err) {
    logger.error({ err }, 'Didit webhook processing failed');
    res.status(500).json({ error: 'WEBHOOK_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Unit.co webhook (public route — HMAC verified internally)
// ---------------------------------------------------------------------------
app.post('/webhooks/unit', async (req: Request, res: Response) => {
  const sig    = req.headers['x-unit-signature'] as string;
  const secret = process.env.UNIT_WEBHOOK_SECRET ?? '';
  if (!sig || !hmacVerify(JSON.stringify(req.body), sig, secret)) {
    res.status(401).json({ error: 'INVALID_SIGNATURE' }); return;
  }
  try {
    await baasService.handleKYCStatusUpdateFromWebhook(req.body);
    res.json({ received: true });
  } catch (err) {
    logger.error({ err }, 'Unit webhook processing failed');
    res.status(500).json({ error: 'WEBHOOK_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT ?? '3001', 10);
const server = app.listen(PORT, () => logger.info({ port: PORT }, 'Identity service started'));

process.on('SIGTERM', () => server.close(async () => { await closePool(); process.exit(0); }));
process.on('SIGINT',  () => server.close(async () => { await closePool(); process.exit(0); }));

export default app;
