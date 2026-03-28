import { createCipheriv, randomBytes } from 'crypto';
import { createLogger } from '@vecta/logger';
import { withTransaction } from '@vecta/database';

const logger = createLogger('escrow');

function encryptAchPayload(plaintext: string): string {
  const hex = process.env.CARD_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error('CARD_ENCRYPTION_KEY must be set (32 bytes hex)');
  const key = Buffer.from(hex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export class VectaEscrowService {
  async holdRentInEscrow(params: {
    studentId: string;
    landlordId: string;
    leaseAppId: string;
    amountCents: number;
    releaseCondition: 'LEASE_SIGNED' | 'MOVE_IN_DATE' | 'MANUAL';
    releaseDate?: Date;
  }): Promise<string> {
    return withTransaction(async (client) => {
      const balResult = await client.query<{ current_balance: string }>(
        `SELECT COALESCE(
           (SELECT balance_after_cents FROM ledger_entries
            WHERE account_id = (SELECT id FROM ledger_accounts WHERE student_id = $1 LIMIT 1)
              AND status = 'POSTED'
            ORDER BY created_at DESC LIMIT 1),
           0
         )::text AS current_balance`,
        [params.studentId],
      );

      const currentBalance = Number(balResult.rows[0]?.current_balance ?? 0);
      if (currentBalance < params.amountCents) {
        throw new Error('INSUFFICIENT_FUNDS');
      }

      const acct = await client.query<{ id: string }>(
        'SELECT id FROM ledger_accounts WHERE student_id = $1 LIMIT 1',
        [params.studentId],
      );
      const accountId = acct.rows[0]?.id;
      if (!accountId) throw new Error('ACCOUNT_NOT_FOUND');

      const newBal = currentBalance - params.amountCents;

      await client.query(
        `INSERT INTO ledger_entries
           (transaction_id, account_id, entry_type, amount_cents,
            balance_after_cents, description, category, merchant_name, status)
         VALUES (gen_random_uuid(), $1, 'DEBIT', $2, $3, $4, NULL, NULL, 'POSTED')`,
        [
          accountId,
          params.amountCents,
          newBal,
          'Escrow hold — first month rent guarantee',
        ],
      );

      const escrow = await client.query<{ id: string }>(
        `INSERT INTO escrow_accounts
           (student_id, landlord_id, lease_app_id, amount_cents,
            release_condition, release_date)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id`,
        [
          params.studentId,
          params.landlordId,
          params.leaseAppId,
          params.amountCents,
          params.releaseCondition,
          params.releaseDate ?? null,
        ],
      );

      const escrowId = escrow.rows[0]!.id;
      logger.info(
        { escrowId, studentId: params.studentId, amountCents: params.amountCents },
        'Rent held in escrow',
      );

      return escrowId;
    });
  }

  async releaseToLandlord(escrowId: string, note: string): Promise<void> {
    return withTransaction(async (client) => {
      const escrow = await client.query<{
        student_id: string;
        landlord_id: string | null;
        amount_cents: string;
      }>(
        `SELECT student_id, landlord_id, amount_cents::text AS amount_cents
         FROM escrow_accounts
         WHERE id = $1 AND status = 'HELD'
         FOR UPDATE`,
        [escrowId],
      );

      const row = escrow.rows[0];
      if (!row) throw new Error('ESCROW_NOT_FOUND_OR_ALREADY_RELEASED');

      await client.query(
        `UPDATE escrow_accounts
         SET status='RELEASED', released_at=NOW(), released_to='LANDLORD', release_note=$2
         WHERE id=$1`,
        [escrowId, note],
      );

      const acct = await client.query<{ id: string }>(
        'SELECT id FROM ledger_accounts WHERE student_id = $1 LIMIT 1',
        [row.student_id],
      );
      const accountId = acct.rows[0]?.id;
      if (accountId) {
        const enc = encryptAchPayload('PENDING_LANDLORD_BANK');
        await client.query(
          `INSERT INTO ach_transfers (
             account_id, direction, amount_cents, external_bank_name,
             external_routing, external_account_enc, description, status
           ) VALUES ($1, 'OUTBOUND', $2, 'Landlord Payout', 'PENDING', $3, $4, 'PENDING')`,
          [accountId, Number(row.amount_cents), enc, 'Escrow release — landlord payout'],
        );
      }

      const { recordReputationEvent } = await import(
        '../../compliance-service/src/reputation.service'
      );
      await recordReputationEvent({
        studentId: row.student_id,
        eventType: 'RENT_PAYMENT_ONTIME',
        verifiedBy: 'VECTA',
        amountCents: Number(row.amount_cents),
        landlordId: row.landlord_id ?? undefined,
      });

      logger.info({ escrowId }, 'Escrow released to landlord');
    });
  }

  async refundToStudent(escrowId: string, reason: string): Promise<void> {
    return withTransaction(async (client) => {
      const escrow = await client.query<{
        student_id: string;
        amount_cents: string;
      }>(
        `SELECT student_id, amount_cents::text AS amount_cents
         FROM escrow_accounts WHERE id = $1 AND status = 'HELD' FOR UPDATE`,
        [escrowId],
      );

      const row = escrow.rows[0];
      if (!row) throw new Error('ESCROW_NOT_FOUND_OR_ALREADY_RELEASED');

      await client.query(
        `UPDATE escrow_accounts
         SET status='REFUNDED', released_at=NOW(), released_to='STUDENT', release_note=$2
         WHERE id=$1`,
        [escrowId, reason],
      );

      const acct = await client.query<{ id: string }>(
        'SELECT id FROM ledger_accounts WHERE student_id = $1 LIMIT 1',
        [row.student_id],
      );
      const accountId = acct.rows[0]?.id;
      if (!accountId) throw new Error('ACCOUNT_NOT_FOUND');

      const balResult = await client.query<{ current_balance: string }>(
        `SELECT COALESCE(
           (SELECT balance_after_cents FROM ledger_entries
            WHERE account_id = $1 AND status = 'POSTED'
            ORDER BY created_at DESC LIMIT 1),
           0
         )::text AS current_balance`,
        [accountId],
      );
      const currentBalance = Number(balResult.rows[0]?.current_balance ?? 0);
      const amt = Number(row.amount_cents);

      await client.query(
        `INSERT INTO ledger_entries
           (transaction_id, account_id, entry_type, amount_cents,
            balance_after_cents, description, category, merchant_name, status)
         VALUES (gen_random_uuid(), $1, 'CREDIT', $2, $3, $4, NULL, NULL, 'POSTED')`,
        [accountId, amt, currentBalance + amt, `Escrow refunded: ${reason}`],
      );

      logger.info({ escrowId, reason }, 'Escrow refunded to student');
    });
  }
}
