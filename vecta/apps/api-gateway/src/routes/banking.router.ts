import { Router } from 'express';
import type { Pool } from 'pg';
import type Redis from 'ioredis';

export function bankingRouter(_db: Pool, _redis: Redis) {
  const router = Router();
  return router;
}
