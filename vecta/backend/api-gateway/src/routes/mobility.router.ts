/**
 * mobility.router.ts — Mobility & IRS Compliance routes
 *
 * POST /api/v1/mobility/vehicle/enroll        — Enroll vehicle with F-1 consent
 * GET  /api/v1/mobility/vehicle               — Get enrolled vehicles
 * GET  /api/v1/mobility/earnings              — YTD earnings summary (Schedule E)
 * GET  /api/v1/mobility/audit/chain           — Export flight recorder chain
 * POST /api/v1/mobility/dso-memo/generate     — Generate DSO compliance memo
 * GET  /api/v1/mobility/dso-memo/:memoId      — Download DSO memo PDF
 *
 * FORBIDDEN (returns 403 with F1_VISA_COMPLIANCE_VIOLATION):
 *   POST /api/v1/mobility/rides/accept        — Lessors CANNOT accept rides
 *   POST /api/v1/mobility/driver/go-online    — Lessors CANNOT go online as driver
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  vehicleEnrollmentService,
  dsoComplianceMemoService,
  flightRecorderService,
} from '../../../services/mobility-service/src/flight-recorder.service';
import { authMiddleware, requireKYC, requirePermission } from '@vecta/auth';
import { createLogger, logComplianceEvent } from '@vecta/logger';
import { query, queryOne } from '@vecta/database';
import { stripFreeText } from '../lib/sanitize';

const logger = createLogger('mobility-router');
const router = Router();

router.use(authMiddleware);
router.use(requireKYC('APPROVED'));

// ---------------------------------------------------------------------------
// Vehicle enrollment — consent-gated, triggers LESSOR role activation
// ---------------------------------------------------------------------------

router.post('/vehicle/enroll', async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;
    const ipAddress = (req.headers['x-forwarded-for'] as string) ?? req.ip ?? 'unknown';
    const userAgent = req.headers['user-agent'] ?? 'unknown';

    const body = z
      .object({
        vehicleVin:        z.string().min(17).max(17).toUpperCase(),
        vehicleYear:       z.number().int().min(2000).max(new Date().getFullYear() + 1),
        vehicleMake:       z.string().trim().max(50).transform((v) => stripFreeText(v)),
        vehicleModel:      z.string().trim().max(50).transform((v) => stripFreeText(v)),
        // All four consent booleans must be true — validated in service layer too
        consentStrictlyPassive:    z.literal(true),
        consentScheduleE:          z.literal(true),
        consentFlightRecorder:     z.literal(true),
        consentIndependentCounsel: z.literal(true),
        consentVersion:            z.string().trim().max(32).transform((v) => stripFreeText(v)).optional().default('v1.0.0'),
      })
      .parse(req.body);

    const result = await vehicleEnrollmentService.enrollVehicleWithConsent({
      studentId,
      vehicleVin:        body.vehicleVin,
      vehicleYear:       body.vehicleYear,
      vehicleMake:       body.vehicleMake,
      vehicleModel:      body.vehicleModel,
      strictlyPassiveAcknowledged: body.consentStrictlyPassive,
      taxClassificationAcknowledged: body.consentScheduleE,
      flightRecorderConsentAcknowledged: body.consentFlightRecorder,
      independentCounselWaiverAcknowledged: body.consentIndependentCounsel,
      tosVersion: body.consentVersion,
      consentIpAddress: ipAddress,
      consentUserAgent: userAgent,
    });

    logComplianceEvent('VEHICLE_ENROLLED', studentId, {
      vehicleVin: body.vehicleVin,
      leaseId: result.leaseId,
    });

    res.status(201).json({
      leaseId: result.leaseId,
      leaseActive: result.leaseActive,
      message: 'Vehicle enrolled. Your role has been updated to LESSOR.',
    });
  } catch (err) {
    logger.error({ err }, 'Vehicle enrollment failed');
    if (err instanceof Error && err.message.includes('CONSENT_INCOMPLETE')) {
      res.status(422).json({
        error: 'CONSENT_INCOMPLETE',
        message: 'All four F-1 compliance consent clauses must be acknowledged.',
      });
      return;
    }
    res.status(500).json({ error: 'ENROLLMENT_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// List enrolled vehicles
// ---------------------------------------------------------------------------

router.get('/vehicle', async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;

    const result = await query<{
      id: string;
      vehicle_vin: string;
      vehicle_year: number;
      vehicle_make: string;
      vehicle_model: string;
      status: string;
      created_at: string;
    }>(
      `SELECT id, vehicle_vin, vehicle_year, vehicle_make, vehicle_model, status, created_at
       FROM vehicle_leases
       WHERE lessor_student_id = $1 AND status = 'active'
       ORDER BY created_at DESC`,
      [studentId],
    );

    res.json({ vehicles: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch vehicles');
    res.status(500).json({ error: 'FETCH_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// YTD earnings summary
// ---------------------------------------------------------------------------

router.get('/earnings', async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;
    const taxYear = parseInt(req.query.year as string ?? String(new Date().getFullYear()), 10);

    const result = await queryOne<{
      ytd_rental_income: string;
      ride_count: number;
      active_since: string;
    }>(
      `SELECT
         SUM(rental_income_usd)::numeric(10,2)::text AS ytd_rental_income,
         COUNT(*)::int                                AS ride_count,
         MIN(ride_started_at)::text                  AS active_since
       FROM flight_recorder
       WHERE lessor_student_id = $1
         AND EXTRACT(YEAR FROM ride_started_at) = $2`,
      [studentId, taxYear],
    );

    res.json({
      taxYear,
      ytdRentalIncome:  parseFloat(result?.ytd_rental_income ?? '0'),
      rideCount:        result?.ride_count ?? 0,
      activeSince:      result?.active_since ?? null,
      taxClassification: 'Schedule E — Passive Rental Income',
      form1099Type:     '1099-MISC Box 1: Rents',
      irsNote:          'Income is NOT reportable as Schedule C or 1099-NEC.',
    });
  } catch (err) {
    logger.error({ err }, 'Earnings fetch failed');
    res.status(500).json({ error: 'EARNINGS_FETCH_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Flight Recorder audit chain export (for USCIS/IRS)
// ---------------------------------------------------------------------------

router.get(
  '/audit/chain',
  requirePermission('mobility:export_audit_chain'),
  async (req: Request, res: Response) => {
    try {
      const studentId = req.vectaUser!.sub;
      const taxYear = parseInt(
        req.query.year as string ?? String(new Date().getFullYear()),
        10,
      );

      const chain = await flightRecorderService.exportAuditChain({ lessorStudentId: studentId, taxYear });

      logComplianceEvent('AUDIT_CHAIN_EXPORTED', studentId, { taxYear, entries: chain.records.length });

      res.json({
        studentId,
        taxYear,
        exportedAt: new Date().toISOString(),
        chainIntegrity: 'VERIFIED',
        entries: chain.records,
      });
    } catch (err) {
      logger.error({ err }, 'Audit chain export failed');
      if (err instanceof Error && err.message.includes('CHAIN_INTEGRITY_FAILED')) {
        res.status(500).json({
          error: 'CHAIN_INTEGRITY_FAILED',
          message: 'Audit chain integrity check failed. Please contact compliance@vecta.io.',
        });
        return;
      }
      res.status(500).json({ error: 'EXPORT_FAILED' });
    }
  },
);

// ---------------------------------------------------------------------------
// Generate DSO compliance memo
// ---------------------------------------------------------------------------

router.post('/dso-memo/generate', async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;
    const { dsoName, universityName } = z
      .object({
        dsoName:        z.string().trim().max(200).transform((v) => stripFreeText(v)).optional(),
        universityName: z.string().trim().max(200).transform((v) => stripFreeText(v)).optional(),
      })
      .parse(req.body);

    const memo = await dsoComplianceMemoService.generateMemo(studentId);

    res.status(201).json(memo);
  } catch (err) {
    logger.error({ err }, 'DSO memo generation failed');
    if (err instanceof Error && err.message.includes('NO_ACTIVE_LEASE')) {
      res.status(422).json({
        error: 'NO_ACTIVE_LEASE',
        message: 'You must have an active vehicle lease to generate a DSO compliance memo.',
      });
      return;
    }
    res.status(500).json({ error: 'MEMO_GENERATION_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// FORBIDDEN routes — architectural dead ends for F-1 visa compliance
// ---------------------------------------------------------------------------

// These routes exist so the frontend can gracefully receive 403s rather than
// hitting unmatched routes. The RBAC middleware enforces the prohibition.

router.post(
  '/rides/accept',
  requirePermission('mobility:accept_ride'),
  (_req: Request, res: Response) => {
    // requirePermission will reject LESSOR role before this handler runs
    res.status(403).json({
      error: 'F1_VISA_COMPLIANCE_VIOLATION',
      message: 'F-1 LESSOR role cannot accept ride requests.',
    });
  },
);

router.post(
  '/driver/go-online',
  requirePermission('mobility:go_online_as_driver'),
  (_req: Request, res: Response) => {
    res.status(403).json({
      error: 'F1_VISA_COMPLIANCE_VIOLATION',
      message: 'F-1 LESSOR role cannot go online as a driver.',
    });
  },
);

export { router as mobilityRouter };
