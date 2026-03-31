// services/mobility-service/src/ride-matching.service.ts
import { query, queryOne, withTransaction, getClient } from '@vecta/database';
import { createLogger } from '@vecta/logger';
import type { PoolClient } from 'pg';

const logger = createLogger('ride-matching');

const PRICE_MATRIX = {
  BASE_PER_MILE_CENTS: 75,
  MAX_PER_MILE_CENTS: 150,
  PEAK_MULTIPLIER: 1.4,
  NIGHT_MULTIPLIER: 1.2,
  PLATFORM_CUT: 0.1,
  DRIVER_SHARE: 0.9,
  SEARCH_RADIUS_METERS: 8047,
};

export function calculateFare(estimatedMiles: number): {
  pricePerMileCents: number;
  estimatedFareCents: number;
  platformFeeCents: number;
  driverPayoutCents: number;
} {
  const hour = new Date().getHours();
  const isPeak = (hour >= 8 && hour <= 9) || (hour >= 17 && hour <= 18);
  const isNight = hour >= 22 || hour <= 5;

  let perMile = PRICE_MATRIX.BASE_PER_MILE_CENTS;
  if (isPeak) perMile = Math.round(perMile * PRICE_MATRIX.PEAK_MULTIPLIER);
  if (isNight) perMile = Math.round(perMile * PRICE_MATRIX.NIGHT_MULTIPLIER);
  perMile = Math.min(perMile, PRICE_MATRIX.MAX_PER_MILE_CENTS);

  const estimatedFareCents = Math.round(estimatedMiles * perMile);
  const platformFeeCents = Math.round(estimatedFareCents * PRICE_MATRIX.PLATFORM_CUT);
  const driverPayoutCents = estimatedFareCents - platformFeeCents;

  return { pricePerMileCents: perMile, estimatedFareCents, platformFeeCents, driverPayoutCents };
}

export async function findNearestDriver(
  pickupLat: number,
  pickupLng: number,
  excludeIds: string[] = [],
): Promise<Record<string, unknown> | null> {
  const result = await query(
    `
    SELECT
      dp.id,
      dp.student_id,
      dp.vehicle_make,
      dp.vehicle_model,
      dp.vehicle_year,
      dp.vehicle_color,
      dp.vehicle_plate,
      dp.vehicle_capacity,
      dp.rating,
      dl.lat,
      dl.lng,
      ST_Distance(
        dl.location,
        ST_SetSRID(ST_MakePoint($2::double precision, $1::double precision), 4326)::geography
      ) AS distance_meters
    FROM driver_profiles dp
    JOIN driver_locations dl ON dl.driver_id = dp.id
    WHERE dl.is_online = TRUE
      AND dp.status = 'APPROVED'
      AND dp.work_auth_expiry > CURRENT_DATE
      AND dp.license_expiry > CURRENT_DATE
      AND (dp.insurance_expiry IS NULL OR dp.insurance_expiry > CURRENT_DATE)
      AND ST_DWithin(
        dl.location,
        ST_SetSRID(ST_MakePoint($2::double precision, $1::double precision), 4326)::geography,
        $3
      )
      AND (CARDINALITY($4::uuid[]) = 0 OR NOT (dp.id = ANY ($4::uuid[])))
    ORDER BY distance_meters ASC, dp.rating DESC NULLS LAST
    LIMIT 1
  `,
    [pickupLat, pickupLng, PRICE_MATRIX.SEARCH_RADIUS_METERS, excludeIds],
  );

  return result.rows[0] ?? null;
}

export async function sendExpoPushForDriverRideRequest(
  driverId: string,
  p: {
    rideId: string;
    pickupAddress: string;
    dropoffAddress: string;
    estimatedMiles: number;
    fareCents: number;
    driverPayoutCents: number;
    rideType?: string;
  },
): Promise<void> {
  try {
    const pushRow = await queryOne<{ expo_token: string }>(
      `SELECT expo_token FROM driver_push_tokens WHERE driver_id=$1`,
      [driverId],
    );
    if (!pushRow?.expo_token) return;
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: pushRow.expo_token,
        title: '🚗 New Ride Request',
        body: `Pickup: ${p.pickupAddress}`,
        data: {
          type: 'RIDE_REQUEST',
          ride: {
            id: p.rideId,
            pickupAddress: p.pickupAddress,
            dropoffAddress: p.dropoffAddress,
            estimatedMiles: p.estimatedMiles,
            fareCents: p.fareCents,
            driverPayout: p.driverPayoutCents,
            rideType: p.rideType ?? 'PRIORITY',
          },
        },
        sound: 'default',
        priority: 'high',
      }),
    });
  } catch (err) {
    logger.warn({ err }, 'Push notification failed');
  }
}

async function sendExpoPushToStudent(
  studentId: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const pushRow = await queryOne<{ expo_token: string }>(
      `SELECT expo_token FROM student_push_tokens
       WHERE student_id=$1 AND is_active=TRUE
       ORDER BY updated_at DESC
       LIMIT 1`,
      [studentId],
    );
    if (!pushRow?.expo_token) return;
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: pushRow.expo_token,
        title,
        body,
        data,
        sound: 'default',
      }),
    });
  } catch (err) {
    logger.warn({ err, studentId }, 'Student push failed');
  }
}

export async function requestScheduledRide(params: {
  riderStudentId: string;
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffAddress: string;
  estimatedMiles: number;
  scheduledFor: Date;
  rideType: 'PRIORITY' | 'CARPOOL';
}): Promise<{ rideId: string; scheduledFor: string }> {
  const fare =
    params.rideType === 'CARPOOL'
      ? {
          pricePerMileCents: 60,
          estimatedFareCents: Math.round(params.estimatedMiles * 60),
          platformFeeCents: Math.round(params.estimatedMiles * 6),
          driverPayoutCents: Math.round(params.estimatedMiles * 54),
        }
      : calculateFare(params.estimatedMiles);

  const maxPassengers = params.rideType === 'CARPOOL' ? 4 : 1;

  const ride = await queryOne<{ id: string }>(
    `
    INSERT INTO rides (
      rider_student_id, ride_type,
      max_passengers, current_passengers,
      pickup_lat, pickup_lng, pickup_address,
      dropoff_lat, dropoff_lng, dropoff_address,
      estimated_miles, price_per_mile_cents,
      estimated_fare_cents, platform_fee_cents,
      driver_payout_cents, status,
      is_scheduled, scheduled_for
    ) VALUES (
      $1, $2, $3, 1, $4, $5, $6, $7, $8, $9,
      $10, $11, $12, $13,
      'REQUESTED', TRUE, $14
    )
    RETURNING id
  `,
    [
      params.riderStudentId,
      params.rideType,
      maxPassengers,
      params.pickupLat,
      params.pickupLng,
      params.pickupAddress,
      params.dropoffLat,
      params.dropoffLng,
      params.dropoffAddress,
      params.estimatedMiles,
      fare.pricePerMileCents,
      fare.estimatedFareCents,
      fare.platformFeeCents,
      fare.driverPayoutCents,
      params.scheduledFor.toISOString(),
    ],
  );

  await query(
    `INSERT INTO ride_audit_log (ride_id, event, actor, data) VALUES ($1, 'RIDE_SCHEDULED', $2, $3::jsonb)`,
    [
      ride!.id,
      params.riderStudentId,
      JSON.stringify({ scheduledFor: params.scheduledFor.toISOString(), rideType: params.rideType }),
    ],
  );

  return { rideId: ride!.id, scheduledFor: params.scheduledFor.toISOString() };
}

export async function activateScheduledRides(): Promise<void> {
  const scheduledRes = await query(
    `
    SELECT * FROM rides
    WHERE is_scheduled = TRUE
      AND status = 'REQUESTED'
      AND driver_id IS NULL
      AND scheduled_for <= NOW() + INTERVAL '15 minutes'
      AND scheduled_for >= NOW() - INTERVAL '45 minutes'
  `,
  );

  for (const ride of scheduledRes.rows as Record<string, unknown>[]) {
    const id = ride.id as string;
    const pickupLat = Number(ride.pickup_lat);
    const pickupLng = Number(ride.pickup_lng);

    const driver = await findNearestDriver(pickupLat, pickupLng);

    if (driver) {
      const updated = await query(
        `
        UPDATE rides SET driver_id=$1, status='MATCHED', matched_at=NOW()
        WHERE id=$2 AND status='REQUESTED' AND driver_id IS NULL
        RETURNING id
      `,
        [driver.id as string, id],
      );
      if ((updated.rowCount ?? 0) === 0) continue;

      await sendExpoPushForDriverRideRequest(driver.id as string, {
        rideId: id,
        pickupAddress: ride.pickup_address as string,
        dropoffAddress: ride.dropoff_address as string,
        estimatedMiles: Number(ride.estimated_miles),
        fareCents: Number(ride.estimated_fare_cents),
        driverPayoutCents: Number(ride.driver_payout_cents),
        rideType: (ride.ride_type as string) ?? 'PRIORITY',
      });

      const riderId = ride.rider_student_id as string;
      await sendExpoPushToStudent(
        riderId,
        '🚗 Driver confirmed!',
        'Your scheduled ride is confirmed. Driver arrives in ~15 min.',
        { type: 'DRIVER_MATCHED', rideId: id },
      );

      await query(`UPDATE rides SET scheduled_no_driver_notified=FALSE WHERE id=$1`, [id]);
    } else {
      const notified = Boolean(ride.scheduled_no_driver_notified);
      if (notified) continue;
      const riderId = ride.rider_student_id as string;
      await sendExpoPushToStudent(
        riderId,
        '⚠️ Finding your driver',
        `Still looking for a driver for your ${new Date(String(ride.scheduled_for)).toLocaleTimeString()} ride.`,
        { type: 'DRIVER_SEARCHING', rideId: id },
      );
      await query(`UPDATE rides SET scheduled_no_driver_notified=TRUE WHERE id=$1`, [id]);
    }
  }
}

export async function expireUnmatchedRides(): Promise<void> {
  const expired = await query(
    `
    UPDATE rides
    SET status='NO_DRIVER_FOUND'
    WHERE status='REQUESTED'
      AND driver_id IS NULL
      AND (
        (COALESCE(is_scheduled, FALSE) = FALSE AND requested_at < NOW() - INTERVAL '12 minutes')
        OR (COALESCE(is_scheduled, FALSE) = TRUE AND scheduled_for < NOW() - INTERVAL '30 minutes')
      )
    RETURNING id
  `,
  );

  for (const row of expired.rows as { id: string }[]) {
    await query(
      `INSERT INTO ride_audit_log (ride_id, event, actor, data) VALUES ($1, 'NO_DRIVER_FOUND', 'SYSTEM', '{}'::jsonb)`,
      [row.id],
    );
  }
}

export async function runRideMaintenanceTick(): Promise<void> {
  await expireUnmatchedRides();
  await activateScheduledRides();
}

export async function requestPriorityRide(params: {
  riderStudentId: string;
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffAddress: string;
  estimatedMiles: number;
}): Promise<{
  rideId: string;
  fare: { estimatedFareCents: number; pricePerMileCents: number; driverPayoutCents: number };
  driver: Record<string, unknown> | null;
  matched: boolean;
}> {
  const fareCalc = calculateFare(params.estimatedMiles);
  const priorityFareCents = fareCalc.estimatedFareCents;
  const platformFee = fareCalc.platformFeeCents;
  const driverPayout = fareCalc.driverPayoutCents;

  const ride = await queryOne<{ id: string }>(
    `
    INSERT INTO rides (
      rider_student_id,
      ride_type,
      max_passengers,
      current_passengers,
      pickup_lat, pickup_lng, pickup_address,
      dropoff_lat, dropoff_lng, dropoff_address,
      estimated_miles,
      price_per_mile_cents,
      estimated_fare_cents,
      platform_fee_cents,
      driver_payout_cents,
      status
    ) VALUES ($1,'PRIORITY',1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'REQUESTED')
    RETURNING id
  `,
    [
      params.riderStudentId,
      params.pickupLat,
      params.pickupLng,
      params.pickupAddress,
      params.dropoffLat,
      params.dropoffLng,
      params.dropoffAddress,
      params.estimatedMiles,
      fareCalc.pricePerMileCents,
      priorityFareCents,
      platformFee,
      driverPayout,
    ],
  );

  const rideId = ride!.id;

  await query(
    `INSERT INTO ride_audit_log (ride_id, event, actor, data) VALUES ($1, 'RIDE_REQUESTED', $2, $3::jsonb)`,
    [rideId, params.riderStudentId, JSON.stringify({ fare: fareCalc, params, rideType: 'PRIORITY' })],
  );

  const driver = await findNearestDriver(params.pickupLat, params.pickupLng);

  if (driver) {
    await query(`UPDATE rides SET driver_id=$1, status='MATCHED', matched_at=NOW() WHERE id=$2`, [
      driver.id as string,
      rideId,
    ]);

    await query(`INSERT INTO ride_audit_log (ride_id, event, actor, data) VALUES ($1, 'DRIVER_MATCHED', 'SYSTEM', $2::jsonb)`, [
      rideId,
      JSON.stringify({ driverId: driver.id, distanceMeters: driver.distance_meters, rideType: 'PRIORITY' }),
    ]);

    await sendExpoPushForDriverRideRequest(driver.id as string, {
      rideId,
      pickupAddress: params.pickupAddress,
      dropoffAddress: params.dropoffAddress,
      estimatedMiles: params.estimatedMiles,
      fareCents: priorityFareCents,
      driverPayoutCents: fareCalc.driverPayoutCents,
      rideType: 'PRIORITY',
    });
  }

  logger.info({ rideId, matched: Boolean(driver), rideType: 'PRIORITY' }, 'priority ride requested');
  return {
    rideId,
    fare: {
      estimatedFareCents: priorityFareCents,
      pricePerMileCents: fareCalc.pricePerMileCents,
      driverPayoutCents: fareCalc.driverPayoutCents,
    },
    driver,
    matched: Boolean(driver),
  };
}

export async function requestRide(params: {
  riderStudentId: string;
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffAddress: string;
  estimatedMiles: number;
}): Promise<{ rideId: string; fare: ReturnType<typeof calculateFare>; driver: Record<string, unknown> | null }> {
  const fare = calculateFare(params.estimatedMiles);

  const ride = await queryOne<{ id: string }>(
    `
    INSERT INTO rides (
      rider_student_id,
      pickup_lat, pickup_lng, pickup_address,
      dropoff_lat, dropoff_lng, dropoff_address,
      estimated_miles,
      price_per_mile_cents,
      estimated_fare_cents,
      platform_fee_cents,
      driver_payout_cents,
      status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'REQUESTED')
    RETURNING id
  `,
    [
      params.riderStudentId,
      params.pickupLat,
      params.pickupLng,
      params.pickupAddress,
      params.dropoffLat,
      params.dropoffLng,
      params.dropoffAddress,
      params.estimatedMiles,
      fare.pricePerMileCents,
      fare.estimatedFareCents,
      fare.platformFeeCents,
      fare.driverPayoutCents,
    ],
  );

  const rideId = ride!.id;

  await query(
    `INSERT INTO ride_audit_log (ride_id, event, actor, data) VALUES ($1, 'RIDE_REQUESTED', $2, $3::jsonb)`,
    [rideId, params.riderStudentId, JSON.stringify({ fare, params })],
  );

  const driver = await findNearestDriver(params.pickupLat, params.pickupLng);

  if (driver) {
    await query(`UPDATE rides SET driver_id=$1, status='MATCHED', matched_at=NOW() WHERE id=$2`, [
      driver.id as string,
      rideId,
    ]);

    await query(`INSERT INTO ride_audit_log (ride_id, event, actor, data) VALUES ($1, 'DRIVER_MATCHED', 'SYSTEM', $2::jsonb)`, [
      rideId,
      JSON.stringify({ driverId: driver.id, distanceMeters: driver.distance_meters }),
    ]);

    await sendExpoPushForDriverRideRequest(driver.id as string, {
      rideId,
      pickupAddress: params.pickupAddress,
      dropoffAddress: params.dropoffAddress,
      estimatedMiles: params.estimatedMiles,
      fareCents: fare.estimatedFareCents,
      driverPayoutCents: fare.driverPayoutCents,
    });
  }

  logger.info({ rideId, matched: Boolean(driver) }, 'ride requested');
  return { rideId, fare, driver };
}

export async function acceptRide(driverId: string, rideId: string): Promise<void> {
  await withTransaction(async (client: PoolClient) => {
    const ride = await client.query(`SELECT * FROM rides WHERE id=$1 AND status='MATCHED' AND driver_id=$2 FOR UPDATE`, [
      rideId,
      driverId,
    ]);
    if (!ride.rows[0]) throw new Error('RIDE_NOT_AVAILABLE');

    await client.query(`UPDATE rides SET status='DRIVER_ACCEPTED', driver_accepted_at=NOW() WHERE id=$1`, [rideId]);
    await client.query(`INSERT INTO ride_audit_log (ride_id, event, actor) VALUES ($1,'DRIVER_ACCEPTED',$2)`, [
      rideId,
      driverId,
    ]);
  });
}

export async function startRide(driverId: string, rideId: string): Promise<void> {
  await query(`UPDATE rides SET status='IN_PROGRESS', pickup_at=NOW() WHERE id=$1 AND driver_id=$2 AND status='DRIVER_ACCEPTED'`, [
    rideId,
    driverId,
  ]);
  await query(`INSERT INTO ride_audit_log (ride_id, event, actor) VALUES ($1,'RIDE_STARTED',$2)`, [rideId, driverId]);
}

export async function completeRide(driverId: string, rideId: string, actualMiles: number): Promise<void> {
  const client = await getClient();
  let committed = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

    const ride = await client.query(
      `SELECT * FROM rides WHERE id=$1 AND driver_id=$2 AND status='IN_PROGRESS' FOR UPDATE`,
      [rideId, driverId],
    );
    if (!ride.rows[0]) throw new Error('RIDE_NOT_IN_PROGRESS');

    const r = ride.rows[0] as {
      price_per_mile_cents: number;
      rider_student_id: string;
      pickup_address: string;
      dropoff_address: string;
    };
    const actualFareCents = Math.round(actualMiles * Number(r.price_per_mile_cents));
    const platformFee = Math.round(actualFareCents * 0.1);
    const driverPayout = actualFareCents - platformFee;

    const riderAccount = await client.query(
      `SELECT la.id,
              (SELECT COALESCE(MAX(balance_after_cents), 0)
               FROM ledger_entries WHERE account_id = la.id)::text AS balance
       FROM ledger_accounts la
       WHERE la.student_id = $1`,
      [r.rider_student_id],
    );

    let accountId: string;
    let currentBalance: number;

    if (!riderAccount.rows[0]) {
      const newAccount = await client.query(
        `INSERT INTO ledger_accounts
           (student_id, account_number, routing_number, account_type, status, currency)
         VALUES ($1, 'V' || replace(gen_random_uuid()::text, '-', ''), '021000021', 'CHECKING', 'ACTIVE', 'USD')
         RETURNING id`,
        [r.rider_student_id],
      );
      accountId = newAccount.rows[0]!.id;
      currentBalance = 0;
    } else {
      accountId = riderAccount.rows[0]!.id;
      currentBalance = Number.parseInt(riderAccount.rows[0]!.balance, 10);
      if (!Number.isFinite(currentBalance)) currentBalance = 0;
    }

    if (currentBalance < actualFareCents) {
      await client.query(`UPDATE rides SET status='PAYMENT_FAILED' WHERE id=$1`, [rideId]);
      await client.query(
        `INSERT INTO ride_audit_log (ride_id, event, actor, data)
         VALUES ($1, 'PAYMENT_FAILED', 'SYSTEM', $2::jsonb)`,
        [
          rideId,
          JSON.stringify({
            required: actualFareCents,
            available: currentBalance,
            message: 'Insufficient Vecta balance',
          }),
        ],
      );
      await client.query('COMMIT');
      committed = true;
      logger.warn({ rideId, riderId: r.rider_student_id, actualFareCents, currentBalance }, 'ride payment failed');
      throw new Error('INSUFFICIENT_BALANCE');
    }

    const balanceAfterDebit = currentBalance - actualFareCents;

    await client.query(
      `
      UPDATE rides SET
        status='COMPLETED',
        dropoff_at=NOW(),
        actual_miles=$1,
        actual_fare_cents=$2,
        platform_fee_cents=$3,
        driver_payout_cents=$4
      WHERE id=$5
    `,
      [actualMiles, actualFareCents, platformFee, driverPayout, rideId],
    );

    const driverStudent = await client.query<{ student_id: string }>(
      `SELECT dp.student_id FROM driver_profiles dp WHERE dp.id = $1`,
      [driverId],
    );
    const driverStudentId = driverStudent.rows[0]?.student_id;
    if (!driverStudentId) {
      throw new Error('DRIVER_STUDENT_NOT_FOUND');
    }

    const driverAccount = await client.query<{ id: string; balance: string }>(
      `SELECT la.id,
              (SELECT COALESCE(MAX(balance_after_cents), 0)
               FROM ledger_entries WHERE account_id = la.id)::text AS balance
       FROM ledger_accounts la WHERE la.student_id = $1`,
      [driverStudentId],
    );

    let driverAccountId: string;
    let driverCurrentBalance: number;

    if (!driverAccount.rows[0]) {
      const newDriverAccount = await client.query<{ id: string }>(
        `INSERT INTO ledger_accounts
           (student_id, account_number, routing_number, account_type, status, currency)
         VALUES ($1, 'V' || replace(gen_random_uuid()::text, '-', ''), '021000021', 'CHECKING', 'ACTIVE', 'USD')
         RETURNING id`,
        [driverStudentId],
      );
      driverAccountId = newDriverAccount.rows[0]!.id;
      driverCurrentBalance = 0;
    } else {
      driverAccountId = driverAccount.rows[0]!.id;
      driverCurrentBalance = Number.parseInt(driverAccount.rows[0]!.balance, 10);
      if (!Number.isFinite(driverCurrentBalance)) driverCurrentBalance = 0;
    }

    await client.query(
      `INSERT INTO ledger_entries (
        transaction_id, account_id, entry_type,
        amount_cents, balance_after_cents, description, status
      ) VALUES (
        gen_random_uuid(),
        $1,
        'CREDIT',
        $2::bigint,
        $3::bigint,
        $4,
        'POSTED'
      )`,
      [
        driverAccountId,
        driverPayout,
        driverCurrentBalance + driverPayout,
        `Ride earnings — ${actualMiles.toFixed(1)} miles`,
      ],
    );

    await client.query(
      `INSERT INTO ledger_entries (
        transaction_id, account_id, entry_type,
        amount_cents, balance_after_cents, description, status
      ) VALUES (gen_random_uuid(), $1, 'DEBIT', $2::bigint, $3::bigint, $4, 'POSTED')`,
      [
        accountId,
        actualFareCents,
        balanceAfterDebit,
        `Vecta Ride — ${r.pickup_address} → ${r.dropoff_address}`,
      ],
    );

    await client.query(
      `INSERT INTO reputation_events (student_id, event_type, verified_by, amount_cents) VALUES ($1, 'RENT_PAYMENT_ONTIME', 'VECTA', $2::bigint)`,
      [r.rider_student_id, actualFareCents],
    );

    await client.query(`INSERT INTO ride_audit_log (ride_id, event, actor, data) VALUES ($1,'RIDE_COMPLETED',$2,$3::jsonb)`, [
      rideId,
      driverId,
      JSON.stringify({ actualMiles, actualFareCents, driverPayout }),
    ]);

    await client.query('COMMIT');
    committed = true;

    try {
      const { processReferralForDriverFirstRide } = await import(
        '../../compliance-service/src/referral.service'
      );
      const completedCount = await queryOne<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM rides WHERE driver_id=$1 AND status='COMPLETED'`,
        [driverId],
      );
      if (Number.parseInt(completedCount?.c ?? '0', 10) === 1) {
        const prof = await queryOne<{ referred_by_invite_code: string | null }>(
          `SELECT referred_by_invite_code FROM driver_profiles WHERE id=$1`,
          [driverId],
        );
        if (prof?.referred_by_invite_code) {
          await processReferralForDriverFirstRide(driverStudentId, prof.referred_by_invite_code);
        }
      }
    } catch (refErr) {
      logger.error({ err: refErr, rideId }, 'Referral completion failed');
    }

    try {
      const { recordRideFee } = await import('../../compliance-service/src/revenue.service');
      const meta = await queryOne<{ fleet_vehicle_id: string | null; rider_student_id: string }>(
        `SELECT fleet_vehicle_id, rider_student_id FROM rides WHERE id=$1`,
        [rideId],
      );
      if (meta) {
        await recordRideFee({
          rideId,
          studentId: meta.rider_student_id,
          fareCents: actualFareCents,
          isFleetVehicle: Boolean(meta.fleet_vehicle_id),
        });
      }
    } catch (revErr) {
      logger.error({ err: revErr, rideId }, 'Revenue recording failed');
    }
  } catch (err) {
    if (!committed) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    throw err;
  } finally {
    client.release();
  }
}
