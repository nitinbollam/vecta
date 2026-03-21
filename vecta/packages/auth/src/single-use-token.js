"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerToken = registerToken;
exports.consumeToken = consumeToken;
exports.revokeToken = revokeToken;
exports.listActiveTokens = listActiveTokens;
const database_1 = require("@vecta/database");
const logger_1 = require("@vecta/logger");
const logger = (0, logger_1.createLogger)('single-use-token');
// ---------------------------------------------------------------------------
// Register a newly-minted token
// ---------------------------------------------------------------------------
async function registerToken(jti, studentId, expiresAt) {
    await (0, database_1.query)(`INSERT INTO landlord_verification_tokens (jti, student_id, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (jti) DO NOTHING`, [jti, studentId, expiresAt]);
    logger.info({ jti: jti.slice(0, 8), studentId }, 'Verification token registered');
}
async function consumeToken(jti, landlordIp) {
    return (0, database_1.withTransaction)(async (client) => {
        // Lock the row for update — prevents race-condition double-open
        const row = await client.query(`SELECT jti, student_id, expires_at, used_at, used_by_ip
       FROM landlord_verification_tokens
       WHERE jti = $1
       FOR UPDATE`, [jti]);
        if (row.rowCount === 0) {
            logger.warn({ jti: jti.slice(0, 8) }, 'Token not found in registry');
            return { ok: false, reason: 'NOT_FOUND' };
        }
        const token = row.rows[0];
        if (new Date(token.expires_at) < new Date()) {
            logger.warn({ jti: jti.slice(0, 8) }, 'Token expired');
            return { ok: false, reason: 'EXPIRED' };
        }
        if (token.used_at !== null) {
            logger.warn({ jti: jti.slice(0, 8), usedAt: token.used_at, usedByIp: token.used_by_ip }, 'Token already consumed');
            const base = {
                ok: false,
                reason: 'ALREADY_USED',
                usedAt: new Date(token.used_at),
            };
            if (token.used_by_ip != null) {
                return { ...base, usedByIp: token.used_by_ip };
            }
            return base;
        }
        // Atomically stamp as used
        await client.query(`UPDATE landlord_verification_tokens
       SET used_at = NOW(), used_by_ip = $2
       WHERE jti = $1`, [jti, landlordIp]);
        logger.info({ jti: jti.slice(0, 8), studentId: token.student_id, landlordIp }, 'Token consumed by landlord');
        return { ok: true };
    });
}
// ---------------------------------------------------------------------------
// Revoke a token (student withdraws sharing consent)
// ---------------------------------------------------------------------------
async function revokeToken(jti, studentId) {
    const result = await (0, database_1.query)(`DELETE FROM landlord_verification_tokens
     WHERE jti = $1 AND student_id = $2`, [jti, studentId]);
    if (result.rowCount === 0) {
        logger.warn({ jti: jti.slice(0, 8), studentId }, 'Token not found for revocation');
        return;
    }
    logger.info({ jti: jti.slice(0, 8), studentId }, 'Token revoked by student');
}
// ---------------------------------------------------------------------------
// List active tokens for a student (so they can see who has access)
// ---------------------------------------------------------------------------
async function listActiveTokens(studentId) {
    const result = await (0, database_1.query)(`SELECT jti, created_at, expires_at, used_at
     FROM landlord_verification_tokens
     WHERE student_id = $1 AND expires_at > NOW()
     ORDER BY created_at DESC`, [studentId]);
    return result.rows.map((r) => ({
        jti: r.jti.slice(0, 8) + '…', // Never expose full JTI to client
        createdAt: new Date(r.created_at),
        expiresAt: new Date(r.expires_at),
        used: r.used_at !== null,
        ...(r.used_at != null ? { usedAt: new Date(r.used_at) } : {}),
    }));
}
//# sourceMappingURL=single-use-token.js.map