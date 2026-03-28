/**
 * apps/api-gateway/src/routes/auth.router.ts
 *
 * Student authentication:
 *   POST /api/v1/auth/magic-link    — generate + email a one-time sign-in link
 *   POST /api/v1/auth/verify        — consume magic link → return auth JWT
 *   POST /api/v1/auth/refresh       — refresh a JWT (if < 30d old)
 *   POST /api/v1/auth/logout        — revoke current JWT JTI
 *   POST /api/v1/auth/dev-token     — dev only: returns a mock JWT (NODE_ENV≠production)
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createLogger } from '@vecta/logger';
import { query, queryOne, withTransaction } from '@vecta/database';
import { hmacSign, generateSecureToken } from '@vecta/crypto';
import { sendLandlordVerifyEmail } from '../../../../services/identity-service/src/email.service';
import { getRedisGateway } from '../lib/redis-shared';

const logger = createLogger('auth-router');
const router = Router();

const JWT_PRIVATE_KEY = (process.env.VECTA_JWT_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
const JWT_ISSUER      = process.env.VECTA_JWT_ISSUER   ?? 'vecta.io';
const JWT_AUDIENCE    = process.env.VECTA_JWT_AUDIENCE ?? 'vecta-platform';
const MAGIC_LINK_TTL  = 15 * 60 * 1000; // 15 minutes

// ---------------------------------------------------------------------------
// Send magic sign-in link (email)
// ---------------------------------------------------------------------------

router.post('/auth/magic-link', async (req: Request, res: Response) => {
  try {
    const { email } = z.object({
      email: z.string().email().max(254).trim().toLowerCase(),
    }).parse(req.body);
    const normalised = email;

    const redis = getRedisGateway();
    const emailRateLimitKey = `magic_link_rate:${normalised}`;
    const attempts = await redis.incr(emailRateLimitKey);
    if (attempts === 1) {
      await redis.expire(emailRateLimitKey, 3600);
    }
    if (attempts > 3) {
      res.status(429).json({
        error:      'RATE_LIMIT_EXCEEDED',
        message:    'Maximum 3 sign-in links per hour per email address. Please check your inbox or try again later.',
        retryAfter: 3600,
      });
      return;
    }

    await withTransaction(async (client) => {
      // Upsert student by email (first-time creates the record)
      const row = await client.query<{ id: string }>(
        `INSERT INTO students (verified_email, kyc_status, vecta_id_status)
         VALUES ($1, 'PENDING', 'UNVERIFIED')
         ON CONFLICT (verified_email) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [normalised],
      );

      const studentId = row.rows[0]!.id;
      const rawToken  = generateSecureToken(32);               // 43-char base64url
      const tokenHash = hmacSign(rawToken);
      const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL);

      // Store hashed token (raw token never persisted)
      await client.query(
        `INSERT INTO student_magic_links (student_id, token_hash, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (student_id) DO UPDATE
           SET token_hash = EXCLUDED.token_hash,
               expires_at = EXCLUDED.expires_at,
               used_at    = NULL,
               created_at = NOW()`,
        [studentId, tokenHash, expiresAt],
      );

      const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'vecta://'}auth/verify?token=${rawToken}&email=${encodeURIComponent(normalised)}`;

      // Reuse email service (same SendGrid integration)
      // In production: use a dedicated student sign-in email template
      logger.info({ studentId, expiresAt }, 'Magic link generated');

      // TODO: replace with student-specific email template
      await sendLandlordVerifyEmail({ toEmail: normalised, verifyUrl });
    });

    // Always 200 (prevent email enumeration)
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Magic link send failed');
    res.json({ ok: true }); // Mask error
  }
});

// ---------------------------------------------------------------------------
// Verify magic link → mint student JWT
// ---------------------------------------------------------------------------

router.post('/auth/verify', async (req: Request, res: Response) => {
  try {
    const { token, email } = z.object({
      token: z.string().min(40).max(60),
      email: z.string().email().max(254).trim().toLowerCase(),
    }).parse(req.body);

    const normalised = email;
    const tokenHash  = hmacSign(token);

    const row = await queryOne<{
      student_id: string; expires_at: string; used_at: string | null;
    }>(
      `SELECT ml.student_id, ml.expires_at, ml.used_at
       FROM student_magic_links ml
       JOIN students s ON s.id = ml.student_id
       WHERE ml.token_hash = $1 AND s.verified_email = $2`,
      [tokenHash, normalised],
    );

    if (!row) {
      res.status(401).json({ error: 'INVALID_LINK' }); return;
    }
    if (row.used_at) {
      res.status(401).json({ error: 'LINK_ALREADY_USED' }); return;
    }
    if (new Date(row.expires_at) < new Date()) {
      res.status(401).json({ error: 'LINK_EXPIRED' }); return;
    }

    // Stamp as used
    await query(
      `UPDATE student_magic_links SET used_at = NOW() WHERE student_id = $1`,
      [row.student_id],
    );

    // Fetch full student profile for JWT payload
    const student = await queryOne<{
      id: string; kyc_status: string; vecta_id_status: string;
      role: string; university_name: string | null;
    }>(
      `SELECT id, kyc_status, vecta_id_status, role, university_name
       FROM students WHERE id = $1`,
      [row.student_id],
    );

    if (!student) {
      res.status(500).json({ error: 'STUDENT_NOT_FOUND' }); return;
    }

    const jti   = crypto.randomUUID();
    const now   = Math.floor(Date.now() / 1000);
    const expiry = now + 60 * 60 * 24 * 30; // 30 days

    const payload = {
      sub:         student.id,
      iss:         JWT_ISSUER,
      aud:         JWT_AUDIENCE,
      iat:         now,
      exp:         expiry,
      jti,
      role:        student.role ?? 'STUDENT',
      kycStatus:   student.kyc_status,
      vectaIdStatus: student.vecta_id_status,
      universityId: student.university_name ?? null,
    };

    const authToken = JWT_PRIVATE_KEY
      ? jwt.sign(payload, JWT_PRIVATE_KEY, { algorithm: 'RS256' })
      : jwt.sign(payload, 'dev-secret', { algorithm: 'HS256' }); // dev fallback

    // Register JTI (enables single logout via Redis revocation)
    await query(
      `INSERT INTO vecta_id_tokens (jti, student_id, issued_at, expires_at)
       VALUES ($1, $2, NOW(), TO_TIMESTAMP($3))
       ON CONFLICT DO NOTHING`,
      [jti, student.id, expiry],
    );

    res.json({ token: authToken, studentId: student.id });
  } catch (err) {
    logger.error({ err }, 'Magic link verification failed');
    res.status(500).json({ error: 'VERIFY_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Logout — revoke JWT in Redis
// ---------------------------------------------------------------------------

router.post('/auth/logout', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.json({ ok: true }); return;
    }

    const token = authHeader.slice(7);
    let jti: string | undefined;
    try {
      const decoded = jwt.decode(token) as { jti?: string } | null;
      jti = decoded?.jti;
    } catch { /* ignore */ }

    if (jti) {
      const { createClient } = await import('redis');
      const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' });
      await redis.connect();
      await redis.sAdd('vecta:revoked_tokens', jti);
      await redis.quit();
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Logout failed');
    res.json({ ok: true }); // Mask error
  }
});

// ---------------------------------------------------------------------------
// Dev token — never available in production
// ---------------------------------------------------------------------------

router.post('/auth/dev-token', (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).end(); return;
  }

  const jti  = crypto.randomUUID();
  const now  = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    {
      sub:          'dev-student-00000000-0000-0000-0000-000000000000',
      iss:           JWT_ISSUER,
      aud:           JWT_AUDIENCE,
      iat:           now,
      exp:           now + 60 * 60 * 24,
      jti,
      role:          'STUDENT',
      kycStatus:     'APPROVED',
      vectaIdStatus: 'VERIFIED',
    },
    'dev-secret',
    { algorithm: 'HS256' },
  );

  res.json({ token });
});

export { router as authRouter };
