/**
 * apps/api-gateway/src/routes/compliance.router.ts
 *
 * Compliance Operations API:
 *
 *   GET  /api/v1/compliance/cases            — list open cases (compliance team)
 *   POST /api/v1/compliance/cases/:id/resolve — officer resolves a case
 *   POST /api/v1/compliance/cases/:id/assign  — assign case to officer
 *   GET  /api/v1/compliance/stats            — KYC funnel + AML stats (admin)
 *
 * Landlord credibility:
 *   GET  /api/v1/landlord/social-proof       — acceptance stats for portal
 *   GET  /api/v1/landlord/comparable/:zip    — comparable placements in zip
 *   POST /api/v1/landlord/onboard            — join landlord network
 *   POST /api/v1/landlord/acceptance         — record tenant acceptance
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createLogger } from '@vecta/logger';
import { query, queryOne } from '@vecta/database';
import {
  getOpenCases,
  resolveCase,
  evaluatePolicies,
  type CaseType,
  type CasePriority,
} from '../../../../services/compliance-service/src/compliance-ops.service';
import {
  getSocialProofStats,
  getComparableReport,
  onboardLandlord,
  recordAcceptance,
} from '../../../../services/compliance-service/src/landlord-credibility.service';

const logger = createLogger('compliance-router');
const router = Router();

// Internal auth for compliance routes (officer-only)
const OFFICER_KEY = process.env.COMPLIANCE_OFFICER_KEY ?? '';
function officerAuth(req: Request, res: Response, next: () => void) {
  if (req.headers['x-officer-key'] !== OFFICER_KEY || !OFFICER_KEY) {
    res.status(401).json({ error: 'OFFICER_AUTH_REQUIRED' }); return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Compliance case management (officer-facing)
// ---------------------------------------------------------------------------

router.get('/compliance/cases', officerAuth, async (req: Request, res: Response) => {
  try {
    const params = z.object({
      priority:   z.string().optional(),
      type:       z.string().optional(),
      assignedTo: z.string().optional(),
      limit:      z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query);

    const cases = await getOpenCases({
      priority:   params.priority   as CasePriority | undefined,
      type:       params.type       as CaseType | undefined,
      assignedTo: params.assignedTo,
      limit:      params.limit,
    });

    res.json({ cases, count: cases.length });
  } catch (err) {
    logger.error({ err }, 'Cases fetch failed');
    res.status(500).json({ error: 'CASES_FETCH_FAILED' });
  }
});

router.post('/compliance/cases/:id/resolve', officerAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { decision, rationale, officerEmail } = z.object({
      decision:     z.enum(['RESOLVED_PASS', 'RESOLVED_FAIL', 'ESCALATED']),
      rationale:    z.string().min(10).max(2000),
      officerEmail: z.string().email(),
    }).parse(req.body);

    await resolveCase({ caseId: id, officerEmail, decision, rationale });
    res.json({ resolved: true });
  } catch (err) {
    logger.error({ err }, 'Case resolve failed');
    res.status(500).json({ error: 'RESOLVE_FAILED' });
  }
});

router.post('/compliance/cases/:id/assign', officerAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { officerEmail } = z.object({ officerEmail: z.string().email() }).parse(req.body);

    await query(
      `UPDATE compliance_cases
       SET assigned_to = $2, status = 'IN_REVIEW', updated_at = NOW()
       WHERE id = $1 AND status = 'OPEN'`,
      [id, officerEmail],
    );
    res.json({ assigned: true });
  } catch (err) {
    logger.error({ err }, 'Case assignment failed');
    res.status(500).json({ error: 'ASSIGN_FAILED' });
  }
});

router.get('/compliance/stats', officerAuth, async (req: Request, res: Response) => {
  try {
    const [caseStats, kycFunnel] = await Promise.all([
      // Case queue stats
      query<{ status: string; priority: string; count: string }>(
        `SELECT status, priority, COUNT(*)::text AS count
         FROM compliance_cases
         WHERE created_at > NOW() - INTERVAL '30 days'
         GROUP BY status, priority`,
      ),
      // KYC funnel
      queryOne<{
        pending: string; approved: string; rejected: string; review: string;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE kyc_status = 'PENDING')::text       AS pending,
           COUNT(*) FILTER (WHERE kyc_status = 'APPROVED')::text      AS approved,
           COUNT(*) FILTER (WHERE kyc_status = 'REJECTED')::text      AS rejected,
           COUNT(*) FILTER (WHERE kyc_status = 'NEEDS_REVIEW')::text  AS review
         FROM students`,
      ),
    ]);

    res.json({
      caseQueue: caseStats.rows,
      kycFunnel: {
        pending:  parseInt(kycFunnel?.pending  ?? '0', 10),
        approved: parseInt(kycFunnel?.approved ?? '0', 10),
        rejected: parseInt(kycFunnel?.rejected ?? '0', 10),
        review:   parseInt(kycFunnel?.review   ?? '0', 10),
      },
    });
  } catch (err) {
    logger.error({ err }, 'Stats fetch failed');
    res.status(500).json({ error: 'STATS_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Landlord credibility (public-ish — no auth needed for social proof)
// ---------------------------------------------------------------------------

router.get('/landlord/social-proof', async (req: Request, res: Response) => {
  try {
    const { city, state } = z.object({
      city:  z.string().optional(),
      state: z.string().length(2).toUpperCase().optional(),
    }).parse(req.query);

    const stats = await getSocialProofStats(city, state);
    res.json(stats);
  } catch (err) {
    logger.error({ err }, 'Social proof fetch failed');
    res.status(500).json({ error: 'SOCIAL_PROOF_FAILED' });
  }
});

router.get('/landlord/comparable/:zip', async (req: Request, res: Response) => {
  try {
    const zip  = req.params.zip;
    const tier = (req.query.tier as string) ?? 'STANDARD';
    const report = await getComparableReport(zip, tier);
    res.json(report);
  } catch (err) {
    logger.error({ err }, 'Comparable report failed');
    res.status(500).json({ error: 'COMPARABLE_FAILED' });
  }
});

router.post('/landlord/onboard', async (req: Request, res: Response) => {
  try {
    const body = z.object({
      landlordProfileId: z.string().uuid(),
      propertyCount:     z.number().int().min(1).max(10_000),
      cities:            z.array(z.string().max(100)).max(50),
      referralCode:      z.string().optional(),
    }).parse(req.body);

    const result = await onboardLandlord(body);
    res.status(201).json(result);
  } catch (err) {
    logger.error({ err }, 'Landlord onboard failed');
    res.status(500).json({ error: 'ONBOARD_FAILED' });
  }
});

router.post('/landlord/acceptance', async (req: Request, res: Response) => {
  try {
    const body = z.object({
      landlordId:    z.string().uuid(),
      studentId:     z.string().uuid(),
      certId:        z.string(),
      city:          z.string().min(2).max(100),
      state:         z.string().length(2).toUpperCase(),
      universityName: z.string().max(200),
    }).parse(req.body);

    await recordAcceptance(body);

    // Sync to certificate router's lease_applications if not already recorded
    await query(
      `UPDATE lease_applications
       SET status = 'SIGNED', updated_at = NOW()
       WHERE cert_id = $1 AND status = 'PENDING_SIGNATURE'`,
      [body.certId],
    );

    res.json({ recorded: true });
  } catch (err) {
    logger.error({ err }, 'Acceptance record failed');
    res.status(500).json({ error: 'RECORD_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Provider health (for ops dashboard)
// ---------------------------------------------------------------------------

router.get('/compliance/provider-health', officerAuth, async (req: Request, res: Response) => {
  try {
    const { checkAllProviderHealth } = await import('../../../../packages/providers/src/registry');
    const health = await checkAllProviderHealth();
    res.json({ providers: health, checkedAt: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, 'Provider health check failed');
    res.status(500).json({ error: 'HEALTH_CHECK_FAILED' });
  }
});

export { router as complianceRouter };
