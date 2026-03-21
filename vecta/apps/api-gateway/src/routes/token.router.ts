/**
 * apps/api-gateway/src/routes/token.router.ts
 *
 * Student token management:
 *   GET    /api/v1/identity/tokens              — list active tokens
 *   DELETE /api/v1/identity/tokens/:jti/revoke  — revoke a token
 *
 * Landlord registration:
 *   POST   /api/v1/landlord/register            — create profile + send magic link
 *   POST   /api/v1/landlord/verify-email        — consume magic link
 *   GET    /api/v1/landlord/profile             — get tier + profile (for portal)
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { authMiddleware, listActiveTokens, revokeToken } from '@vecta/auth';
import { createLogger } from '@vecta/logger';
import { query, queryOne, withTransaction } from '@vecta/database';
import { hmacSign } from '@vecta/crypto';

const logger = createLogger('token-router');
const router = Router();

// ---------------------------------------------------------------------------
// Student: list active sharing tokens
// ---------------------------------------------------------------------------

router.get('/identity/tokens', authMiddleware, async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;
    const tokens    = await listActiveTokens(studentId);
    res.json({ tokens });
  } catch (err) {
    logger.error({ err }, 'Token list failed');
    res.status(500).json({ error: 'TOKEN_LIST_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Student: revoke a sharing token
// ---------------------------------------------------------------------------

router.delete(
  '/identity/tokens/:jti/revoke',
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const studentId = req.vectaUser!.sub;
      // Unmask JTI — stored as "abc123de…", real JTI looked up by prefix
      const jtiPrefix = req.params.jti.replace('…', '');

      // Find full JTI by prefix + student ownership
      const row = await queryOne<{ jti: string }>(
        `SELECT jti FROM landlord_verification_tokens
         WHERE student_id = $1 AND jti LIKE $2 AND used_at IS NULL`,
        [studentId, `${jtiPrefix}%`],
      );

      if (!row) {
        res.status(404).json({ error: 'TOKEN_NOT_FOUND' }); return;
      }

      await revokeToken(row.jti, studentId);
      res.json({ revoked: true });
    } catch (err) {
      logger.error({ err }, 'Token revoke failed');
      res.status(500).json({ error: 'REVOKE_FAILED' });
    }
  },
);

// ---------------------------------------------------------------------------
// Landlord: register + send magic link
// ---------------------------------------------------------------------------

router.post('/landlord/register', async (req: Request, res: Response) => {
  try {
    const { email, fullName, companyName } = z.object({
      email:       z.string().email().max(254),
      fullName:    z.string().max(200).optional(),
      companyName: z.string().max(200).optional(),
    }).parse(req.body);

    await withTransaction(async (client) => {
      // Upsert landlord profile (idempotent)
      await client.query(
        `INSERT INTO landlord_profiles (email, full_name, company_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE
           SET full_name    = COALESCE(EXCLUDED.full_name, landlord_profiles.full_name),
               company_name = COALESCE(EXCLUDED.company_name, landlord_profiles.company_name),
               updated_at   = NOW()`,
        [email, fullName ?? null, companyName ?? null],
      );

      // Generate magic link token (32 bytes → 43 chars base64url)
      const rawToken   = crypto.randomBytes(32).toString('base64url');
      const tokenHash  = hmacSign(rawToken);  // Store hash, not raw token
      const expiresAt  = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await client.query(
        `UPDATE landlord_profiles
         SET email_verification_token = $2,
             updated_at = NOW()
         WHERE email = $1`,
        [email, tokenHash + ':' + expiresAt.toISOString()],
      );

      // Send magic link email via internal notification service
      // In production: queue this via SQS/SNS or a transactional email provider
      const verifyUrl = `${process.env.VERIFICATION_BASE_URL ?? 'https://verify.vecta.io'}/landlord/verify-email?token=${rawToken}`;
      logger.info({ email: email.slice(0, 3) + '***', verifyUrl: '[REDACTED]' }, 'Magic link generated');

      // Send magic link via SendGrid
      const { sendLandlordVerifyEmail } = await import('../../../../services/identity-service/src/email.service');
      await sendLandlordVerifyEmail({
        toEmail:   email,
        toName:    fullName ?? undefined,
        verifyUrl,
      });
    });

    // Always 201 — never reveal if email exists
    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Landlord registration failed');
    res.status(201).json({ ok: true }); // Mask error
  }
});

// ---------------------------------------------------------------------------
// Landlord: verify email (consume magic link)
// ---------------------------------------------------------------------------

router.post('/landlord/verify-email', async (req: Request, res: Response) => {
  try {
    const { token } = z.object({ token: z.string().min(40).max(60) }).parse(req.body);

    const tokenHash = hmacSign(token);

    // Find landlord by token hash prefix (field is "hash:expiresAt")
    const landlord = await queryOne<{
      id: string;
      email: string;
      email_verified: boolean;
      email_verification_token: string | null;
      background_check_status: string | null;
    }>(
      `SELECT id, email, email_verified, email_verification_token, background_check_status
       FROM landlord_profiles
       WHERE email_verification_token LIKE $1`,
      [tokenHash + ':%'],
    );

    if (!landlord || !landlord.email_verification_token) {
      res.status(401).json({ error: 'TOKEN_NOT_FOUND' }); return;
    }

    if (landlord.email_verified) {
      res.status(401).json({ error: 'TOKEN_USED' }); return;
    }

    const [, expiresAtStr] = landlord.email_verification_token.split(':');
    if (!expiresAtStr || new Date(expiresAtStr) < new Date()) {
      res.status(401).json({ error: 'TOKEN_EXPIRED' }); return;
    }

    // Stamp email as verified + clear token
    await query(
      `UPDATE landlord_profiles
       SET email_verified = TRUE,
           email_verified_at = NOW(),
           email_verification_token = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [landlord.id],
    );

    const tier = landlord.background_check_status === 'APPROVED' ? 'TRUSTED' : 'VERIFIED';
    res.json({ ok: true, tier });
  } catch (err) {
    logger.error({ err }, 'Email verification failed');
    res.status(500).json({ error: 'VERIFICATION_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Landlord: get profile + tier (called by portal)
// ---------------------------------------------------------------------------

router.get('/landlord/profile', async (req: Request, res: Response) => {
  try {
    const email = req.headers['x-landlord-email'] as string;
    if (!email) { res.status(401).json({ error: 'EMAIL_REQUIRED' }); return; }

    const landlord = await queryOne<{
      id: string;
      email: string;
      full_name: string | null;
      company_name: string | null;
      email_verified: boolean;
      background_check_status: string | null;
    }>(
      `SELECT id, email, full_name, company_name, email_verified, background_check_status
       FROM landlord_profiles WHERE email = $1`,
      [email.toLowerCase()],
    );

    if (!landlord) {
      res.json({ tier: 'ANONYMOUS', email }); return;
    }

    const tier =
      !landlord.email_verified                               ? 'ANONYMOUS' :
      landlord.background_check_status === 'APPROVED'        ? 'TRUSTED'   :
                                                               'VERIFIED';

    res.json({
      tier,
      id:           landlord.id,
      email:        landlord.email,
      fullName:     landlord.full_name,
      companyName:  landlord.company_name,
      emailVerified: landlord.email_verified,
    });
  } catch (err) {
    logger.error({ err }, 'Landlord profile fetch failed');
    res.status(500).json({ error: 'PROFILE_FAILED' });
  }
});

export { router as tokenRouter };
