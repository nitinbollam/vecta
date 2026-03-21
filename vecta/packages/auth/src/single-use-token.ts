/**
 * packages/auth/src/single-use-token.ts
 *
 * Enforces that every Vecta ID sharing link can only be opened once.
 *
 * Flow:
 *   Student mints token → JTI registered (used_at = NULL)
 *   Landlord opens link  → JTI checked + atomically stamped (used_at = NOW())
 *   Any subsequent open  → 409 ALREADY_USED with who/when
 *
 * Why this matters:
 *   Without single-use enforcement a shared URL is a "forwardable identity link"
 *   — a forwarded email could give a third party (competitor, discriminatory
 *   actor) full access to the student's verified profile.
 */

import { query, withTransaction } from '@vecta/database';
import { createLogger } from '@vecta/logger';

const logger = createLogger('single-use-token');

// ---------------------------------------------------------------------------
// Register a newly-minted token
// ---------------------------------------------------------------------------

export async function registerToken(
  jti: string,
  studentId: string,
  expiresAt: Date,
): Promise<void> {
  await query(
    `INSERT INTO landlord_verification_tokens (jti, student_id, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (jti) DO NOTHING`,
    [jti, studentId, expiresAt],
  );
  logger.info({ jti: jti.slice(0, 8), studentId }, 'Verification token registered');
}

// ---------------------------------------------------------------------------
// Consume a token — atomic check-and-stamp
// ---------------------------------------------------------------------------

export type ConsumeResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'ALREADY_USED'; usedAt?: Date; usedByIp?: string };

export async function consumeToken(
  jti: string,
  landlordIp: string,
): Promise<ConsumeResult> {
  return withTransaction(async (client) => {
    // Lock the row for update — prevents race-condition double-open
    const row = await client.query<{
      jti: string;
      student_id: string;
      expires_at: string;
      used_at: string | null;
      used_by_ip: string | null;
    }>(
      `SELECT jti, student_id, expires_at, used_at, used_by_ip
       FROM landlord_verification_tokens
       WHERE jti = $1
       FOR UPDATE`,
      [jti],
    );

    if (row.rowCount === 0) {
      logger.warn({ jti: jti.slice(0, 8) }, 'Token not found in registry');
      return { ok: false, reason: 'NOT_FOUND' };
    }

    const token = row.rows[0]!;

    if (new Date(token.expires_at) < new Date()) {
      logger.warn({ jti: jti.slice(0, 8) }, 'Token expired');
      return { ok: false, reason: 'EXPIRED' };
    }

    if (token.used_at !== null) {
      logger.warn(
        { jti: jti.slice(0, 8), usedAt: token.used_at, usedByIp: token.used_by_ip },
        'Token already consumed',
      );
      const base = {
        ok: false as const,
        reason: 'ALREADY_USED' as const,
        usedAt: new Date(token.used_at),
      };
      if (token.used_by_ip != null) {
        return { ...base, usedByIp: token.used_by_ip };
      }
      return base;
    }

    // Atomically stamp as used
    await client.query(
      `UPDATE landlord_verification_tokens
       SET used_at = NOW(), used_by_ip = $2
       WHERE jti = $1`,
      [jti, landlordIp],
    );

    logger.info(
      { jti: jti.slice(0, 8), studentId: token.student_id, landlordIp },
      'Token consumed by landlord',
    );

    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Revoke a token (student withdraws sharing consent)
// ---------------------------------------------------------------------------

export async function revokeToken(jti: string, studentId: string): Promise<void> {
  const result = await query(
    `DELETE FROM landlord_verification_tokens
     WHERE jti = $1 AND student_id = $2`,
    [jti, studentId],
  );

  if (result.rowCount === 0) {
    logger.warn({ jti: jti.slice(0, 8), studentId }, 'Token not found for revocation');
    return;
  }

  logger.info({ jti: jti.slice(0, 8), studentId }, 'Token revoked by student');
}

// ---------------------------------------------------------------------------
// List active tokens for a student (so they can see who has access)
// ---------------------------------------------------------------------------

export async function listActiveTokens(studentId: string): Promise<Array<{
  jti: string;
  createdAt: Date;
  expiresAt: Date;
  used: boolean;
  usedAt?: Date;
}>> {
  const result = await query<{
    jti: string;
    created_at: string;
    expires_at: string;
    used_at: string | null;
  }>(
    `SELECT jti, created_at, expires_at, used_at
     FROM landlord_verification_tokens
     WHERE student_id = $1 AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [studentId],
  );

  return result.rows.map((r) => ({
    jti:       r.jti.slice(0, 8) + '…',  // Never expose full JTI to client
    createdAt: new Date(r.created_at),
    expiresAt: new Date(r.expires_at),
    used:      r.used_at !== null,
    ...(r.used_at != null ? { usedAt: new Date(r.used_at) } : {}),
  }));
}
