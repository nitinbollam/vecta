/**
 * Support tickets, refunds, account flags — Vecta Ledger only.
 */

import { query, queryOne, withTransaction } from '@vecta/database';
import { createLogger } from '@vecta/logger';
import type { PoolClient } from 'pg';
import { PLATFORM_ACCOUNT_ID } from './revenue.service';

const logger = createLogger('dispute-service');

export async function fileTicket(params: {
  category: string;
  description: string;
  filedByStudentId?: string;
  filedByDriverId?: string;
  rideId?: string;
  evidenceUrls?: string[];
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
}): Promise<{ ticketId: string; ticketNumber: string }> {
  const priority =
    params.priority ??
    (String(params.description).includes('SAFETY EMERGENCY')
      ? 'URGENT'
      : params.category === 'DRIVER_REPORT' || params.category === 'RIDER_REPORT'
        ? 'HIGH'
        : 'NORMAL');

  const ticket = await queryOne<{ id: string; ticket_number: string }>(
    `
    INSERT INTO support_tickets (
      category, description,
      filed_by_student_id, filed_by_driver_id,
      ride_id, evidence_urls, priority
    ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
    RETURNING id, ticket_number
  `,
    [
      params.category,
      params.description,
      params.filedByStudentId ?? null,
      params.filedByDriverId ?? null,
      params.rideId ?? null,
      JSON.stringify(params.evidenceUrls ?? []),
      priority,
    ],
  );

  logger.info({ ticketId: ticket!.id, category: params.category }, 'Support ticket filed');
  return { ticketId: ticket!.id, ticketNumber: ticket!.ticket_number };
}

export async function processRefund(params: {
  ticketId: string;
  studentId: string;
  rideId: string | null;
  amountCents: number;
  reason: string;
  approvedBy: string;
}): Promise<void> {
  await withTransaction(async (client: PoolClient) => {
    const account = await client.query<{ id: string; balance: string }>(
      `SELECT la.id,
         COALESCE((SELECT MAX(balance_after_cents) FROM ledger_entries
                   WHERE account_id=la.id), 0)::text AS balance
       FROM ledger_accounts la WHERE la.student_id=$1`,
      [params.studentId],
    );

    if (!account.rows[0]) {
      throw new Error('NO_STUDENT_ACCOUNT');
    }

    const { id: accountId, balance } = account.rows[0];
    const currentBalance = Number.parseInt(balance, 10) || 0;

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
      ) VALUES (gen_random_uuid(), $1, 'DEBIT', $2::bigint, $3::bigint, $4, 'POSTED')
    `,
      [
        PLATFORM_ACCOUNT_ID,
        params.amountCents,
        platBal - params.amountCents,
        `Refund for ticket ${params.ticketId}`,
      ],
    );

    await client.query(
      `
      INSERT INTO ledger_entries (
        transaction_id, account_id, entry_type,
        amount_cents, balance_after_cents, description, status
      ) VALUES (gen_random_uuid(), $1, 'CREDIT', $2::bigint, $3::bigint, $4, 'POSTED')
    `,
      [accountId, params.amountCents, currentBalance + params.amountCents, `Refund: ${params.reason}`],
    );

    await client.query(
      `
      INSERT INTO refunds
        (ticket_id, ride_id, student_id, amount_cents, reason, approved_by)
      VALUES ($1,$2,$3,$4,$5,$6)
    `,
      [
        params.ticketId,
        params.rideId,
        params.studentId,
        params.amountCents,
        params.reason,
        params.approvedBy,
      ],
    );

    await client.query(
      `
      UPDATE support_tickets
      SET status='REFUNDED', resolved_by=$1, resolution_note=$2,
          refund_amount_cents=$3, resolved_at=NOW()
      WHERE id=$4
    `,
      [params.approvedBy, params.reason, params.amountCents, params.ticketId],
    );

    logger.info(
      { ticketId: params.ticketId, studentId: params.studentId, amountCents: params.amountCents },
      'Refund processed',
    );
  });
}

export async function flagAccount(params: {
  studentId?: string;
  driverId?: string;
  flagType: string;
  reason: string;
  flaggedBy: string;
  expiresAt?: Date;
}): Promise<void> {
  await query(
    `
    INSERT INTO account_flags
      (student_id, driver_id, flag_type, reason, flagged_by, expires_at)
    VALUES ($1,$2,$3,$4,$5,$6)
  `,
    [
      params.studentId ?? null,
      params.driverId ?? null,
      params.flagType,
      params.reason,
      params.flaggedBy,
      params.expiresAt ?? null,
    ],
  );

  if (params.flagType === 'BANNED' && params.studentId) {
    await query(`UPDATE students SET kyc_status='SUSPENDED' WHERE id=$1`, [params.studentId]);
  }

  if (params.flagType === 'SUSPENDED' && params.driverId) {
    await query(`UPDATE driver_profiles SET status='SUSPENDED' WHERE id=$1`, [params.driverId]);
  }

  logger.warn({ ...params }, 'Account flagged');
}
