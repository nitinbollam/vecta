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
  F1ComplianceError,
} from '../../../services/mobility-service/src/flight-recorder.service';
import {
  requestRide,
  acceptRide,
  startRide,
  completeRide,
  requestPriorityRide,
  calculateFare,
} from '../../../services/mobility-service/src/ride-matching.service';
import {
  findOrCreateCarpoolSession,
  getCarpoolStops,
  markRiderPickedUp,
  markRiderDroppedOff,
  CARPOOL_PRICE_PER_MILE_CENTS,
} from '../../../services/mobility-service/src/carpool.service';
import {
  applyAsDriver,
  goOnline,
  goOffline,
} from '../../../services/mobility-service/src/driver-onboarding.service';
import { notifyDriver } from '../../../services/mobility-service/src/ride-tracking.service';
import { authMiddleware, requireKYC, requirePermission } from '@vecta/auth';
import { createLogger, logComplianceEvent } from '@vecta/logger';
import { query, queryOne } from '@vecta/database';
import { stripFreeText } from '../lib/sanitize';

const logger = createLogger('mobility-router');
const router = Router();

router.use(authMiddleware);
router.use(requireKYC('APPROVED'));

// ---------------------------------------------------------------------------
// Lightweight consent ping (student app) — full vehicle payload uses /vehicle/enroll
// ---------------------------------------------------------------------------

router.post('/enroll', async (req: Request, res: Response) => {
  try {
    z.object({ consentGiven: z.literal(true) }).parse(req.body);
    res.status(201).json({
      ok: true,
      message:
        'Consent recorded. Add your vehicle details in Fleet to complete enrollment.',
    });
  } catch (err) {
    logger.warn({ err }, 'Mobility /enroll validation failed');
    res.status(400).json({ error: 'INVALID_BODY', message: 'consentGiven: true required' });
  }
});

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
// Peer rides — riders & approved drivers
// ---------------------------------------------------------------------------

router.post('/rides/request', async (req: Request, res: Response) => {
  try {
    const body = z
      .object({
        pickupLat: z.number(),
        pickupLng: z.number(),
        pickupAddress: z.string().min(1).max(500).transform((v) => stripFreeText(v)),
        dropoffLat: z.number(),
        dropoffLng: z.number(),
        dropoffAddress: z.string().min(1).max(500).transform((v) => stripFreeText(v)),
        estimatedMiles: z.number().positive().max(500),
      })
      .parse(req.body);
    const riderStudentId = req.vectaUser!.sub;

    const result = await requestRide({
      riderStudentId,
      pickupLat: body.pickupLat,
      pickupLng: body.pickupLng,
      pickupAddress: body.pickupAddress,
      dropoffLat: body.dropoffLat,
      dropoffLng: body.dropoffLng,
      dropoffAddress: body.dropoffAddress,
      estimatedMiles: body.estimatedMiles,
    });

    if (result.driver?.id) {
      notifyDriver(result.driver.id as string, {
        type: 'RIDE_REQUEST',
        rideId: result.rideId,
        fare: result.fare,
        pickupAddress: body.pickupAddress,
        dropoffAddress: body.dropoffAddress,
        estimatedMiles: body.estimatedMiles,
      });
    }

    res.json(result);
  } catch (err) {
    logger.error({ err }, 'rides/request failed');
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'INVALID_BODY', details: err.flatten() });
      return;
    }
    res.status(500).json({ error: 'RIDE_REQUEST_FAILED' });
  }
});

router.get('/rides/mine', async (req: Request, res: Response) => {
  try {
    const r = await query(
      `SELECT id, pickup_address, dropoff_address, status, requested_at, actual_fare_cents, estimated_fare_cents
       FROM rides WHERE rider_student_id=$1 ORDER BY requested_at DESC LIMIT 10`,
      [req.vectaUser!.sub],
    );
    res.json({ rides: r.rows });
  } catch (err) {
    logger.error({ err }, 'rides/mine failed');
    res.status(500).json({ error: 'FETCH_FAILED' });
  }
});

router.get('/rides/nearby-drivers', async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(String(req.query.lat ?? ''));
    const lng = parseFloat(String(req.query.lng ?? ''));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'lat and lng required' });
      return;
    }
    const drivers = await query(
      `
      SELECT dp.id, dp.vehicle_make, dp.vehicle_model, dp.vehicle_color,
             dp.rating, dl.lat, dl.lng, dl.heading,
             ST_Distance(
               dl.location,
               ST_SetSRID(ST_MakePoint($2::double precision, $1::double precision), 4326)::geography
             ) AS distance_meters
      FROM driver_profiles dp
      JOIN driver_locations dl ON dl.driver_id = dp.id
      WHERE dl.is_online=TRUE AND dp.status='APPROVED'
        AND ST_DWithin(
          dl.location,
          ST_SetSRID(ST_MakePoint($2::double precision, $1::double precision), 4326)::geography,
          8047
        )
      ORDER BY distance_meters ASC NULLS LAST
      LIMIT 10
    `,
      [lat, lng],
    );
    res.json({ drivers: drivers.rows });
  } catch (err) {
    logger.error({ err }, 'nearby-drivers failed');
    res.status(500).json({ error: 'FETCH_FAILED' });
  }
});

router.get('/rides/estimate', async (req: Request, res: Response) => {
  try {
    const miles = parseFloat(String(req.query.miles ?? ''));
    if (!Number.isFinite(miles) || miles <= 0) {
      res.status(400).json({ error: 'INVALID_MILES' });
      return;
    }
    const priorityFare = calculateFare(miles);
    const carpoolFareCents = Math.round(miles * CARPOOL_PRICE_PER_MILE_CENTS);
    const savingsCents = priorityFare.estimatedFareCents - carpoolFareCents;
    const savingsPct =
      priorityFare.estimatedFareCents > 0
        ? Math.round((1 - carpoolFareCents / priorityFare.estimatedFareCents) * 100)
        : 0;
    res.json({
      miles,
      priority: {
        fareCents: priorityFare.estimatedFareCents,
        pricePerMile: priorityFare.pricePerMileCents / 100,
        label: 'Priority',
        description: 'Your own private ride',
        etaMinutes: 3,
      },
      carpool: {
        fareCents: carpoolFareCents,
        pricePerMile: 0.6,
        label: 'Carpool',
        description: 'Share with other students going your way',
        etaMinutes: 6,
        savingsCents,
        savingsPct,
      },
    });
  } catch (err) {
    logger.error({ err }, 'rides/estimate failed');
    res.status(500).json({ error: 'ESTIMATE_FAILED' });
  }
});

router.post('/rides/request/priority', async (req: Request, res: Response) => {
  try {
    const body = z
      .object({
        pickupLat: z.number(),
        pickupLng: z.number(),
        pickupAddress: z.string().min(1).max(500).transform((v) => stripFreeText(v)),
        dropoffLat: z.number(),
        dropoffLng: z.number(),
        dropoffAddress: z.string().min(1).max(500).transform((v) => stripFreeText(v)),
        estimatedMiles: z.number().positive().max(500),
      })
      .parse(req.body);
    const riderStudentId = req.vectaUser!.sub;

    const result = await requestPriorityRide({
      riderStudentId,
      pickupLat: body.pickupLat,
      pickupLng: body.pickupLng,
      pickupAddress: body.pickupAddress,
      dropoffLat: body.dropoffLat,
      dropoffLng: body.dropoffLng,
      dropoffAddress: body.dropoffAddress,
      estimatedMiles: body.estimatedMiles,
    });

    if (result.driver?.id) {
      notifyDriver(result.driver.id as string, {
        type: 'RIDE_REQUEST',
        rideId: result.rideId,
        rideType: 'PRIORITY',
        pickupAddress: body.pickupAddress,
        dropoffAddress: body.dropoffAddress,
        estimatedMiles: body.estimatedMiles,
        fareCents: result.fare.estimatedFareCents,
        driverPayout: result.fare.driverPayoutCents,
      });
    }

    const d = result.driver;
    res.json({
      rideId: result.rideId,
      rideType: 'PRIORITY',
      fare: {
        estimatedFareCents: result.fare.estimatedFareCents,
        pricePerMileCents: result.fare.pricePerMileCents,
        driverPayoutCents: result.fare.driverPayoutCents,
      },
      driver: d
        ? {
            vehicleMake: d.vehicle_make,
            vehicleModel: d.vehicle_model,
            vehicleColor: d.vehicle_color,
            vehiclePlate: d.vehicle_plate,
            rating: d.rating,
            distanceMeters: d.distance_meters,
          }
        : null,
      matched: result.matched,
    });
  } catch (err) {
    logger.error({ err }, 'rides/request/priority failed');
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'INVALID_BODY', details: err.flatten() });
      return;
    }
    res.status(500).json({ error: 'RIDE_REQUEST_FAILED' });
  }
});

router.post('/rides/request/carpool', async (req: Request, res: Response) => {
  try {
    const body = z
      .object({
        pickupLat: z.number(),
        pickupLng: z.number(),
        pickupAddress: z.string().min(1).max(500).transform((v) => stripFreeText(v)),
        dropoffLat: z.number(),
        dropoffLng: z.number(),
        dropoffAddress: z.string().min(1).max(500).transform((v) => stripFreeText(v)),
        estimatedMiles: z.number().positive().max(500),
      })
      .parse(req.body);
    const riderStudentId = req.vectaUser!.sub;

    const result = await findOrCreateCarpoolSession({
      riderStudentId,
      pickupLat: body.pickupLat,
      pickupLng: body.pickupLng,
      pickupAddress: body.pickupAddress,
      dropoffLat: body.dropoffLat,
      dropoffLng: body.dropoffLng,
      dropoffAddress: body.dropoffAddress,
      estimatedMiles: body.estimatedMiles,
    });

    const priorityRef = calculateFare(body.estimatedMiles).estimatedFareCents;
    res.json({
      rideId: result.rideId,
      sessionId: result.sessionId,
      rideType: 'CARPOOL',
      fareCents: result.fareCents,
      waitMinutes: result.waitMinutes,
      matched: result.matched,
      driverInfo: result.driverInfo,
      savings: {
        priorityFareCents: priorityRef,
        carpoolFareCents: result.fareCents,
        savingsCents: priorityRef - result.fareCents,
        savingsPct:
          priorityRef > 0 ? Math.round((1 - result.fareCents / priorityRef) * 100) : 0,
      },
    });
  } catch (err) {
    logger.error({ err }, 'rides/request/carpool failed');
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'INVALID_BODY', details: err.flatten() });
      return;
    }
    res.status(500).json({ error: 'CARPOOL_REQUEST_FAILED' });
  }
});

router.get('/carpool/:sessionId/stops', async (req: Request, res: Response) => {
  try {
    const stops = await getCarpoolStops(req.params.sessionId);
    res.json({ stops });
  } catch (err) {
    logger.error({ err }, 'carpool stops failed');
    res.status(500).json({ error: 'FETCH_FAILED' });
  }
});

router.post('/carpool/stop/:stopId/pickup', async (req: Request, res: Response) => {
  try {
    const driver = await queryOne<{ id: string }>('SELECT id FROM driver_profiles WHERE student_id=$1', [
      req.vectaUser!.sub,
    ]);
    if (!driver) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    await markRiderPickedUp(req.params.stopId, driver.id);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'carpool pickup failed');
    res.status(500).json({ error: 'PICKUP_FAILED' });
  }
});

router.post('/carpool/stop/:stopId/dropoff', async (req: Request, res: Response) => {
  try {
    const { actualMiles } = z.object({ actualMiles: z.number().positive().max(500) }).parse(req.body);
    const driver = await queryOne<{ id: string }>('SELECT id FROM driver_profiles WHERE student_id=$1', [
      req.vectaUser!.sub,
    ]);
    if (!driver) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    await markRiderDroppedOff(req.params.stopId, driver.id, actualMiles);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'carpool dropoff failed');
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'INVALID_BODY' });
      return;
    }
    if ((err as Error).message === 'INSUFFICIENT_BALANCE') {
      res.status(402).json({ error: 'INSUFFICIENT_BALANCE' });
      return;
    }
    res.status(500).json({ error: 'DROPOFF_FAILED' });
  }
});

router.get('/rides/:rideId', async (req: Request, res: Response) => {
  try {
    const ride = await queryOne(
      `SELECT r.*,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color,
              dp.vehicle_plate, dp.rating AS driver_profile_rating,
              dl.lat AS driver_lat, dl.lng AS driver_lng,
              s.legal_name AS driver_name
       FROM rides r
       LEFT JOIN driver_profiles dp ON dp.id = r.driver_id
       LEFT JOIN driver_locations dl ON dl.driver_id = r.driver_id
       LEFT JOIN students s ON s.id = dp.student_id
       WHERE r.id=$1 AND r.rider_student_id=$2`,
      [req.params.rideId, req.vectaUser!.sub],
    );
    if (!ride) {
      res.status(404).json({ error: 'RIDE_NOT_FOUND' });
      return;
    }
    res.json(ride);
  } catch (err) {
    logger.error({ err }, 'ride get failed');
    res.status(500).json({ error: 'FETCH_FAILED' });
  }
});

router.post('/rides/:rideId/cancel', async (req: Request, res: Response) => {
  try {
    const reason =
      typeof req.body?.reason === 'string'
        ? stripFreeText(req.body.reason).slice(0, 500)
        : 'Cancelled by rider';
    await query(
      `UPDATE rides SET status='CANCELLED', cancelled_at=NOW(), cancel_reason=$1
       WHERE id=$2 AND rider_student_id=$3 AND status IN ('REQUESTED','MATCHED')`,
      [reason, req.params.rideId, req.vectaUser!.sub],
    );
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'ride cancel failed');
    res.status(500).json({ error: 'CANCEL_FAILED' });
  }
});

router.post('/rides/:rideId/rate', async (req: Request, res: Response) => {
  try {
    const { rating, review } = z
      .object({
        rating: z.number().int().min(1).max(5),
        review: z.string().max(2000).transform((v) => stripFreeText(v)).optional(),
      })
      .parse(req.body);
    await query(
      `UPDATE rides SET rider_rating=$1, rider_review=$2 WHERE id=$3 AND rider_student_id=$4`,
      [rating, review ?? null, req.params.rideId, req.vectaUser!.sub],
    );
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'ride rate failed');
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'INVALID_BODY' });
      return;
    }
    res.status(500).json({ error: 'RATE_FAILED' });
  }
});

router.post('/driver/apply', async (req: Request, res: Response) => {
  try {
    const body = z
      .object({
        workAuthType: z.string(),
        workAuthDocUrl: z.string().url(),
        workAuthExpiry: z.string(),
        licenseNumberEnc: z.string().min(1).max(500),
        licenseState: z.string().min(2).max(8).transform((v) => stripFreeText(v)),
        licenseExpiry: z.string(),
        licenseDocUrl: z.string().url(),
        insuranceDocUrl: z.string().url(),
        insuranceExpiry: z.string(),
        vehicleMake: z.string().min(1).max(50).transform((v) => stripFreeText(v)),
        vehicleModel: z.string().min(1).max(50).transform((v) => stripFreeText(v)),
        vehicleYear: z.number().int().min(1990).max(new Date().getFullYear() + 1),
        vehicleColor: z.string().min(1).max(40).transform((v) => stripFreeText(v)),
        vehiclePlate: z.string().min(1).max(20).transform((v) => stripFreeText(v)),
        vehicleCapacity: z.number().int().min(2).max(7),
      })
      .parse(req.body);

    const result = await applyAsDriver(req.vectaUser!.sub, {
      workAuthType: body.workAuthType,
      workAuthDocUrl: body.workAuthDocUrl,
      workAuthExpiry: body.workAuthExpiry,
      licenseNumberEnc: body.licenseNumberEnc,
      licenseState: body.licenseState,
      licenseExpiry: body.licenseExpiry,
      licenseDocUrl: body.licenseDocUrl,
      insuranceDocUrl: body.insuranceDocUrl,
      insuranceExpiry: body.insuranceExpiry,
      vehicleMake: body.vehicleMake,
      vehicleModel: body.vehicleModel,
      vehicleYear: body.vehicleYear,
      vehicleColor: body.vehicleColor,
      vehiclePlate: body.vehiclePlate,
      vehicleCapacity: body.vehicleCapacity,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof F1ComplianceError) {
      res.status(403).json({
        error: 'F1_VISA_COMPLIANCE_VIOLATION',
        message: err.message,
      });
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/driver/status', async (req: Request, res: Response) => {
  try {
    const driver = await queryOne(
      `SELECT dp.*, dl.is_online, dl.lat, dl.lng
       FROM driver_profiles dp
       LEFT JOIN driver_locations dl ON dl.driver_id = dp.id
       WHERE dp.student_id=$1`,
      [req.vectaUser!.sub],
    );
    if (!driver) {
      res.json({ hasProfile: false });
      return;
    }
    res.json({ hasProfile: true, ...driver });
  } catch (err) {
    logger.error({ err }, 'driver status failed');
    res.status(500).json({ error: 'FETCH_FAILED' });
  }
});

router.post('/driver/online', async (req: Request, res: Response) => {
  try {
    const { lat, lng } = z.object({ lat: z.number(), lng: z.number() }).parse(req.body);
    const driver = await queryOne<{ id: string }>(
      'SELECT id FROM driver_profiles WHERE student_id=$1 AND status=$2',
      [req.vectaUser!.sub, 'APPROVED'],
    );
    if (!driver) {
      res.status(403).json({ error: 'DRIVER_NOT_APPROVED' });
      return;
    }
    await goOnline(driver.id, lat, lng);
    res.json({ online: true });
  } catch (err) {
    logger.error({ err }, 'driver online failed');
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'INVALID_BODY' });
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/driver/offline', async (req: Request, res: Response) => {
  try {
    const driver = await queryOne<{ id: string }>('SELECT id FROM driver_profiles WHERE student_id=$1', [
      req.vectaUser!.sub,
    ]);
    if (!driver) {
      res.status(404).json({ error: 'DRIVER_NOT_FOUND' });
      return;
    }
    await goOffline(driver.id);
    res.json({ online: false });
  } catch (err) {
    logger.error({ err }, 'driver offline failed');
    res.status(500).json({ error: 'OFFLINE_FAILED' });
  }
});

router.post('/driver/push-token', async (req: Request, res: Response) => {
  try {
    const { token } = z.object({ token: z.string().min(1) }).parse(req.body);
    const driver = await queryOne<{ id: string }>('SELECT id FROM driver_profiles WHERE student_id=$1', [
      req.vectaUser!.sub,
    ]);
    if (!driver) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    await query(
      `INSERT INTO driver_push_tokens (driver_id, expo_token)
       VALUES ($1, $2)
       ON CONFLICT (driver_id) DO UPDATE SET expo_token=$2, updated_at=NOW()`,
      [driver.id, token],
    );
    res.json({ registered: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'INVALID_BODY' });
      return;
    }
    logger.error({ err }, 'driver push-token failed');
    res.status(500).json({ error: 'PUSH_TOKEN_FAILED' });
  }
});

router.patch('/driver/location', async (req: Request, res: Response) => {
  try {
    const { lat, lng, heading } = z
      .object({ lat: z.number(), lng: z.number(), heading: z.number().optional() })
      .parse(req.body);
    const driver = await queryOne<{ id: string }>('SELECT id FROM driver_profiles WHERE student_id=$1', [
      req.vectaUser!.sub,
    ]);
    if (!driver) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    await query(`UPDATE driver_locations SET lat=$1, lng=$2, heading=$3 WHERE driver_id=$4`, [
      lat,
      lng,
      heading ?? null,
      driver.id,
    ]);
    res.json({ updated: true });
  } catch (err) {
    logger.error({ err }, 'driver location failed');
    res.status(400).json({ error: 'UPDATE_FAILED' });
  }
});

router.post('/driver/accept/:rideId', async (req: Request, res: Response) => {
  try {
    const driver = await queryOne<{ id: string }>(
      'SELECT id FROM driver_profiles WHERE student_id=$1 AND status=$2',
      [req.vectaUser!.sub, 'APPROVED'],
    );
    if (!driver) {
      res.status(403).json({ error: 'NOT_APPROVED' });
      return;
    }
    await acceptRide(driver.id, req.params.rideId);
    res.json({ accepted: true });
  } catch (err) {
    logger.error({ err }, 'driver accept failed');
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/driver/start/:rideId', async (req: Request, res: Response) => {
  try {
    const driver = await queryOne<{ id: string }>('SELECT id FROM driver_profiles WHERE student_id=$1', [
      req.vectaUser!.sub,
    ]);
    if (!driver) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    await startRide(driver.id, req.params.rideId);
    res.json({ started: true });
  } catch (err) {
    logger.error({ err }, 'driver start failed');
    res.status(500).json({ error: 'START_FAILED' });
  }
});

router.post('/driver/complete/:rideId', async (req: Request, res: Response) => {
  try {
    const { actualMiles } = z.object({ actualMiles: z.number().positive() }).parse(req.body);
    const driver = await queryOne<{ id: string }>('SELECT id FROM driver_profiles WHERE student_id=$1', [
      req.vectaUser!.sub,
    ]);
    if (!driver) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    await completeRide(driver.id, req.params.rideId, actualMiles);
    res.json({ completed: true });
  } catch (err) {
    logger.error({ err }, 'driver complete failed');
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'INVALID_BODY' });
      return;
    }
    if ((err as Error).message === 'INSUFFICIENT_BALANCE') {
      res.status(402).json({
        error: 'INSUFFICIENT_BALANCE',
        message: 'Rider had insufficient Vecta balance; ride marked PAYMENT_FAILED.',
      });
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/driver/earnings', async (req: Request, res: Response) => {
  try {
    const driver = await queryOne<{ id: string }>('SELECT id FROM driver_profiles WHERE student_id=$1', [
      req.vectaUser!.sub,
    ]);
    if (!driver) {
      res.json({
        total_earnings_cents: 0,
        total_rides: 0,
        avg_miles: 0,
        total_miles: 0,
      });
      return;
    }

    const earnings = await queryOne<{
      total_earnings_cents: number;
      total_rides: number;
      avg_miles: string;
      total_miles: string;
    }>(
      `
      SELECT
        COALESCE(SUM(driver_payout_cents),0)::int AS total_earnings_cents,
        COUNT(*)::int AS total_rides,
        COALESCE(AVG(actual_miles),0)::numeric(6,2)::text AS avg_miles,
        COALESCE(SUM(actual_miles),0)::numeric(8,2)::text AS total_miles
      FROM rides
      WHERE driver_id=$1 AND status='COMPLETED'
        AND EXTRACT(YEAR FROM dropoff_at) = EXTRACT(YEAR FROM NOW())
    `,
      [driver.id],
    );

    res.json(
      earnings ?? {
        total_earnings_cents: 0,
        total_rides: 0,
        avg_miles: '0',
        total_miles: '0',
      },
    );
  } catch (err) {
    logger.error({ err }, 'driver earnings failed');
    res.status(500).json({ error: 'FETCH_FAILED' });
  }
});

router.get('/driver/rides/history', async (req: Request, res: Response) => {
  try {
    const driver = await queryOne<{ id: string }>('SELECT id FROM driver_profiles WHERE student_id=$1', [
      req.vectaUser!.sub,
    ]);
    if (!driver) {
      res.json({ rides: [] });
      return;
    }
    const r = await query(
      `SELECT id, pickup_address, dropoff_address, actual_miles, driver_payout_cents, dropoff_at, status
       FROM rides WHERE driver_id=$1 ORDER BY requested_at DESC LIMIT 50`,
      [driver.id],
    );
    res.json({ rides: r.rows });
  } catch (err) {
    logger.error({ err }, 'driver history failed');
    res.status(500).json({ error: 'FETCH_FAILED' });
  }
});

router.get('/driver/rides/:rideId', async (req: Request, res: Response) => {
  try {
    const driver = await queryOne<{ id: string }>('SELECT id FROM driver_profiles WHERE student_id=$1', [
      req.vectaUser!.sub,
    ]);
    if (!driver) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const ride = await queryOne(
      `SELECT r.*, s.legal_name AS rider_name
       FROM rides r
       JOIN students s ON s.id = r.rider_student_id
       WHERE r.id=$1 AND r.driver_id=$2`,
      [req.params.rideId, driver.id],
    );
    if (!ride) {
      res.status(404).json({ error: 'RIDE_NOT_FOUND' });
      return;
    }
    res.json(ride);
  } catch (err) {
    logger.error({ err }, 'driver ride get failed');
    res.status(500).json({ error: 'FETCH_FAILED' });
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
