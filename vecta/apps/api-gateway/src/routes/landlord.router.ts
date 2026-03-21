/**
 * apps/api-gateway/src/routes/landlord.router.ts
 *
 * Landlord-specific routes not in token.router.ts:
 *   POST /api/v1/landlord/background-check/initiate  — start Checkr check
 *   GET  /api/v1/landlord/background-check/status    — poll status
 *   POST /webhooks/checkr                            — Checkr completion webhook
 */

import { Router, Request, Response } from 'express';
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
        .object({ landlordEmail: z.string().email() })
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
// ---------------------------------------------------------------------------

router.post('/webhooks/checkr', async (req: Request, res: Response) => {
  const signature = req.headers['x-checkr-signature'] as string;
  const secret    = process.env.CHECKR_WEBHOOK_SECRET ?? '';

  if (!signature) {
    res.status(400).json({ error: 'MISSING_SIGNATURE' }); return;
  }

  const rawBody = JSON.stringify(req.body);

  if (!hmacVerify(rawBody, signature, secret)) {
    logger.warn({}, 'Checkr webhook HMAC verification failed');
    res.status(401).json({ error: 'INVALID_SIGNATURE' }); return;
  }

  try {
    const { handleCheckrWebhook } = await import(
      '../../../../services/identity-service/src/checkr.service'
    );
    await handleCheckrWebhook(req.body);
    res.json({ received: true });
  } catch (err) {
    logger.error({ err }, 'Checkr webhook processing failed');
    res.status(500).json({ error: 'WEBHOOK_FAILED' });
  }
});

export { router as landlordRouter };
