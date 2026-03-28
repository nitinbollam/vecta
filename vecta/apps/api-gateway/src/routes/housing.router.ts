/**
 * housing.router.ts — Housing routes for API Gateway
 *
 * ── Vecta Connect (replaces Plaid) ──────────────────────────────────────────
 * POST /api/v1/housing/connect/link-url      — Get Open Banking link URL
 * POST /api/v1/housing/connect/callback      — Handle OAuth callback
 * GET  /api/v1/housing/connect/asset-report  — Generate asset report
 *
 * ── Vecta Credit Bridge (replaces Nova Credit) ──────────────────────────────
 * GET  /api/v1/housing/credit-score          — Vecta credit bridge score
 *
 * ── Legacy routes (still supported) ────────────────────────────────────────
 * POST /api/v1/housing/plaid/link-token      — Create Plaid Link token (fallback)
 * POST /api/v1/housing/plaid/exchange        — Exchange public token (fallback)
 * POST /api/v1/housing/loc/generate          — Generate Letter of Credit PDF
 * GET  /api/v1/housing/loc/:locId/download   — Signed download URL (student)
 * GET  /api/v1/housing/trust-score           — Trust score (now via Vecta Bridge)
 * POST /api/v1/housing/roommate/profile      — Upsert lifestyle profile (embedding)
 * GET  /api/v1/housing/roommate/matches      — Get AI roommate matches
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { SolvencyService } from '../../../../services/banking-service/src/plaid.service';
import { novaCreditService } from '../../../../services/housing-service/src/connectivity-nova.service';
import { authMiddleware, requireKYC } from '@vecta/auth';
import { createLogger } from '@vecta/logger';
import { getPool, query, queryOne } from '@vecta/database';
import { getSignedDownloadUrl } from '@vecta/storage';
import Redis from 'ioredis';
import { stripFreeText } from '../lib/sanitize';

const logger = createLogger('housing-router');
const router = Router();
const solvencyService = new SolvencyService(
  getPool(),
  new Redis(process.env.REDIS_URL ?? 'redis://:redis_secret@localhost:6379'),
);

// All housing routes require authentication and KYC
router.use(authMiddleware);
router.use(requireKYC('APPROVED'));

// ---------------------------------------------------------------------------
// Vecta Connect: GET link URL (routes to best Open Banking connector)
// POST /api/v1/housing/connect/link-url
// ---------------------------------------------------------------------------

router.post('/connect/link-url', async (req: Request, res: Response) => {
  try {
    const studentId  = (req as Request & { vectaUser: { sub: string } }).vectaUser?.sub ?? (req as unknown as { user: { id: string } }).user?.id;
    const { bankId, redirectUri } = z
      .object({
        bankId:      z.string().min(2),
        redirectUri: z.string().url(),
      })
      .parse(req.body);

    const { VectaConnect } = await import('../../../../services/banking-service/src/vecta-connect.service');
    const connect = new VectaConnect();
    const result  = await connect.getLinkUrl(studentId, bankId, redirectUri);

    res.json({
      linkUrl:       result.linkUrl,
      connectorType: result.connectorType,
      state:         result.state,
      provider:      'vecta-connect',
    });
  } catch (err) {
    logger.error({ err }, '[Connect] Failed to get link URL');
    res.status(500).json({ error: 'CONNECT_LINK_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Vecta Connect: handle OAuth callback
// POST /api/v1/housing/connect/callback
// ---------------------------------------------------------------------------

router.post('/connect/callback', async (req: Request, res: Response) => {
  try {
    const studentId = (req as Request & { vectaUser: { sub: string } }).vectaUser?.sub ?? (req as unknown as { user: { id: string } }).user?.id;
    const { code, state, connectorType } = z
      .object({
        code:          z.string(),
        state:         z.string(),
        connectorType: z.string(),
      })
      .parse(req.body);

    const { VectaConnect } = await import('../../../../services/banking-service/src/vecta-connect.service');
    const connect    = new VectaConnect();
    const connection = await connect.handleCallback(studentId, code, state, connectorType as never);

    res.status(201).json({
      connectionId:  connection.connectionId,
      bankName:      connection.bankName,
      connectorType: connection.connectorType,
      status:        connection.status,
      provider:      'vecta-connect',
    });
  } catch (err) {
    logger.error({ err }, '[Connect] Callback failed');
    res.status(500).json({ error: 'CONNECT_CALLBACK_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Vecta Connect: generate asset report
// GET /api/v1/housing/connect/asset-report
// ---------------------------------------------------------------------------

router.get('/connect/asset-report', async (req: Request, res: Response) => {
  try {
    const studentId    = (req as Request & { vectaUser: { sub: string } }).vectaUser?.sub ?? (req as unknown as { user: { id: string } }).user?.id;
    const connectionId = String(req.query.connectionId ?? '');
    if (!connectionId) return res.status(400).json({ error: 'connectionId required' });

    const { VectaConnect } = await import('../../../../services/banking-service/src/vecta-connect.service');
    const connect = new VectaConnect();
    const report  = await connect.generateAssetReport(connectionId);

    res.json({
      ...report,
      provider: 'vecta-connect',
    });
  } catch (err) {
    logger.error({ err }, '[Connect] Asset report failed');
    res.status(500).json({ error: 'ASSET_REPORT_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Vecta Credit Bridge: credit score
// GET /api/v1/housing/credit-score
// Replaces Nova Credit's trust-score endpoint
// ---------------------------------------------------------------------------

router.get('/credit-score', async (req: Request, res: Response) => {
  try {
    const studentId = (req as Request & { vectaUser: { sub: string } }).vectaUser?.sub ?? (req as unknown as { user: { id: string } }).user?.id;

    const { VectaCreditBridge } = await import('../../../../services/housing-service/src/vecta-credit-bridge.service');
    const bridge = new VectaCreditBridge();
    const result = await bridge.getCreditScore(studentId);

    res.json({
      usEquivalentScore: result.usEquivalentScore,
      originalScore:     result.originalScore,
      originalRange:     result.originalRange,
      bureau:            result.bureau,
      scoreMethod:       result.scoreMethod,
      solvencyTier:      result.solvencyTier,
      factors:           result.factors,
      reportDate:        result.reportDate,
      f1SafeToShare:     result.f1SafeToShare,
      provider:          'vecta-bridge',
    });
  } catch (err) {
    logger.error({ err }, '[CreditBridge] Credit score fetch failed');
    res.status(500).json({ error: 'CREDIT_SCORE_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Legacy: Plaid Link Token (kept as fallback)
// ---------------------------------------------------------------------------

router.post('/plaid/link-token', async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;
    const result = await solvencyService.createLinkToken(studentId);
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Failed to create Plaid link token');
    res.status(500).json({ error: 'PLAID_LINK_TOKEN_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Plaid public token exchange
// ---------------------------------------------------------------------------

router.post('/plaid/exchange', async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;
    const { publicToken } = z
      .object({ publicToken: z.string() })
      .parse(req.body);

    await solvencyService.exchangePublicToken(studentId, publicToken);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Failed to exchange Plaid token');
    res.status(500).json({ error: 'PLAID_EXCHANGE_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Generate Letter of Credit
// ---------------------------------------------------------------------------

router.post('/loc/generate', async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;

    const { monthlyRent, landlordName, propertyAddress } = z
      .object({
        monthlyRent:     z.number().positive().max(50_000),
        landlordName:    z.string().trim().max(200).transform((v) => stripFreeText(v)).optional(),
        propertyAddress: z.string().trim().max(500).transform((v) => stripFreeText(v)).optional(),
      })
      .parse(req.body);

    const student = await queryOne<{ full_name: string; university_name: string | null }>(
      'SELECT full_name, university_name FROM students WHERE id = $1',
      [studentId],
    );
    if (!student) {
      res.status(404).json({ error: 'STUDENT_NOT_FOUND' });
      return;
    }

    const result = await solvencyService.generateLetterOfCredit({
      studentId,
      monthlyRentEstimateUSD: monthlyRent,
      studentFullName: student.full_name,
      universityName: student.university_name ?? 'Unknown University',
      landlordName,
    });

    res.status(201).json(result);
  } catch (err) {
    logger.error({ err }, 'LoC generation failed');
    if (err instanceof Error && err.message.includes('PLAID_NOT_CONNECTED')) {
      res.status(422).json({
        error: 'BANK_NOT_CONNECTED',
        message: 'Please connect your bank account via Plaid before generating a Letter of Credit.',
        action: 'CONNECT_BANK',
      });
      return;
    }
    res.status(500).json({ error: 'LOC_GENERATION_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Signed LoC download URL (student + landlord)
// ---------------------------------------------------------------------------

router.get('/loc/:locId/download', async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;
    const { locId } = req.params;

    const loc = await queryOne<{ s3_key: string; student_id: string }>(
      'SELECT s3_key, student_id FROM letters_of_credit WHERE id = $1',
      [locId],
    );

    if (!loc) {
      res.status(404).json({ error: 'LOC_NOT_FOUND' });
      return;
    }

    // Students can only access their own LoCs
    if (loc.student_id !== studentId && req.vectaUser!.role !== 'LANDLORD') {
      res.status(403).json({ error: 'FORBIDDEN' });
      return;
    }

    const signedUrl = await getSignedDownloadUrl('housing', loc.s3_key, 3600);
    res.json({ url: signedUrl, expiresIn: 3600 });
  } catch (err) {
    logger.error({ err }, 'LoC download URL failed');
    res.status(500).json({ error: 'DOWNLOAD_URL_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Nova Credit trust score
// ---------------------------------------------------------------------------

router.get('/trust-score', async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;

    const row = await queryOne<{
      trust_score: number;
      trust_tier: string;
      nova_credit_reference_id: string;
      created_at: string;
    }>(
      `SELECT trust_score, trust_tier, nova_credit_reference_id, created_at
       FROM students
       WHERE id = $1`,
      [studentId],
    );

    if (!row) {
      res.status(404).json({ error: 'STUDENT_NOT_FOUND' });
      return;
    }

    if (!row.trust_score) {
      // Trigger Nova Credit pull if not yet fetched
      await novaCreditService.fetchInternationalCreditHistory(studentId);
      const refreshed = await queryOne<{
        trust_score: number;
        trust_tier: string;
      }>(
        `SELECT trust_score, trust_tier
         FROM students
         WHERE id = $1`,
        [studentId],
      );
      if (!refreshed?.trust_score) {
        res.status(502).json({ error: 'NOVA_FETCH_INCOMPLETE' });
        return;
      }
      res.json({
        score: refreshed.trust_score,
        tier: refreshed.trust_tier,
        source: 'INTL',
        freshlyFetched: true,
      });
      return;
    }

    res.json({
      score: row.trust_score,
      tier: row.trust_tier,
      cachedAt: row.created_at,
      freshlyFetched: false,
    });
  } catch (err) {
    logger.error({ err }, 'Trust score fetch failed');
    res.status(500).json({ error: 'TRUST_SCORE_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Roommate profile upsert (triggers embedding generation via compliance-ai)
// ---------------------------------------------------------------------------

router.post('/roommate/profile', async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;

    const profile = z
      .object({
        sleepSchedule:  z.enum(['early_bird', 'night_owl', 'flexible']),
        cleanliness:    z.enum(['very_clean', 'clean', 'relaxed', 'messy']),
        guestPolicy:    z.enum(['no_guests', 'occasional', 'frequent']),
        noiseLevel:     z.enum(['very_quiet', 'moderate', 'social']),
        studyHabits:    z.enum(['library', 'home_quiet', 'home_music', 'cafe']),
        dietaryNeeds:   z.array(z.string().trim().max(120).transform((v) => stripFreeText(v))).max(10),
        languages:      z.array(z.string().trim().max(40).transform((v) => stripFreeText(v))).max(10),
        majorCategory:  z.string().trim().max(50).transform((v) => stripFreeText(v)),
        interests:      z.array(z.string().trim().max(80).transform((v) => stripFreeText(v))).max(20),
        budgetMin:      z.number().positive(),
        budgetMax:      z.number().positive(),
        moveInDate:     z.string().trim().max(32),
        universityId:   z.string().uuid().optional(),
      })
      .parse(req.body);

    // Forward to compliance-ai for embedding generation
    const aiResponse = await fetch(
      `${process.env.COMPLIANCE_AI_URL ?? 'http://compliance-ai:8000'}/housing/roommate-profile`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, profile }),
      },
    );

    if (!aiResponse.ok) {
      throw new Error(`Compliance AI returned ${aiResponse.status}`);
    }

    res.status(201).json({ success: true, message: 'Roommate profile updated.' });
  } catch (err) {
    logger.error({ err }, 'Roommate profile update failed');
    res.status(500).json({ error: 'PROFILE_UPDATE_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// AI roommate matches
// ---------------------------------------------------------------------------

router.get('/roommate/matches', async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;

    const aiResponse = await fetch(
      `${process.env.COMPLIANCE_AI_URL ?? 'http://compliance-ai:8000'}/housing/roommate-matches/${studentId}`,
    );

    if (!aiResponse.ok) {
      throw new Error(`Compliance AI returned ${aiResponse.status}`);
    }

    const matches = await aiResponse.json();
    res.json(matches);
  } catch (err) {
    logger.error({ err }, 'Roommate match fetch failed');
    res.status(500).json({ error: 'MATCH_FETCH_FAILED' });
  }
});


// ---------------------------------------------------------------------------
// eSIM provisioning
// ---------------------------------------------------------------------------

router.post('/housing/esim/provision', async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;
    const { plan, imei } = z.object({
      plan: z.enum(['5g_unlimited', '5g_15gb', '4g_5gb']).default('5g_unlimited'),
      imei: z.string().length(15).optional(),
    }).parse(req.body);

    const res2 = await fetch(
      `${process.env.HOUSING_SERVICE_URL ?? 'http://housing-service:4003'}/esim/provision`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...internalAuthHeaders(req.body) },
        body: JSON.stringify({ studentId, plan }),
      }
    );

    if (!res2.ok) throw new Error(`Housing service: ${res2.status}`);
    const data = await res2.json();
    res.status(201).json(data);
  } catch (err) {
    logger.error({ err }, 'eSIM provision failed');
    res.status(500).json({ error: 'ESIM_PROVISION_FAILED' });
  }
});

function internalAuthHeaders(_body: unknown): Record<string, string> {
  const ts  = String(Date.now());
  const { hmacSign } = require('@vecta/crypto');
  const sig = hmacSign(`${ts}:${JSON.stringify(_body)}`, process.env.INTERNAL_SERVICE_SECRET ?? '');
  return { 'x-internal-signature': sig, 'x-timestamp': ts };
}

export { router as housingRouter };
