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
  recordReputationEvent,
  calculateReputationScore,
  type ReputationEventType,
} from '../../../services/compliance-service/src/reputation.service';
import {
  getOpenCases,
  resolveCase,
  type CaseType,
  type CasePriority,
} from '../../../services/compliance-service/src/compliance-ops.service';
import {
  getSocialProofStats,
  getComparableReport,
  onboardLandlord,
  recordAcceptance,
} from '../../../services/compliance-service/src/landlord-credibility.service';
import { stripFreeText } from '../lib/sanitize';
import { fileTicket, processRefund, flagAccount } from '../../../services/compliance-service/src/dispute.service';
import { PLATFORM_ACCOUNT_ID } from '../../../services/compliance-service/src/revenue.service';
import {
  createGenericDriverInvite,
  getDriverReferralOfferCents,
  setDriverReferralOfferCents,
} from '../../../services/compliance-service/src/referral.service';

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

router.get('/compliance/referral-offer', officerAuth, async (_req: Request, res: Response) => {
  try {
    const offer = await getDriverReferralOfferCents();
    res.json(offer);
  } catch (err) {
    logger.error({ err }, 'referral-offer get failed');
    res.status(500).json({ error: 'REFERRAL_OFFER_FETCH_FAILED' });
  }
});

router.patch('/compliance/referral-offer', officerAuth, async (req: Request, res: Response) => {
  try {
    const { referrerCents, refereeCents } = z
      .object({
        referrerCents: z.number().int().min(0).max(500_000),
        refereeCents: z.number().int().min(0).max(500_000),
      })
      .parse(req.body);
    await setDriverReferralOfferCents({ referrerCents, refereeCents });
    const offer = await getDriverReferralOfferCents();
    res.json({ ok: true, ...offer });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'INVALID_BODY', details: err.flatten() });
      return;
    }
    logger.error({ err }, 'referral-offer patch failed');
    res.status(500).json({ error: 'REFERRAL_OFFER_UPDATE_FAILED' });
  }
});

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
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { decision, rationale, officerEmail } = z.object({
      decision:     z.enum(['RESOLVED_PASS', 'RESOLVED_FAIL', 'ESCALATED']),
      rationale:    z.string().trim().min(10).max(1000).transform((v) => stripFreeText(v)),
      officerEmail: z.string().email().max(254).trim().toLowerCase(),
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
    const { officerEmail } = z.object({ officerEmail: z.string().email().max(254).trim().toLowerCase() }).parse(req.body);

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
    const { zip } = z.object({ zip: z.string().min(3).max(10) }).parse(req.params);
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
      cities:            z.array(z.string().trim().max(100).transform((v) => stripFreeText(v))).max(50),
      referralCode:      z.string().trim().max(64).transform((v) => stripFreeText(v)).optional(),
    }).parse(req.body);

    const result = await onboardLandlord(body as Parameters<typeof onboardLandlord>[0]);
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
      city:          z.string().trim().min(2).max(100).transform((v) => stripFreeText(v)),
      state:         z.string().length(2).toUpperCase(),
      universityName: z.string().trim().max(200).transform((v) => stripFreeText(v)),
    }).parse(req.body);

    await recordAcceptance(body as Parameters<typeof recordAcceptance>[0]);

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
    const { checkAllProviderHealth } = await import('../../../shared/providers/src/registry');
    const health = await checkAllProviderHealth();
    res.json({ providers: health, checkedAt: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, 'Provider health check failed');
    res.status(500).json({ error: 'HEALTH_CHECK_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Reputation (student + public landlord view)
// ---------------------------------------------------------------------------

router.post('/reputation/event', async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser?.sub;
    if (!studentId) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }

    const body = z.object({
      eventType:   z.string(),
      amountCents: z.number().int().optional(),
      landlordId:  z.string().uuid().optional(),
      metadata:    z.record(z.unknown()).optional(),
    }).parse(req.body);

    const eventType = body.eventType as ReputationEventType;
    const allowed: ReputationEventType[] = [
      'RENT_PAYMENT_ONTIME',
      'RENT_PAYMENT_LATE',
      'LEASE_COMPLETED',
      'IDENTITY_VERIFIED',
      'BANK_ACCOUNT_MAINTAINED',
      'INSURANCE_MAINTAINED',
      'VISA_RENEWED',
      'UNIVERSITY_ENROLLED',
      'ESIM_ACTIVE',
      'REFERRAL_PLACED',
    ];
    if (!allowed.includes(eventType)) {
      res.status(400).json({ error: 'INVALID_EVENT_TYPE' });
      return;
    }

    await recordReputationEvent({
      studentId,
      eventType,
      verifiedBy: 'VECTA',
      amountCents: body.amountCents,
      landlordId: body.landlordId,
      metadata: body.metadata,
    });

    const score = await calculateReputationScore(studentId);
    res.json({ success: true, score });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'INVALID_PAYLOAD', details: err.flatten() });
      return;
    }
    logger.error({ err }, 'Reputation event failed');
    res.status(500).json({ error: 'REPUTATION_EVENT_FAILED' });
  }
});

router.get('/reputation/score', async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser?.sub;
    if (!studentId) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }

    const score = await queryOne<Record<string, unknown>>(
      'SELECT * FROM reputation_scores WHERE student_id = $1',
      [studentId],
    );

    if (!score) {
      res.json({
        score: 300,
        tier: 'BUILDING',
        on_time_payments: 0,
        total_payments: 0,
        repayment_rate: 0,
        months_of_history: 0,
        message: 'Make your first rent payment to start building your reputation',
      });
      return;
    }

    res.json(score);
  } catch (err) {
    logger.error({ err }, 'Reputation score fetch failed');
    res.status(500).json({ error: 'REPUTATION_SCORE_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Driver referral (student app — invite friends to drive)
// ---------------------------------------------------------------------------

router.post('/referral/driver', async (req: Request, res: Response) => {
  try {
    if (!req.vectaUser?.sub) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    const result = await createGenericDriverInvite(req.vectaUser.sub);
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'referral/driver create failed');
    res.status(500).json({ error: 'REFERRAL_FAILED' });
  }
});

router.get('/referral/driver/status', async (req: Request, res: Response) => {
  try {
    if (!req.vectaUser?.sub) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    const referrals = await query(
      `
      SELECT invite_code, referee_email, status, created_at, completed_at
      FROM driver_referrals
      WHERE referrer_student_id=$1
      ORDER BY created_at DESC
      LIMIT 10
    `,
      [req.vectaUser.sub],
    );
    const { referrerCents } = await getDriverReferralOfferCents();
    const credited = referrals.rows.filter((r: { status: string }) => r.status === 'CREDITED').length;
    const pending = referrals.rows.filter((r: { status: string }) => r.status === 'PENDING').length;
    res.json({
      referrals: referrals.rows,
      totalCredited: credited,
      totalPending: pending,
      totalEarnedCents: credited * referrerCents,
    });
  } catch (err) {
    logger.error({ err }, 'referral driver status failed');
    res.status(500).json({ error: 'REFERRAL_STATUS_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Internal admin — revenue, tickets, flags (JWT-authenticated; tighten with RBAC in prod)
// ---------------------------------------------------------------------------

router.get('/admin/tickets', async (req: Request, res: Response) => {
  try {
    if (!req.vectaUser?.sub) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    const tickets = await query(
      `
      SELECT st.*,
             COALESCE(s.legal_name, s.verified_email) AS student_name,
             s.verified_email AS student_email,
             r.pickup_address, r.dropoff_address,
             r.actual_fare_cents
      FROM support_tickets st
      LEFT JOIN students s ON s.id = st.filed_by_student_id
      LEFT JOIN rides r ON r.id = st.ride_id
      WHERE st.status IN ('OPEN','IN_REVIEW','ESCALATED')
      ORDER BY
        CASE st.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2
          WHEN 'NORMAL' THEN 3 ELSE 4 END,
        st.created_at ASC
      LIMIT 100
    `,
    );
    res.json({ tickets: tickets.rows });
  } catch (err) {
    logger.error({ err }, 'admin tickets failed');
    res.status(500).json({ error: 'FETCH_FAILED' });
  }
});

router.post('/admin/tickets/:ticketId/refund', async (req: Request, res: Response) => {
  try {
    if (!req.vectaUser?.sub) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    const { amountCents, reason } = z
      .object({
        amountCents: z.number().int().positive(),
        reason: z.string().min(1).max(500).transform((v) => stripFreeText(v)),
      })
      .parse(req.body);
    const adminId = req.vectaUser.sub;

    const ticket = await queryOne<{
      id: string;
      filed_by_student_id: string | null;
      ride_id: string | null;
    }>('SELECT id, filed_by_student_id, ride_id FROM support_tickets WHERE id=$1', [req.params.ticketId]);

    if (!ticket) {
      res.status(404).json({ error: 'TICKET_NOT_FOUND' });
      return;
    }
    if (!ticket.filed_by_student_id) {
      res.status(400).json({ error: 'NO_STUDENT_ON_TICKET' });
      return;
    }

    await processRefund({
      ticketId: req.params.ticketId,
      studentId: ticket.filed_by_student_id,
      rideId: ticket.ride_id,
      amountCents,
      reason,
      approvedBy: adminId,
    });

    res.json({
      success: true,
      message: `Refund of $${(amountCents / 100).toFixed(2)} processed.`,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'INVALID_BODY' });
      return;
    }
    logger.error({ err }, 'admin refund failed');
    res.status(500).json({ error: 'REFUND_FAILED' });
  }
});

router.post('/admin/flag', async (req: Request, res: Response) => {
  try {
    if (!req.vectaUser?.sub) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    const { studentId, driverId, flagType, reason, expiresAt } = z
      .object({
        studentId: z.string().uuid().optional(),
        driverId: z.string().uuid().optional(),
        flagType: z.string().min(1).max(32),
        reason: z.string().min(1).max(500).transform((v) => stripFreeText(v)),
        expiresAt: z.string().optional(),
      })
      .parse(req.body);
    const adminId = req.vectaUser.sub;

    await flagAccount({
      studentId,
      driverId,
      flagType,
      reason,
      flaggedBy: adminId,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'INVALID_BODY' });
      return;
    }
    logger.error({ err }, 'admin flag failed');
    res.status(500).json({ error: 'FLAG_FAILED' });
  }
});

router.get('/admin/revenue', async (req: Request, res: Response) => {
  try {
    if (!req.vectaUser?.sub) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    const revenue = await query(
      `
      SELECT
        event_type,
        COUNT(*)::int AS count,
        SUM(amount_cents)::int AS total_cents,
        DATE_TRUNC('day', created_at) AS day
      FROM revenue_events
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY event_type, DATE_TRUNC('day', created_at)
      ORDER BY day DESC, total_cents DESC
    `,
    );

    const platformBalance = await queryOne<{ balance: string }>(
      `SELECT COALESCE(MAX(balance_after_cents), 0)::text AS balance
       FROM ledger_entries WHERE account_id=$1`,
      [PLATFORM_ACCOUNT_ID],
    );

    res.json({
      events: revenue.rows,
      platformBalance: platformBalance?.balance ?? '0',
    });
  } catch (err) {
    logger.error({ err }, 'admin revenue failed');
    res.status(500).json({ error: 'FETCH_FAILED' });
  }
});

router.get('/reputation/score/:studentId', async (req: Request, res: Response) => {
  try {
    const { studentId } = z.object({ studentId: z.string().uuid() }).parse(req.params);

    const score = await queryOne<{
      score: number;
      tier: string;
      on_time_payments: number;
      months_of_history: number;
      last_calculated: string;
    }>(
      `SELECT score, tier, on_time_payments, months_of_history, last_calculated
       FROM reputation_scores WHERE student_id = $1`,
      [studentId],
    );

    if (!score) {
      res.json({ score: 300, tier: 'BUILDING', monthsOfHistory: 0 });
      return;
    }

    res.json({
      score:           score.score,
      tier:            score.tier,
      monthsOfHistory: score.months_of_history,
      verifiedAt:      score.last_calculated,
      issuer:          'Vecta Financial Services LLC',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'INVALID_STUDENT_ID' });
      return;
    }
    logger.error({ err }, 'Public reputation fetch failed');
    res.status(500).json({ error: 'REPUTATION_PUBLIC_FAILED' });
  }
});

export { router as complianceRouter };
