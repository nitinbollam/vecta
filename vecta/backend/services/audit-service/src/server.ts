/**
 * audit-service/src/server.ts — Vecta Compliance Audit Service
 *
 * Responsibilities:
 *   - Ingest AuditEvent messages from all other services (via direct HTTP)
 *   - Persist to append-only audit_events table (no UPDATE/DELETE)
 *   - Maintain a SHA-256 Merkle-style hash chain across all events
 *   - Expose read-only query API for compliance exports (USCIS/IRS/DSO)
 *   - Stream real-time events to an admin dashboard via SSE
 *
 * Endpoints:
 *   POST /events           — Ingest a new audit event (internal only)
 *   GET  /events           — Query events (student, type, date range)
 *   GET  /events/chain     — Full hash-chain export for a student
 *   GET  /health
 *   GET  /stream           — SSE stream (admin only)
 */

import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { createLogger } from '@vecta/logger';
import { query, queryOne, withTransaction, checkDatabaseHealth } from '@vecta/database';
import { verifyInternalRequest } from '@vecta/auth';
import { hmacSign } from '@vecta/crypto';

const logger = createLogger('audit-service');
const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '512kb' }));

// ---------------------------------------------------------------------------
// Internal auth — only services on the vecta-network can call this
// ---------------------------------------------------------------------------
function requireInternalAuth(req: Request, res: Response, next: NextFunction): void {
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
// Zod schemas
// ---------------------------------------------------------------------------

const AuditEventSchema = z.object({
  eventType:   z.string().min(1).max(100),
  actorId:     z.string().uuid(),
  actorRole:   z.string().max(50),
  resourceId:  z.string().max(255),
  resourceType: z.string().max(100),
  service:     z.string().max(100),
  metadata:    z.record(z.unknown()).optional(),
  ipAddress:   z.string().optional(),
  correlationId: z.string().optional(),
});

type AuditEventInput = z.infer<typeof AuditEventSchema>;

// ---------------------------------------------------------------------------
// Hash-chain helpers
// ---------------------------------------------------------------------------

async function computeEventHash(
  event: AuditEventInput,
  timestamp: string,
  previousHash: string,
): Promise<string> {
  const canonical = JSON.stringify({
    eventType:    event.eventType,
    actorId:      event.actorId,
    resourceId:   event.resourceId,
    timestamp,
    previousHash,
    metadata:     event.metadata ?? {},
  });
  return hmacSign(canonical, process.env.VECTA_HMAC_SECRET ?? '');
}

async function getPreviousHash(actorId: string): Promise<string> {
  const row = await queryOne<{ hash: string }>(
    `SELECT hash
     FROM audit_events
     WHERE actor_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [actorId],
  );
  // Genesis hash — first event in actor's chain
  return row?.hash ?? crypto.createHash('sha256').update(`vecta:genesis:${actorId}`).digest('hex');
}

// ---------------------------------------------------------------------------
// POST /events — ingest
// ---------------------------------------------------------------------------

app.post('/events', requireInternalAuth, async (req: Request, res: Response) => {
  try {
    const event = AuditEventSchema.parse(req.body);
    const now = new Date().toISOString();

    await withTransaction(async (client) => {
      const previousHash = await getPreviousHash(event.actorId);
      const hash = await computeEventHash(event, now, previousHash);

      await client.query(
        `INSERT INTO audit_events
           (event_type, actor_id, actor_role, resource_id, resource_type,
            service, metadata, ip_address, correlation_id, previous_hash, hash, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          event.eventType,
          event.actorId,
          event.actorRole,
          event.resourceId,
          event.resourceType,
          event.service,
          JSON.stringify(event.metadata ?? {}),
          event.ipAddress ?? null,
          event.correlationId ?? null,
          previousHash,
          hash,
          now,
        ],
      );
    });

    res.status(201).json({ recorded: true });
  } catch (err) {
    logger.error({ err }, 'Failed to record audit event');
    res.status(500).json({ error: 'AUDIT_RECORD_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// GET /events — query
// ---------------------------------------------------------------------------

const QuerySchema = z.object({
  actorId:      z.string().uuid().optional(),
  resourceId:   z.string().optional(),
  eventType:    z.string().optional(),
  service:      z.string().optional(),
  from:         z.string().datetime().optional(),
  to:           z.string().datetime().optional(),
  limit:        z.coerce.number().int().min(1).max(500).default(100),
  offset:       z.coerce.number().int().min(0).default(0),
});

app.get('/events', requireInternalAuth, async (req: Request, res: Response) => {
  try {
    const params = QuerySchema.parse(req.query);

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (params.actorId)   { conditions.push(`actor_id = $${idx++}`);   values.push(params.actorId); }
    if (params.resourceId){ conditions.push(`resource_id = $${idx++}`); values.push(params.resourceId); }
    if (params.eventType) { conditions.push(`event_type = $${idx++}`);  values.push(params.eventType); }
    if (params.service)   { conditions.push(`service = $${idx++}`);     values.push(params.service); }
    if (params.from)      { conditions.push(`created_at >= $${idx++}`); values.push(params.from); }
    if (params.to)        { conditions.push(`created_at <= $${idx++}`); values.push(params.to); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(params.limit, params.offset);

    const result = await query<{
      id: string;
      event_type: string;
      actor_id: string;
      actor_role: string;
      resource_id: string;
      resource_type: string;
      service: string;
      metadata: unknown;
      hash: string;
      previous_hash: string;
      created_at: string;
    }>(
      `SELECT id, event_type, actor_id, actor_role, resource_id, resource_type,
              service, metadata, hash, previous_hash, created_at
       FROM audit_events
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      values,
    );

    res.json({
      events: result.rows,
      count:  result.rowCount,
      limit:  params.limit,
      offset: params.offset,
    });
  } catch (err) {
    logger.error({ err }, 'Audit query failed');
    res.status(500).json({ error: 'QUERY_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// GET /events/chain — Merkle-style chain export + integrity verification
// ---------------------------------------------------------------------------

app.get('/events/chain', requireInternalAuth, async (req: Request, res: Response) => {
  try {
    const { actorId } = z.object({ actorId: z.string().uuid() }).parse(req.query);

    const result = await query<{
      id: string;
      event_type: string;
      resource_id: string;
      service: string;
      hash: string;
      previous_hash: string;
      created_at: string;
    }>(
      `SELECT id, event_type, resource_id, service, hash, previous_hash, created_at
       FROM audit_events
       WHERE actor_id = $1
       ORDER BY created_at ASC, id ASC`,
      [actorId],
    );

    const events = result.rows;

    // Verify chain integrity
    let chainValid = true;
    let brokenAt: string | null = null;

    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1]!;
      const curr = events[i]!;
      if (curr.previous_hash !== prev.hash) {
        chainValid = false;
        brokenAt = curr.id;
        break;
      }
    }

    res.json({
      actorId,
      chainValid,
      brokenAt,
      eventCount: events.length,
      genesisHash: events[0]?.previous_hash ?? null,
      latestHash:  events[events.length - 1]?.hash ?? null,
      exportedAt:  new Date().toISOString(),
      events,
    });
  } catch (err) {
    logger.error({ err }, 'Chain export failed');
    res.status(500).json({ error: 'CHAIN_EXPORT_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// SSE — real-time event stream (admin dashboard)
// ---------------------------------------------------------------------------

const sseClients = new Set<Response>();

app.get('/stream', (req: Request, res: Response) => {
  // Basic admin secret check for SSE
  if (req.headers['x-admin-key'] !== process.env.ADMIN_STREAM_KEY) {
    res.status(401).end();
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);
  logger.debug({ clients: sseClients.size }, 'SSE client connected');

  req.on('close', () => {
    sseClients.delete(res);
    logger.debug({ clients: sseClients.size }, 'SSE client disconnected');
  });
});

export function broadcastAuditEvent(event: Record<string, unknown>): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get('/health', async (_req, res) => {
  const db = await checkDatabaseHealth();
  res.status(db.ok ? 200 : 503).json({
    status: db.ok ? 'ok' : 'degraded',
    service: 'audit-service',
    timestamp: new Date().toISOString(),
    db,
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? '3006', 10);

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Audit service started');
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT',  () => server.close(() => process.exit(0)));

export default app;
