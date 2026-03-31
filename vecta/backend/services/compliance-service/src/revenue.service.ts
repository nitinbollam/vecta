/**
 * Vecta revenue — platform ledger account, subscriptions, payouts (Column ACH adapter).
 */

import { randomUUID } from 'node:crypto';
import { query, queryOne, withTransaction } from '@vecta/database';
import { createLogger } from '@vecta/logger';
import type { PoolClient } from 'pg';

const logger = createLogger('revenue-service');

export const PLATFORM_ACCOUNT_ID = '00000000-0000-0000-0000-000000000001';

const RATES = {
  RIDE_PLATFORM_CUT: 0.1,
  LOC_FEE_CENTS: 999,
  ESIM_MARGIN_CENTS: 500,
  FLEET_FEE_PER_RIDE_CENTS: 200,
  INSURANCE_MARGIN: 0.15,
};

export async function recordRideFee(params: {
  rideId: string;
  studentId: string;
  fareCents: number;
  isFleetVehicle: boolean;
}): Promise<void> {
  await withTransaction(async (client: PoolClient) => {
    const platformFeeCents = Math.round(params.fareCents * RATES.RIDE_PLATFORM_CUT);
    const fleetFeeCents = params.isFleetVehicle ? RATES.FLEET_FEE_PER_RIDE_CENTS : 0;
    const totalRevenue = platformFeeCents + fleetFeeCents;

    const currentBalance = await client.query<{ balance: string }>(
      `SELECT COALESCE(MAX(balance_after_cents), 0)::text AS balance
       FROM ledger_entries WHERE account_id=$1`,
      [PLATFORM_ACCOUNT_ID],
    );

    const bal = Number.parseInt(currentBalance.rows[0]?.balance ?? '0', 10) || 0;

    await client.query(
      `
      INSERT INTO ledger_entries (
        transaction_id, account_id, entry_type,
        amount_cents, balance_after_cents, description, status
      ) VALUES (
        gen_random_uuid(), $1, 'CREDIT', $2::bigint, $3::bigint, $4, 'POSTED'
      )
    `,
      [PLATFORM_ACCOUNT_ID, totalRevenue, bal + totalRevenue, `Ride fee — ${params.rideId}`],
    );

    await client.query(
      `
      INSERT INTO revenue_events
        (event_type, student_id, ride_id, amount_cents, description)
      VALUES ('RIDE_PLATFORM_FEE', $1, $2, $3, $4)
    `,
      [
        params.studentId,
        params.rideId,
        totalRevenue,
        `Platform fee (10%) + ${params.isFleetVehicle ? 'fleet fee' : 'no fleet fee'}`,
      ],
    );

    logger.info(
      { rideId: params.rideId, platformFeeCents, fleetFeeCents, totalRevenue },
      'Ride revenue recorded',
    );
  });
}

export async function chargeSubscription(
  studentId: string,
  planId: string,
): Promise<{ success: boolean; reason?: string }> {
  const plan = await queryOne<{
    id: string;
    name: string;
    price_cents: number;
  }>('SELECT id, name, price_cents FROM subscription_plans WHERE id=$1 AND active=TRUE', [planId]);

  if (!plan) return { success: false, reason: 'PLAN_NOT_FOUND' };
  if (Number(plan.price_cents) === 0) return { success: true };

  return withTransaction(async (client: PoolClient) => {
    const account = await client.query<{ id: string; balance: string }>(
      `SELECT la.id,
         COALESCE(MAX(le.balance_after_cents), 0)::text AS balance
       FROM ledger_accounts la
       LEFT JOIN ledger_entries le ON le.account_id = la.id
       WHERE la.student_id = $1
       GROUP BY la.id`,
      [studentId],
    );

    if (!account.rows[0]) {
      return { success: false, reason: 'NO_ACCOUNT' };
    }

    const accountId = account.rows[0].id;
    const bal = Number.parseInt(account.rows[0].balance, 10) || 0;
    const priceCents = Number(plan.price_cents);

    if (bal < priceCents) {
      await client.query(
        `UPDATE student_subscriptions SET status='PAST_DUE'
         WHERE student_id=$1 AND plan_id=$2`,
        [studentId, planId],
      );
      return { success: false, reason: 'INSUFFICIENT_BALANCE' };
    }

    await client.query(
      `
      INSERT INTO ledger_entries (
        transaction_id, account_id, entry_type,
        amount_cents, balance_after_cents, description, status
      ) VALUES (gen_random_uuid(), $1, 'DEBIT', $2::bigint, $3::bigint, $4, 'POSTED')
    `,
      [accountId, priceCents, bal - priceCents, `Vecta ${plan.name} subscription`],
    );

    const platformBalance = await client.query<{ balance: string }>(
      `SELECT COALESCE(MAX(balance_after_cents), 0)::text AS balance
       FROM ledger_entries WHERE account_id=$1`,
      [PLATFORM_ACCOUNT_ID],
    );
    const platBal = Number.parseInt(platformBalance.rows[0]?.balance ?? '0', 10) || 0;

    await client.query(
      `
      INSERT INTO ledger_entries (
        transaction_id, account_id, entry_type,
        amount_cents, balance_after_cents, description, status
      ) VALUES (gen_random_uuid(), $1, 'CREDIT', $2::bigint, $3::bigint, $4, 'POSTED')
    `,
      [
        PLATFORM_ACCOUNT_ID,
        priceCents,
        platBal + priceCents,
        `Subscription revenue — ${plan.name}`,
      ],
    );

    await client.query(
      `
      INSERT INTO revenue_events
        (event_type, student_id, amount_cents, description)
      VALUES ('SUBSCRIPTION_CHARGE', $1, $2, $3)
    `,
      [studentId, priceCents, `${plan.name} subscription`],
    );

    await client.query(
      `
      UPDATE student_subscriptions
      SET current_period_start = NOW(),
          current_period_end   = NOW() + INTERVAL '30 days',
          status               = 'ACTIVE'
      WHERE student_id=$1 AND plan_id=$2
    `,
      [studentId, planId],
    );

    logger.info({ studentId, planId, amountCents: priceCents }, 'Subscription charged');
    return { success: true };
  });
}

export async function recordEsimRevenue(studentId: string): Promise<void> {
  const balance = await queryOne<{ balance: string }>(
    `SELECT COALESCE(MAX(balance_after_cents), 0)::text AS balance
     FROM ledger_entries WHERE account_id=$1`,
    [PLATFORM_ACCOUNT_ID],
  );

  const b = Number.parseInt(balance?.balance ?? '0', 10) || 0;

  await query(
    `
    INSERT INTO ledger_entries (
      transaction_id, account_id, entry_type,
      amount_cents, balance_after_cents, description, status
    ) VALUES (gen_random_uuid(), $1, 'CREDIT', $2::bigint, $3::bigint, $4, 'POSTED')
  `,
    [
      PLATFORM_ACCOUNT_ID,
      RATES.ESIM_MARGIN_CENTS,
      b + RATES.ESIM_MARGIN_CENTS,
      'eSIM activation margin',
    ],
  );

  await query(
    `
    INSERT INTO revenue_events
      (event_type, student_id, amount_cents, description)
    VALUES ('ESIM_MARGIN', $1, $2, 'eSIM Go margin $5.00')
  `,
    [studentId, RATES.ESIM_MARGIN_CENTS],
  );
}

export async function recordLocFee(studentId: string): Promise<void> {
  await query(
    `
    INSERT INTO revenue_events
      (event_type, student_id, amount_cents, description)
    VALUES ('LOC_GENERATION_FEE', $1, $2, 'Letter of Credit generation')
  `,
    [studentId, RATES.LOC_FEE_CENTS],
  );
}

export async function initiateDriverPayout(params: {
  driverId: string;
  studentId: string;
  amountCents: number;
  method: 'ACH' | 'INSTANT';
}): Promise<{ payoutId: string; status: string }> {
  return withTransaction(async (client: PoolClient) => {
    const balance = await client.query<{ balance: string; account_id: string }>(
      `SELECT COALESCE(MAX(le.balance_after_cents), 0)::text AS balance,
              la.id AS account_id
       FROM ledger_accounts la
       LEFT JOIN ledger_entries le ON le.account_id = la.id
       WHERE la.student_id = $1
       GROUP BY la.id`,
      [params.studentId],
    );

    if (!balance.rows[0]) {
      throw new Error('NO_LEDGER_ACCOUNT');
    }

    const available = Number.parseInt(balance.rows[0].balance, 10) || 0;
    if (available < params.amountCents) {
      throw new Error('INSUFFICIENT_BALANCE');
    }

    await client.query(
      `
      INSERT INTO ledger_entries (
        transaction_id, account_id, entry_type,
        amount_cents, balance_after_cents, description, status
      ) VALUES (gen_random_uuid(), $1, 'DEBIT', $2::bigint, $3::bigint, 'Driver payout withdrawal', 'POSTED')
    `,
      [balance.rows[0].account_id, params.amountCents, available - params.amountCents],
    );

    const payout = await client.query<{ id: string }>(
      `
      INSERT INTO driver_payout_requests
        (driver_id, amount_cents, method, status)
      VALUES ($1, $2, $3, 'PENDING')
      RETURNING id
    `,
      [params.driverId, params.amountCents, params.method],
    );

    const payoutId = payout.rows[0]!.id;

    try {
      const { ColumnBankAdapter } = await import('../../../shared/providers/src/adapters/column.adapter');
      const column = new ColumnBankAdapter();
      const ref = await column.initiateACH({
        transferId: randomUUID(),
        direction: 'OUTBOUND',
        amountCents: params.amountCents,
        externalRouting: process.env.VECTA_PAYOUT_ROUTING_FALLBACK ?? '021000021',
        externalAccount: process.env.VECTA_PAYOUT_ACCOUNT_FALLBACK ?? '000000001',
        description: 'Vecta driver earnings payout',
      });

      await client.query(
        `UPDATE driver_payout_requests
         SET status='PROCESSING', column_ref=$1 WHERE id=$2`,
        [ref.sponsorRef, payoutId],
      );
    } catch (e) {
      logger.warn({ payoutId, err: e }, 'Column Bank not available — payout queued');
    }

    return { payoutId, status: 'PENDING' };
  });
}
