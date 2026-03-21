/**
 * services/mobility-service/src/server.ts
 *
 * Mobility microservice — F-1 fleet compliance enforcement hub.
 *
 * Routes:
 *   GET  /health
 *   POST /vehicle/enroll             — consent-gated vehicle enrollment
 *   GET  /vehicle/:studentId         — list enrolled vehicles
 *   GET  /earnings/:studentId        — YTD Schedule E earnings
 *   POST /ride/log                   — log a completed ride (internal)
 *   GET  /audit/chain/:studentId     — hash-chain export for USCIS/IRS
 *   POST /dso-memo/generate          — generate DSO compliance memo
 *
 * HARD F-1 BLOCKS (return 403 immediately, no processing):
 *   POST /ride/accept                — LESSOR cannot accept rides
 *   POST /driver/online              — LESSOR cannot go online as driver
 */

import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import {
  vehicleEnrollmentService,
  flightRecorderService,
  dsoComplianceMemoService,
} from './flight-recorder.service';
import { checkDatabaseHealth, closePool, query, queryOne } from '@vecta/database';
import { createLogger, logComplianceEvent } from '@vecta/logger';
import { hmacVerify } from '@vecta/crypto';

const logger = createLogger('mobility-service');
const app    = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? '';

function internalAuth(req: Request, res: Response, next: NextFunction) {
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
  res.status(db.ok ? 200 : 503).json({
    status: db.ok ? 'ok' : 'degraded',
    service: 'mobility-service',
    compliance: 'F1_ENFORCED',
    db,
  });
});

// ---------------------------------------------------------------------------
// HARD BLOCK — these routes architecturally cannot succeed for any role
// ---------------------------------------------------------------------------

app.post('/ride/accept', (_req, res) => {
  res.status(403).json({
    error:     'F1_VISA_COMPLIANCE_VIOLATION',
    message:   'F-1 LESSOR role is prohibited from accepting rides.',
    reference: 'INA § 101(a)(15)(F) — F-1 student employment restrictions',
    supportUrl: 'https://vecta.io/compliance/f1-restrictions',
  });
});

app.post('/driver/online', (_req, res) => {
  res.status(403).json({
    error:     'F1_VISA_COMPLIANCE_VIOLATION',
    message:   'F-1 LESSOR role is prohibited from going online as a driver.',
    reference: 'INA § 101(a)(15)(F) — F-1 student employment restrictions',
    supportUrl: 'https://vecta.io/compliance/f1-restrictions',
  });
});

// ---------------------------------------------------------------------------
// Vehicle enrollment
// ---------------------------------------------------------------------------
app.post('/vehicle/enroll', internalAuth, async (req: Request, res: Response) => {
  try {
    const body = z.object({
      studentId:                 z.string().uuid(),
      vehicleVin:                z.string().length(17).toUpperCase(),
      vehicleYear:               z.number().int().min(2000).max(new Date().getFullYear() + 1),
      vehicleMake:               z.string().max(50),
      vehicleModel:              z.string().max(50),
      consentStrictlyPassive:    z.literal(true),
      consentScheduleE:          z.literal(true),
      consentFlightRecorder:     z.literal(true),
      consentIndependentCounsel: z.literal(true),
      consentVersion:            z.string().default('v1.0.0'),
      ipAddress:                 z.string(),
      userAgent:                 z.string(),
    }).parse(req.body);

    const result = await vehicleEnrollmentService.enrollVehicleWithConsent({
      studentId: body.studentId,
      vehicleVin: body.vehicleVin,
      vehicleMake: body.vehicleMake,
      vehicleModel: body.vehicleModel,
      vehicleYear: body.vehicleYear,
      strictlyPassiveAcknowledged: body.consentStrictlyPassive,
      taxClassificationAcknowledged: body.consentScheduleE,
      flightRecorderConsentAcknowledged: body.consentFlightRecorder,
      independentCounselWaiverAcknowledged: body.consentIndependentCounsel,
      consentIpAddress: body.ipAddress,
      consentUserAgent: body.userAgent,
      tosVersion: body.consentVersion,
    });

    logComplianceEvent('VEHICLE_ENROLLED', body.studentId, {
      vehicleVin: body.vehicleVin, leaseId: result.leaseId,
    });

    res.status(201).json(result);
  } catch (err) {
    logger.error({ err }, 'Vehicle enrollment failed');
    if (err instanceof Error && err.message.includes('CONSENT_INCOMPLETE')) {
      res.status(422).json({ error: 'CONSENT_INCOMPLETE' }); return;
    }
    res.status(500).json({ error: 'ENROLLMENT_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// List enrolled vehicles
// ---------------------------------------------------------------------------
app.get('/vehicle/:studentId', internalAuth, async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params;
    if (!studentId) {
      res.status(400).json({ error: 'MISSING_STUDENT_ID' });
      return;
    }
    const result = await query(
      `SELECT id, vehicle_vin, vehicle_year, vehicle_make, vehicle_model, lease_active, created_at
       FROM vehicle_leases WHERE student_id = $1 AND lease_active = TRUE
       ORDER BY created_at DESC`,
      [studentId],
    );
    res.json({ vehicles: result.rows });
  } catch (err) {
    logger.error({ err }, 'Vehicle fetch failed');
    res.status(500).json({ error: 'FETCH_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// YTD earnings
// ---------------------------------------------------------------------------
app.get('/earnings/:studentId', internalAuth, async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params;
    if (!studentId) {
      res.status(400).json({ error: 'MISSING_STUDENT_ID' });
      return;
    }
    const taxYear = parseInt(req.query.year as string ?? String(new Date().getFullYear()), 10);

    const result = await queryOne<{
      ytd_rental_income: string; ride_count: number; active_since: string;
    }>(
      `SELECT SUM(rental_income_usd)::numeric(10,2)::text AS ytd_rental_income,
              COUNT(*)::int AS ride_count,
              MIN(ride_started_at)::text AS active_since
       FROM flight_recorder
       WHERE lessor_student_id = $1 AND EXTRACT(YEAR FROM ride_started_at) = $2`,
      [studentId, taxYear],
    );

    res.json({
      taxYear,
      ytdRentalIncome:   parseFloat(result?.ytd_rental_income ?? '0'),
      rideCount:         result?.ride_count ?? 0,
      activeSince:       result?.active_since ?? null,
      taxClassification: 'Schedule E — Passive Rental Income',
      form1099Type:      '1099-MISC Box 1: Rents',
    });
  } catch (err) {
    logger.error({ err }, 'Earnings fetch failed');
    res.status(500).json({ error: 'EARNINGS_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Log a completed ride (called by the platform's ride-dispatch system)
// ---------------------------------------------------------------------------
app.post('/ride/log', internalAuth, async (req: Request, res: Response) => {
  try {
    const input = z.object({
      leaseId:       z.string().uuid(),
      driverUserId:  z.string().uuid(),
      rideStartedAt: z.string().datetime(),
      rideEndedAt:   z.string().datetime(),
      grossFareUsd:  z.number().positive(),
      pickupLat:     z.number(),
      pickupLng:     z.number(),
      dropoffLat:    z.number(),
      dropoffLng:    z.number(),
    }).parse(req.body);

    const lease = await queryOne<{ vehicle_vin: string }>(
      `SELECT vehicle_vin FROM vehicle_leases WHERE id = $1 AND lease_active = TRUE`,
      [input.leaseId],
    );
    if (!lease?.vehicle_vin) {
      res.status(404).json({ error: 'LEASE_NOT_FOUND' });
      return;
    }

    const entry = await flightRecorderService.logCompletedRide({
      rideId:           crypto.randomUUID(),
      vehicleVin:       lease.vehicle_vin,
      driverUserId:     input.driverUserId,
      startTimestamp:   input.rideStartedAt,
      endTimestamp:     input.rideEndedAt,
      startGps:         { lat: input.pickupLat, lng: input.pickupLng },
      endGps:           { lat: input.dropoffLat, lng: input.dropoffLng },
      distanceMiles:    0,
      fareAmountCents:  Math.round(input.grossFareUsd * 100),
    });
    res.status(201).json({ entryId: entry.id, hash: entry.cryptographicHash });
  } catch (err) {
    logger.error({ err }, 'Ride log failed');
    if (err instanceof Error && err.message.includes('F1_COMPLIANCE')) {
      res.status(403).json({ error: 'F1_VISA_COMPLIANCE_VIOLATION', message: err.message }); return;
    }
    res.status(500).json({ error: 'RIDE_LOG_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Audit chain export
// ---------------------------------------------------------------------------
app.get('/audit/chain/:studentId', internalAuth, async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params;
    if (!studentId) {
      res.status(400).json({ error: 'MISSING_STUDENT_ID' });
      return;
    }
    const taxYear = parseInt(req.query.year as string ?? String(new Date().getFullYear()), 10);

    const exported = await flightRecorderService.exportAuditChain({
      lessorStudentId: studentId,
      taxYear,
    });

    logComplianceEvent('AUDIT_CHAIN_EXPORTED', studentId, {
      taxYear, entries: exported.rideCount,
    });

    res.json({
      studentId,
      taxYear,
      exportedAt: exported.exportTimestamp,
      chainIntegrity: exported.chainIntegrity,
      entries: exported.records,
      totalRentalIncomeCents: exported.totalRentalIncomeCents,
      rideCount: exported.rideCount,
    });
  } catch (err) {
    logger.error({ err }, 'Audit chain export failed');
    if (err instanceof Error && err.message.includes('CHAIN_INTEGRITY_FAILED')) {
      res.status(500).json({ error: 'CHAIN_INTEGRITY_FAILED' }); return;
    }
    res.status(500).json({ error: 'EXPORT_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// DSO compliance memo
// ---------------------------------------------------------------------------
app.post('/dso-memo/generate', internalAuth, async (req: Request, res: Response) => {
  try {
    const { studentId } = z.object({
      studentId: z.string().uuid(),
    }).parse(req.body);

    const memo = await dsoComplianceMemoService.generateMemo(studentId);
    res.status(201).json(memo);
  } catch (err) {
    logger.error({ err }, 'DSO memo failed');
    if (err instanceof Error && err.message.includes('NO_ACTIVE_LEASE')) {
      res.status(422).json({ error: 'NO_ACTIVE_LEASE' }); return;
    }
    res.status(500).json({ error: 'MEMO_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT ?? '4004', 10);
const server = app.listen(PORT, () =>
  logger.info({ port: PORT, f1Compliance: 'ENFORCED' }, 'Mobility service started'),
);

process.on('SIGTERM', () => server.close(async () => { await closePool(); process.exit(0); }));
process.on('SIGINT',  () => server.close(async () => { await closePool(); process.exit(0); }));

export default app;
