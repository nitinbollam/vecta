/**
 * services/banking-service/src/server.ts
 *
 * Standalone banking microservice (also importable by api-gateway as a library).
 * Exposes health + internal routes consumed via service-to-service calls.
 *
 * Routes:
 *   GET  /health
 *   POST /loc/generate           — generate Letter of Credit
 *   POST /plaid/link-token        — create Plaid Link token
 *   POST /plaid/exchange          — exchange public token
 *   GET  /balance/:studentId      — masked balance for a student
 *   POST /webhooks/plaid          — Plaid Item webhook
 */

import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import Redis from 'ioredis';
import { SolvencyService, getMaskedBalance, handleItemError } from './plaid.service';
import { getPool, checkDatabaseHealth, closePool } from '@vecta/database';
import { createLogger } from '@vecta/logger';
import { verifyInternalRequest } from '@vecta/auth';

const logger = createLogger('banking-service');
const app    = express();

const pool            = getPool();
const redis           = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const solvencyService = new SolvencyService(pool, redis);

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

// ---------------------------------------------------------------------------
// Internal auth (service-to-service HMAC)
// ---------------------------------------------------------------------------
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
    service: 'banking-service',
    timestamp: new Date().toISOString(),
    db,
  });
});

// ---------------------------------------------------------------------------
// LoC generation
// ---------------------------------------------------------------------------
app.post('/loc/generate', internalAuth, async (req: Request, res: Response) => {
  try {
    const body = z.object({
      studentId:       z.string().uuid(),
      monthlyRent:     z.number().positive().max(50_000),
      landlordName:    z.string().optional(),
      propertyAddress: z.string().optional(),
      studentFullName: z.string().min(1),
      universityName:  z.string().min(1),
    }).parse(req.body);

    const result = await solvencyService.generateLetterOfCredit({
      studentId:              body.studentId,
      monthlyRentEstimateUSD: body.monthlyRent,
      studentFullName:        body.studentFullName,
      universityName:         body.universityName,
      ...(body.landlordName !== undefined ? { landlordName: body.landlordName } : {}),
    });
    res.status(201).json(result);
  } catch (err) {
    logger.error({ err }, 'LoC generation failed');
    res.status(500).json({ error: 'LOC_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Plaid Link token
// ---------------------------------------------------------------------------
app.post('/plaid/link-token', internalAuth, async (req: Request, res: Response) => {
  try {
    const { studentId } = z.object({ studentId: z.string().uuid() }).parse(req.body);
    const result = await solvencyService.createLinkToken(studentId);
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Link token failed');
    res.status(500).json({ error: 'LINK_TOKEN_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Plaid token exchange
// ---------------------------------------------------------------------------
app.post('/plaid/exchange', internalAuth, async (req: Request, res: Response) => {
  try {
    const { studentId, publicToken } = z.object({
      studentId:   z.string().uuid(),
      publicToken: z.string(),
    }).parse(req.body);

    await solvencyService.exchangePublicToken(studentId, publicToken);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Token exchange failed');
    res.status(500).json({ error: 'EXCHANGE_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Masked balance
// ---------------------------------------------------------------------------
app.get('/balance/:studentId', internalAuth, async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params;
    if (!studentId) {
      res.status(400).json({ error: 'MISSING_STUDENT_ID' });
      return;
    }
    const balance = await getMaskedBalance(studentId);
    res.json(balance);
  } catch (err) {
    logger.error({ err }, 'Balance fetch failed');
    res.status(500).json({ error: 'BALANCE_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Plaid webhook (public — HMAC verified)
// ---------------------------------------------------------------------------
app.post('/webhooks/plaid', async (req: Request, res: Response) => {
  const sig    = req.headers['plaid-verification'] as string;
  const secret = process.env.PLAID_WEBHOOK_SECRET ?? '';

  if (!sig || !hmacVerify(JSON.stringify(req.body), sig, secret)) {
    res.status(401).json({ error: 'INVALID_SIGNATURE' }); return;
  }

  const { webhook_type, webhook_code, item_id } = req.body as {
    webhook_type: string; webhook_code: string; item_id: string;
  };

  logger.info({ webhook_type, webhook_code, item_id }, 'Plaid webhook received');

  if (webhook_type === 'ITEM' && webhook_code === 'ERROR') {
    await handleItemError(item_id);
  }

  res.json({ received: true });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT ?? '3002', 10);
const server = app.listen(PORT, () => logger.info({ port: PORT }, 'Banking service started'));

process.on('SIGTERM', () => server.close(async () => { await closePool(); await redis.quit(); process.exit(0); }));
process.on('SIGINT',  () => server.close(async () => { await closePool(); await redis.quit(); process.exit(0); }));

export default app;
