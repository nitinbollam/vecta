/**
 * services/housing-service/src/server.ts
 *
 * Housing microservice.
 *
 * Routes:
 *   GET  /health
 *   GET  /trust-score/:studentId          — Nova Credit translated score
 *   POST /esim/provision                  — eSIM Go provisioning
 *   GET  /esim/status/:studentId          — eSIM status
 *   POST /loc/pdf                         — Generate LoC PDF buffer
 */

import express, { Request, Response } from 'express';
import { z } from 'zod';
import { novaCreditService, connectivityService } from './connectivity-nova.service';
import { generateLocPDF } from './loc-pdf.generator';
import { uploadLocPdf } from '@vecta/storage';
import { checkDatabaseHealth, closePool, queryOne } from '@vecta/database';
import { createLogger } from '@vecta/logger';
import { hmacVerify } from '@vecta/crypto';

const logger = createLogger('housing-service');
const app    = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? '';

function internalAuth(req: Request, res: Response, next: () => void) {
  const sig = req.headers['x-internal-signature'] as string;
  const ts  = req.headers['x-timestamp'] as string;
  if (!sig || !ts) { res.status(401).json({ error: 'MISSING_AUTH' }); return; }
  if (Math.abs(Date.now() - parseInt(ts, 10)) > 30_000) { res.status(401).json({ error: 'TIMESTAMP_EXPIRED' }); return; }
  if (!hmacVerify(`${ts}:${JSON.stringify(req.body)}`, sig, INTERNAL_SECRET)) {
    res.status(401).json({ error: 'INVALID_SIGNATURE' }); return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get('/health', async (_req, res) => {
  const db = await checkDatabaseHealth();
  res.status(db.ok ? 200 : 503).json({ status: db.ok ? 'ok' : 'degraded', service: 'housing-service', db });
});

// ---------------------------------------------------------------------------
// Nova Credit — trust score
// ---------------------------------------------------------------------------
app.get('/trust-score/:studentId', internalAuth, async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params;
    if (!studentId) {
      res.status(400).json({ error: 'MISSING_STUDENT_ID' });
      return;
    }
    const monthlyRent    = parseFloat(req.query.monthlyRent as string ?? '1500');
    const leaseDuration  = parseInt(req.query.leaseDuration as string ?? '12', 10);

    // Fetch Nova Credit score (cache or live)
    const cached = await queryOne<{ trust_score: number; trust_tier: string }>(
      'SELECT trust_score, trust_tier FROM students WHERE id = $1',
      [studentId],
    );

    if (!cached?.trust_score) {
      await novaCreditService.fetchInternationalCreditHistory(studentId);
    }

    // Compute composite score via trust engine
    const { computeTrustScoreForStudent } = await import('./trust-engine');
    const composite = await computeTrustScoreForStudent(studentId, monthlyRent, leaseDuration);

    res.json({
      // Raw Nova score
      novaScore:   cached?.trust_score ?? 580,
      novaTier:    cached?.trust_tier ?? 'Building',
      // Composite
      compositeScore:    composite.compositeScore,
      guaranteeTier:     composite.guaranteeTier,
      maxRentApproval:   composite.maxRentApproval,
      depositMultiplier: composite.depositMultiplier,
      guaranteeMonths:   composite.guaranteeMonths,
      breakdown:         composite.breakdown,
      cached: !!cached?.trust_score,
    });
  } catch (err) {
    logger.error({ err }, 'Trust score failed');
    res.status(500).json({ error: 'TRUST_SCORE_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// eSIM provisioning
// ---------------------------------------------------------------------------
app.post('/esim/provision', internalAuth, async (req: Request, res: Response) => {
  try {
    const body = z.object({
      studentId: z.string().uuid(),
      imei:      z.string().length(15),
      plan:      z.enum(['5g_unlimited', '5g_15gb', '4g_5gb']).default('5g_unlimited'),
    }).parse(req.body);

    const planMap: Record<string, '5G_UNLIMITED' | '5G_10GB' | 'LTE_5GB'> = {
      '5g_unlimited': '5G_UNLIMITED',
      '5g_15gb':      '5G_10GB',
      '4g_5gb':       'LTE_5GB',
    };

    const planPreference = planMap[body.plan];
    if (!planPreference) {
      res.status(400).json({ error: 'INVALID_PLAN' });
      return;
    }

    const result = await connectivityService.provisionESIM({
      studentId: body.studentId,
      imei:        body.imei,
      planPreference,
    });
    res.status(201).json(result);
  } catch (err) {
    logger.error({ err }, 'eSIM provisioning failed');
    res.status(500).json({ error: 'ESIM_PROVISION_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// LoC PDF generation (buffer → S3 upload)
// ---------------------------------------------------------------------------
app.post('/loc/pdf', internalAuth, async (req: Request, res: Response) => {
  try {
    const input = z.object({
      studentId:        z.string().uuid(),
      locId:            z.string(),
      studentName:      z.string(),
      universityName:   z.string(),
      programOfStudy:   z.string(),
      visaStatus:       z.string(),
      visaValidThrough: z.string(),
      guaranteeMonths:  z.number().int().positive().default(12),
      monthlyRent:      z.number().positive(),
      currency:         z.string().default('USD'),
      novaCreditTier:   z.string(),
      trustScore:       z.number(),
      landlordName:     z.string().optional(),
      propertyAddress:  z.string().optional(),
    }).parse(req.body);

    const now       = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const pdfBuffer = await generateLocPDF({
      locId:            input.locId,
      studentName:      input.studentName,
      universityName:   input.universityName,
      programOfStudy:   input.programOfStudy,
      visaStatus:       input.visaStatus,
      visaValidThrough: input.visaValidThrough,
      guaranteeMonths:  input.guaranteeMonths,
      monthlyRent:      input.monthlyRent,
      currency:         input.currency,
      novaCreditTier:   input.novaCreditTier,
      trustScore:       input.trustScore,
      generatedAt:      now,
      expiresAt,
      verificationBaseUrl: process.env.VERIFICATION_BASE_URL ?? 'https://verify.vecta.io',
      ...(input.landlordName !== undefined ? { landlordName: input.landlordName } : {}),
      ...(input.propertyAddress !== undefined ? { propertyAddress: input.propertyAddress } : {}),
    });

    const { key, signedUrl } = await uploadLocPdf(input.studentId, input.locId, pdfBuffer);

    res.status(201).json({ s3Key: key, signedUrl, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    logger.error({ err }, 'LoC PDF generation failed');
    res.status(500).json({ error: 'LOC_PDF_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT ?? '4003', 10);
const server = app.listen(PORT, () => logger.info({ port: PORT }, 'Housing service started'));

process.on('SIGTERM', () => server.close(async () => { await closePool(); process.exit(0); }));
process.on('SIGINT',  () => server.close(async () => { await closePool(); process.exit(0); }));

export default app;
