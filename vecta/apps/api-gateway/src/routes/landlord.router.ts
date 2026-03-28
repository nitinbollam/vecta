/**
 * apps/api-gateway/src/routes/landlord.router.ts
 *
 * Landlord-specific routes not in token.router.ts:
 *   POST /api/v1/landlord/background-check/initiate  — start Checkr check
 *   GET  /api/v1/landlord/background-check/status    — poll status
 *   POST /webhooks/checkr                            — Checkr completion webhook
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createLogger } from '@vecta/logger';
import { hmacVerify } from '@vecta/crypto';
import { queryOne } from '@vecta/database';

const logger = createLogger('landlord-router');
const router = Router();

// ---------------------------------------------------------------------------
// Initiate Checkr background check
// ---------------------------------------------------------------------------

router.post(
  '/landlord/background-check/initiate',
  async (req: Request, res: Response) => {
    try {
      const { landlordEmail } = z
        .object({ landlordEmail: z.string().email().max(254).trim().toLowerCase() })
        .parse(req.body);

      // Look up landlord by email
      const landlord = await queryOne<{ id: string; email_verified: boolean }>(
        `SELECT id, email_verified FROM landlord_profiles WHERE email = $1`,
        [landlordEmail.toLowerCase()],
      );

      if (!landlord) {
        res.status(404).json({ error: 'LANDLORD_NOT_FOUND' }); return;
      }

      if (!landlord.email_verified) {
        res.status(422).json({
          error:   'EMAIL_NOT_VERIFIED',
          message: 'Please verify your email before starting a background check.',
        });
        return;
      }

      const { initiateBackgroundCheck } = await import(
        '../../../../services/identity-service/src/checkr.service'
      );
      const result = await initiateBackgroundCheck(landlord.id);

      res.status(201).json({
        candidateId:   result.candidateId,
        reportId:      result.reportId,
        consentUrl:    result.consentUrl,
        estimatedDays: result.estimatedDays,
        message: 'Background check initiated. Please complete consent at the provided URL.',
      });
    } catch (err) {
      logger.error({ err }, 'Background check initiation failed');
      res.status(500).json({ error: 'BACKGROUND_CHECK_FAILED' });
    }
  },
);

// ---------------------------------------------------------------------------
// Poll background check status
// ---------------------------------------------------------------------------

router.get(
  '/landlord/background-check/status',
  async (req: Request, res: Response) => {
    try {
      const landlordEmail = (req.query.email as string ?? '').toLowerCase();
      if (!landlordEmail) {
        res.status(400).json({ error: 'EMAIL_REQUIRED' }); return;
      }

      const landlord = await queryOne<{ id: string }>(
        `SELECT id FROM landlord_profiles WHERE email = $1`,
        [landlordEmail],
      );

      if (!landlord) {
        res.status(404).json({ error: 'LANDLORD_NOT_FOUND' }); return;
      }

      const { getBackgroundCheckStatus } = await import(
        '../../../../services/identity-service/src/checkr.service'
      );
      const status = await getBackgroundCheckStatus(landlord.id);

      res.json(status);
    } catch (err) {
      logger.error({ err }, 'Background check status failed');
      res.status(500).json({ error: 'STATUS_FETCH_FAILED' });
    }
  },
);

// ---------------------------------------------------------------------------
// Checkr webhook (public — HMAC verified with Checkr signing secret)
// Body must be raw JSON (see server.ts express.raw for /webhooks).
// ---------------------------------------------------------------------------

function rawWebhookPayload(req: Request): string {
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  return JSON.stringify(req.body ?? {});
}

function safeHmacVerify(payload: string, signature: string, secret: string): boolean {
  try {
    return hmacVerify(payload, signature, secret);
  } catch {
    return false;
  }
}

function verifyCheckrWebhook(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers['x-checkr-signature'] as string | undefined;
  const webhookSecret = process.env.CHECKR_WEBHOOK_SECRET ?? '';

  if (!webhookSecret) {
    logger.error('CHECKR_WEBHOOK_SECRET not set — rejecting webhook');
    res.status(500).json({ error: 'Webhook not configured' });
    return;
  }

  if (!signature) {
    logger.warn('Checkr webhook received without signature');
    res.status(401).json({ error: 'Missing signature' });
    return;
  }

  const rawBody = rawWebhookPayload(req);
  if (!safeHmacVerify(rawBody, signature, webhookSecret)) {
    logger.warn({ ip: req.ip }, 'Checkr webhook signature mismatch — possible forgery');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  try {
    (req as Request & { parsedWebhookJson?: unknown }).parsedWebhookJson = JSON.parse(rawBody || '{}');
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }
  next();
}

router.post('/webhooks/checkr', verifyCheckrWebhook, async (req: Request, res: Response) => {
  const body = (req as Request & { parsedWebhookJson?: Record<string, unknown> }).parsedWebhookJson ?? {};

  try {
    const { handleCheckrWebhook } = await import(
      '../../../../services/identity-service/src/checkr.service'
    );
    await handleCheckrWebhook(
      body as unknown as import('../../../../services/identity-service/src/checkr.service').CheckrWebhookPayload,
    );
    res.json({ received: true });
  } catch (err) {
    logger.error({ err }, 'Checkr webhook processing failed');
    res.status(500).json({ error: 'WEBHOOK_FAILED' });
  }
});

export { router as landlordRouter };
