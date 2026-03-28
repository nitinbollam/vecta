/**
 * @vecta/auth/middleware — Express JWT authentication middleware.
 *
 * - Verifies RS256 Vecta ID Token (public key from ENV or JWKS endpoint)
 * - Checks Redis revocation set — invalidated tokens are rejected instantly
 * - Attaches decoded payload to `req.vectaUser`
 * - Integrates with RBAC permission checks from rbac.ts
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createClient, RedisClientType } from 'redis';
import { createLogger } from '@vecta/logger';
import { checkPermission, UserRole } from './rbac';
import type { VectaIDTokenPayload } from '@vecta/types';

const logger = createLogger('auth-middleware');

// ---------------------------------------------------------------------------
// Key material (read lazily so @vecta/auth can load before env is guaranteed)
// ---------------------------------------------------------------------------

const JWT_ISSUER = process.env.VECTA_JWT_ISSUER ?? 'vecta.io';
const JWT_AUDIENCE = process.env.VECTA_JWT_AUDIENCE ?? 'vecta-platform';

function getJwtPublicKey(): string | null {
  const k = (process.env.VECTA_JWT_PUBLIC_KEY ?? '').replace(/\\n/g, '\n').trim();
  return k || null;
}

// ---------------------------------------------------------------------------
// Redis client (shared across requests — connect once)
// ---------------------------------------------------------------------------

let _redis: RedisClientType | null = null;

async function getRedis(): Promise<RedisClientType> {
  if (_redis?.isReady) return _redis;

  _redis = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' }) as RedisClientType;
  _redis.on('error', (err) => logger.error({ err }, 'Redis client error'));
  await _redis.connect();
  return _redis;
}

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7).trim() || null;
}

/** Paths mounted under /api/v1 that must not require a Bearer JWT (magic links, webhooks-by-proxy, JWKS, etc.). */
function normalizeGatewayPath(req: Request): string {
  const raw = (req.originalUrl ?? req.url ?? "").split("?")[0] ?? "";
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw;
}

export function isUnauthenticatedPublicApiV1Route(req: Request): boolean {
  const method = req.method;
  if (method === "OPTIONS" || method === "HEAD") return true;

  const path = normalizeGatewayPath(req);

  const postExact = new Set([
    "/api/v1/auth/magic-link",
    "/api/v1/auth/verify",
    "/api/v1/auth/dev-token",
    "/api/v1/identity/token/verify",
    "/api/v1/landlord/register",
    "/api/v1/landlord/verify-email",
    "/api/v1/landlord/onboard",
    "/api/v1/landlord/acceptance",
    "/api/v1/certificate/verify",
    "/api/v1/protocol/verify",
  ]);

  if (method === "POST" && postExact.has(path)) return true;
  if (method === "POST" && /^\/api\/v1\/certificate\/[^/]+\/accept$/.test(path)) return true;

  if (method === "GET") {
    if (path === "/api/v1/landlord/social-proof") return true;
    if (/^\/api\/v1\/landlord\/comparable\/[^/]+$/.test(path)) return true;
    if (/^\/api\/v1\/certificate\/[^/]+$/.test(path)) return true;
    if (path === "/api/v1/protocol/liquidity/pools") return true;
    if (path === "/api/v1/keys/jwks") return true;
    if (path === "/api/v1/keys/rotate-status") return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Extend Express Request
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      vectaUser?: VectaIDTokenPayload;
      correlationId?: string;
    }
  }
}

// ---------------------------------------------------------------------------
// Core auth middleware
// ---------------------------------------------------------------------------

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Attach correlation ID from header or generate one
  req.correlationId =
    (req.headers['x-correlation-id'] as string) ??
    crypto.randomUUID();
  res.setHeader('x-correlation-id', req.correlationId);

  if (isUnauthenticatedPublicApiV1Route(req)) {
    next();
    return;
  }

  const jwtPublicKey = getJwtPublicKey();
  if (!jwtPublicKey) {
    logger.error({ correlationId: req.correlationId }, 'VECTA_JWT_PUBLIC_KEY is not set');
    res.status(503).json({
      error: 'AUTH_MISCONFIGURED',
      message: 'JWT verification is not configured on this server.',
    });
    return;
  }

  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      error: 'MISSING_TOKEN',
      message: 'Authorization: Bearer <token> header required',
    });
    return;
  }

  let decoded: VectaIDTokenPayload;
  try {
    decoded = jwt.verify(token, jwtPublicKey, {
      algorithms: ['RS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as VectaIDTokenPayload;
  } catch (err) {
    const isExpired = err instanceof jwt.TokenExpiredError;
    logger.warn(
      { err, correlationId: req.correlationId },
      isExpired ? 'Token expired' : 'Token verification failed',
    );
    res.status(401).json({
      error: isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      message: isExpired
        ? 'Your session has expired. Please re-authenticate.'
        : 'Token signature invalid or malformed.',
    });
    return;
  }

  // Check Redis revocation set — O(1) lookup
  try {
    const redis = await getRedis();
    const revoked = await redis.sIsMember('vecta:revoked_tokens', decoded.jti);
    if (revoked) {
      logger.warn(
        { jti: decoded.jti, studentId: decoded.sub },
        'Revoked token presented',
      );
      res.status(401).json({
        error: 'TOKEN_REVOKED',
        message: 'This session has been revoked. Please sign in again.',
      });
      return;
    }
  } catch (err) {
    // Redis failure — fail open in dev, fail closed in production
    if (process.env.NODE_ENV === 'production') {
      logger.error({ err }, 'Redis unavailable — rejecting request (fail-closed)');
      res.status(503).json({ error: 'SERVICE_UNAVAILABLE' });
      return;
    }
    logger.warn({ err }, 'Redis unavailable — failing open (dev mode)');
  }

  req.vectaUser = decoded;
  next();
}

// ---------------------------------------------------------------------------
// Permission guard factory — wrap routes with RBAC checks
// ---------------------------------------------------------------------------

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.vectaUser;
    if (!user) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const role = (user.role ?? '') as UserRole;
    const result = checkPermission(role, permission);

    if (!result.allowed) {
      logger.warn(
        {
          studentId: user.sub,
          role,
          permission,
          reason: result.reason,
        },
        'Permission denied',
      );
      res.status(403).json({
        error: result.reason ?? 'FORBIDDEN',
        message: `Role '${role}' does not have permission: ${permission}`,
        ...(result.reason === 'F1_VISA_COMPLIANCE_VIOLATION' && {
          complianceNotice:
            'This action is prohibited for F-1 visa holders under Vecta lease-back agreements.',
          supportUrl: 'https://vecta.io/compliance/f1-restrictions',
        }),
      });
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// KYC gate — block actions until identity is verified
// ---------------------------------------------------------------------------

export function requireKYC(minStatus: 'PENDING' | 'APPROVED' = 'APPROVED') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.vectaUser;
    if (!user) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }

    if (minStatus === 'APPROVED' && user.kycStatus !== 'APPROVED') {
      res.status(403).json({
        error: 'KYC_REQUIRED',
        message: 'Identity verification must be completed before accessing this feature.',
        kycPortalUrl: 'https://app.vecta.io/verify',
      });
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Landlord-only guard — used on landlord portal API routes
// ---------------------------------------------------------------------------

export function requireLandlordRole(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = req.vectaUser;
  if (!user || user.role !== 'LANDLORD') {
    res.status(403).json({
      error: 'LANDLORD_ROLE_REQUIRED',
      message: 'This endpoint is restricted to verified landlords.',
    });
    return;
  }
  next();
}
