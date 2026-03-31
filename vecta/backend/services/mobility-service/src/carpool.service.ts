// services/mobility-service/src/carpool.service.ts
import { query, queryOne, withTransaction } from '@vecta/database';
import { createLogger } from '@vecta/logger';
import type { PoolClient } from 'pg';
import { notifyDriver } from './ride-tracking.service';

const logger = createLogger('carpool-service');

export const CARPOOL_PRICE_PER_MILE_CENTS = 60;

async function sendCarpoolExpoPush(
  driverId: string,
  p: {
    rideId: string;
    pickupAddress: string;
    dropoffAddress: string;
    estimatedMiles: number;
    fareCents: number;
    driverPayoutCents: number;
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
        title: '🚌 Carpool rider joined',
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
            rideType: 'CARPOOL',
          },
        },
        sound: 'default',
        priority: 'high',
      }),
    });
  } catch (err) {
    logger.warn({ err }, 'Carpool push notification failed');
  }
}

function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

async function checkDetourAcceptable(
  session: Record<string, unknown>,
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
): Promise<boolean> {
  const oLat = Number(session.driver_origin_lat);
  const oLng = Number(session.driver_origin_lng);
  const dLat = Number(session.driver_dest_lat);
  const dLng = Number(session.driver_dest_lng);
  const driverBearing = calculateBearing(oLat, oLng, dLat, dLng);
  const riderBearing = calculateBearing(pickupLat, pickupLng, dropoffLat, dropoffLng);
  const bearingDiff = Math.abs(driverBearing - riderBearing);
  return bearingDiff <= 45 || bearingDiff >= 315;
}

export async function findOrCreateCarpoolSession(params: {
  riderStudentId: string;
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffAddress: string;
  estimatedMiles: number;
}): Promise<{
  sessionId: string;
  rideId: string;
  fareCents: number;
  waitMinutes: number;
  matched: boolean;
  driverInfo?: Record<string, unknown>;
}> {
  const existingSession = await query(
    `
    SELECT
      cs.*,
      dp.vehicle_make,
      dp.vehicle_model,
      dp.vehicle_color,
      dp.vehicle_plate,
      dp.rating,
      dl.lat AS driver_lat,
      dl.lng AS driver_lng,
      ST_Distance(
        dl.location,
        ST_SetSRID(ST_MakePoint($2::double precision, $1::double precision), 4326)::geography
      ) AS distance_to_pickup_meters
    FROM carpool_sessions cs
    JOIN driver_profiles dp ON dp.id = cs.driver_id
    JOIN driver_locations dl ON dl.driver_id = cs.driver_id
    WHERE cs.status = 'OPEN'
      AND cs.current_riders < cs.max_riders
      AND dl.is_online = TRUE
      AND dp.status = 'APPROVED'
      AND dp.work_auth_expiry > CURRENT_DATE
      AND dp.license_expiry > CURRENT_DATE
      AND dp.insurance_expiry > CURRENT_DATE
      AND ST_DWithin(
        dl.location,
        ST_SetSRID(ST_MakePoint($2::double precision, $1::double precision), 4326)::geography,
        8047
      )
      AND (cs.departure_time IS NULL OR cs.departure_time > NOW())
    ORDER BY distance_to_pickup_meters ASC
    LIMIT 5
  `,
    [params.pickupLat, params.pickupLng],
  );

  let bestSession: Record<string, unknown> | null = null;
  for (const row of existingSession.rows as Record<string, unknown>[]) {
    const ok = await checkDetourAcceptable(row, params.pickupLat, params.pickupLng, params.dropoffLat, params.dropoffLng);
    if (ok) {
      bestSession = row;
      break;
    }
  }

  const fareCentsJoin = Math.round(params.estimatedMiles * CARPOOL_PRICE_PER_MILE_CENTS);
  const platformJoin = Math.round(fareCentsJoin * 0.1);
  const driverPayoutJoin = Math.round(fareCentsJoin * 0.9);

  if (bestSession) {
    const result = await withTransaction(async (client: PoolClient) => {
      const ride = await client.query<{ id: string }>(
        `
        INSERT INTO rides (
          rider_student_id,
          driver_id,
          carpool_session_id,
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
        ) VALUES ($1,$2,$3,'CARPOOL',1,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'MATCHED')
        RETURNING id
      `,
        [
          params.riderStudentId,
          bestSession.driver_id as string,
          bestSession.id as string,
          params.pickupLat,
          params.pickupLng,
          params.pickupAddress,
          params.dropoffLat,
          params.dropoffLng,
          params.dropoffAddress,
          params.estimatedMiles,
          CARPOOL_PRICE_PER_MILE_CENTS,
          fareCentsJoin,
          platformJoin,
          driverPayoutJoin,
        ],
      );

      const rideId = ride.rows[0]!.id;

      const stopCount = await client.query(`SELECT COUNT(*)::text AS c FROM carpool_stops WHERE session_id=$1`, [
        bestSession.id as string,
      ]);
      const nextOrder = Number.parseInt(stopCount.rows[0]!.c as string, 10) || 0;

      await client.query(
        `
        INSERT INTO carpool_stops (
          session_id, ride_id, rider_student_id,
          pickup_lat, pickup_lng, pickup_address,
          dropoff_lat, dropoff_lng, dropoff_address,
          pickup_order, dropoff_order,
          rider_miles, rider_fare_cents
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      `,
        [
          bestSession.id as string,
          rideId,
          params.riderStudentId,
          params.pickupLat,
          params.pickupLng,
          params.pickupAddress,
          params.dropoffLat,
          params.dropoffLng,
          params.dropoffAddress,
          nextOrder,
          nextOrder + 1,
          params.estimatedMiles,
          fareCentsJoin,
        ],
      );

      await client.query(
        `
        UPDATE carpool_sessions
        SET current_riders = current_riders + 1,
            status = CASE
              WHEN current_riders + 1 >= max_riders THEN 'FULL'
              ELSE 'OPEN'
            END
        WHERE id=$1
      `,
        [bestSession.id as string],
      );

      await client.query(`UPDATE rides SET matched_at=NOW() WHERE id=$1`, [rideId]);

      await client.query(
        `INSERT INTO ride_audit_log (ride_id, event, actor, data) VALUES ($1,'CARPOOL_JOINED','SYSTEM',$2::jsonb)`,
        [
          rideId,
          JSON.stringify({
            sessionId: bestSession.id,
            fareCents: fareCentsJoin,
            estimatedMiles: params.estimatedMiles,
          }),
        ],
      );

      return { rideId, fareCents: fareCentsJoin };
    });

    const distM = Number(bestSession.distance_to_pickup_meters) || 0;
    const waitMinutes = Math.max(1, Math.ceil((distM / 1000) * 2));

    notifyDriver(bestSession.driver_id as string, {
      type: 'RIDE_REQUEST',
      rideId: result.rideId,
      rideType: 'CARPOOL',
      pickupAddress: params.pickupAddress,
      dropoffAddress: params.dropoffAddress,
      estimatedMiles: params.estimatedMiles,
      fareCents: fareCentsJoin,
      driverPayout: driverPayoutJoin,
    });

    await sendCarpoolExpoPush(bestSession.driver_id as string, {
      rideId: result.rideId,
      pickupAddress: params.pickupAddress,
      dropoffAddress: params.dropoffAddress,
      estimatedMiles: params.estimatedMiles,
      fareCents: fareCentsJoin,
      driverPayoutCents: driverPayoutJoin,
    });

    logger.info({ sessionId: bestSession.id, rideId: result.rideId }, 'Rider joined existing carpool session');

    return {
      sessionId: bestSession.id as string,
      rideId: result.rideId,
      fareCents: result.fareCents,
      waitMinutes,
      matched: true,
      driverInfo: {
        vehicleMake: bestSession.vehicle_make,
        vehicleModel: bestSession.vehicle_model,
        vehicleColor: bestSession.vehicle_color,
        vehiclePlate: bestSession.vehicle_plate,
        rating: bestSession.rating,
      },
    };
  }

  const fareCents = Math.round(params.estimatedMiles * CARPOOL_PRICE_PER_MILE_CENTS);
  const platformFee = Math.round(fareCents * 0.1);
  const driverPayout = Math.round(fareCents * 0.9);

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
    ) VALUES ($1,'CARPOOL',1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'REQUESTED')
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
      CARPOOL_PRICE_PER_MILE_CENTS,
      fareCents,
      platformFee,
      driverPayout,
    ],
  );

  await query(`INSERT INTO ride_audit_log (ride_id, event, actor, data) VALUES ($1,'RIDE_REQUESTED',$2,$3::jsonb)`, [
    ride!.id,
    params.riderStudentId,
    JSON.stringify({ rideType: 'CARPOOL', fareCents, params }),
  ]);

  logger.info({ rideId: ride!.id }, 'Created new carpool ride request');

  return {
    sessionId: '',
    rideId: ride!.id,
    fareCents,
    waitMinutes: 5,
    matched: false,
  };
}

export async function getCarpoolStops(sessionId: string): Promise<Record<string, unknown>[]> {
  const result = await query(
    `
    SELECT cst.*, s.full_name AS rider_name
    FROM carpool_stops cst
    JOIN students s ON s.id = cst.rider_student_id
    WHERE cst.session_id = $1
    ORDER BY cst.pickup_order ASC
  `,
    [sessionId],
  );
  return result.rows as Record<string, unknown>[];
}

export async function markRiderPickedUp(stopId: string, driverId: string): Promise<void> {
  await withTransaction(async (client: PoolClient) => {
    const upd = await client.query(
      `
      UPDATE carpool_stops cst
      SET status = 'PICKED_UP', picked_up_at = NOW()
      FROM carpool_sessions cs
      WHERE cst.id = $1 AND cst.session_id = cs.id AND cs.driver_id = $2
      RETURNING cst.ride_id
    `,
      [stopId, driverId],
    );
    if (!upd.rows[0]) {
      throw new Error('STOP_NOT_FOUND_OR_FORBIDDEN');
    }
    const rideId = (upd.rows[0] as { ride_id: string }).ride_id;
    await client.query(`UPDATE rides SET status='IN_PROGRESS', pickup_at=NOW() WHERE id=$1`, [rideId]);
  });
}

async function ensureLedgerBalance(
  client: PoolClient,
  studentId: string,
): Promise<{ accountId: string; balance: number }> {
  const riderAccount = await client.query<{ id: string; balance: string }>(
    `SELECT la.id,
            (SELECT COALESCE(MAX(balance_after_cents), 0)
             FROM ledger_entries WHERE account_id = la.id)::text AS balance
     FROM ledger_accounts la
     WHERE la.student_id = $1`,
    [studentId],
  );

  if (!riderAccount.rows[0]) {
    const newAccount = await client.query<{ id: string }>(
      `INSERT INTO ledger_accounts
         (student_id, account_number, routing_number, account_type, status, currency)
       VALUES ($1, 'V' || replace(gen_random_uuid()::text, '-', ''), '021000021', 'CHECKING', 'ACTIVE', 'USD')
       RETURNING id`,
      [studentId],
    );
    return { accountId: newAccount.rows[0]!.id, balance: 0 };
  }

  const balance = Number.parseInt(riderAccount.rows[0]!.balance, 10);
  return {
    accountId: riderAccount.rows[0]!.id,
    balance: Number.isFinite(balance) ? balance : 0,
  };
}

export async function markRiderDroppedOff(stopId: string, driverId: string, actualMiles: number): Promise<void> {
  const stopRow = await queryOne<{
    ride_id: string;
    rider_student_id: string;
    pickup_address: string;
    dropoff_address: string;
  }>(
    `
    SELECT cst.ride_id, cst.rider_student_id, cst.pickup_address, cst.dropoff_address
    FROM carpool_stops cst
    JOIN carpool_sessions cs ON cs.id = cst.session_id
    WHERE cst.id = $1 AND cs.driver_id = $2
  `,
    [stopId, driverId],
  );
  if (!stopRow) {
    throw new Error('STOP_NOT_FOUND_OR_FORBIDDEN');
  }

  const actualFareCents = Math.round(actualMiles * CARPOOL_PRICE_PER_MILE_CENTS);
  const platformFeeCents = Math.round(actualFareCents * 0.1);
  const driverPayoutCents = Math.round(actualFareCents * 0.9);

  const balRow = await queryOne<{ b: string }>(
    `
    SELECT COALESCE((
      SELECT MAX(le.balance_after_cents)::text
      FROM ledger_accounts la
      LEFT JOIN ledger_entries le ON le.account_id = la.id
      WHERE la.student_id = $1
    ), '0') AS b
  `,
    [stopRow.rider_student_id],
  );
  const riderBal = Number.parseInt(balRow?.b ?? '0', 10) || 0;
  if (riderBal < actualFareCents) {
    await query(`UPDATE rides SET status='PAYMENT_FAILED' WHERE id=$1`, [stopRow.ride_id]);
    await query(
      `INSERT INTO ride_audit_log (ride_id, event, actor, data)
       VALUES ($1, 'PAYMENT_FAILED', 'SYSTEM', $2::jsonb)`,
      [
        stopRow.ride_id,
        JSON.stringify({
          required: actualFareCents,
          available: riderBal,
          message: 'Insufficient Vecta balance (carpool leg)',
        }),
      ],
    );
    throw new Error('INSUFFICIENT_BALANCE');
  }
  const balanceAfterDebit = riderBal - actualFareCents;

  await withTransaction(async (client: PoolClient) => {
    const riderLedger = await ensureLedgerBalance(client, stopRow.rider_student_id);

    await client.query(
      `
      UPDATE carpool_stops
      SET status='DROPPED_OFF', dropped_off_at=NOW(),
          rider_miles=$1, rider_fare_cents=$2
      WHERE id=$3
    `,
      [actualMiles, actualFareCents, stopId],
    );

    await client.query(
      `
      UPDATE rides
      SET status='COMPLETED', dropoff_at=NOW(),
          actual_miles=$1, actual_fare_cents=$2,
          platform_fee_cents=$3, driver_payout_cents=$4
      WHERE id=$5
    `,
      [actualMiles, actualFareCents, platformFeeCents, driverPayoutCents, stopRow.ride_id],
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
      const ins = await client.query<{ id: string }>(
        `INSERT INTO ledger_accounts
           (student_id, account_number, routing_number, account_type, status, currency)
         VALUES ($1, 'V' || replace(gen_random_uuid()::text, '-', ''), '021000021', 'CHECKING', 'ACTIVE', 'USD')
         RETURNING id`,
        [driverStudentId],
      );
      driverAccountId = ins.rows[0]!.id;
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
      ) VALUES (gen_random_uuid(), $1, 'CREDIT', $2::bigint, $3::bigint, $4, 'POSTED')`,
      [
        driverAccountId,
        driverPayoutCents,
        driverCurrentBalance + driverPayoutCents,
        `Carpool earnings — ${actualMiles.toFixed(1)} mi`,
      ],
    );

    await client.query(
      `INSERT INTO ledger_entries (
        transaction_id, account_id, entry_type,
        amount_cents, balance_after_cents, description, status
      ) VALUES (gen_random_uuid(), $1, 'DEBIT', $2::bigint, $3::bigint, $4, 'POSTED')`,
      [
        riderLedger.accountId,
        actualFareCents,
        balanceAfterDebit,
        `Vecta Carpool — ${stopRow.pickup_address} → ${stopRow.dropoff_address}`,
      ],
    );

    logger.info({ stopId, rideId: stopRow.ride_id, actualFareCents }, 'Rider dropped off (carpool)');
  });
}
