import type { Redis } from 'ioredis';
import type { RequestHandler } from 'express';
import {
  authMiddleware as vectaAuthMiddleware,
  authMiddlewareOptional as vectaAuthMiddlewareOptional,
} from '@vecta/auth';

/** Gateway passes Redis for parity with older layout; JWT middleware uses env Redis internally. */
export function authMiddleware(_redis: Redis): RequestHandler {
  return (req, res, next) => {
    void vectaAuthMiddleware(req, res, next);
  };
}

export function authMiddlewareOptional(_redis: Redis): RequestHandler {
  return (req, res, next) => {
    void vectaAuthMiddlewareOptional(req, res, next);
  };
}
