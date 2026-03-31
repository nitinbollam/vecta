// Driver referral credits — amounts configurable via referral_offer_config (company / officer API).
import { query, queryOne, withTransaction } from '@vecta/database';
import { createLogger } from '@vecta/logger';
import type { PoolClient } from 'pg';

const logger = createLogger('referral-service');

const KEY_REFERRER = 'driver_referral_referrer_cents';
const KEY_REFEREE = 'driver_referral_referee_cents';

export async function getDriverReferralOfferCents(): Promise<{
  referrerCents: number;
  refereeCents: number;
}> {
  const r = await queryOne<{ value_int: number }>(
    `SELECT value_int FROM referral_offer_config WHERE key=$1`,
    [KEY_REFERRER],
  );
  const f = await queryOne<{ value_int: number }>(
    `SELECT value_int FROM referral_offer_config WHERE key=$1`,
    [KEY_REFEREE],
  );
  return {
    referrerCents: r?.value_int ?? 1000,
    refereeCents: f?.value_int ?? 1000,
  };
}

export async function setDriverReferralOfferCents(params: {
  referrerCents: number;
  refereeCents: number;
}): Promise<void> {
  await query(
    `INSERT INTO referral_offer_config (key, value_int, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_int = EXCLUDED.value_int, updated_at = NOW()`,
    [KEY_REFERRER, params.referrerCents],
  );
  await query(
    `INSERT INTO referral_offer_config (key, value_int, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_int = EXCLUDED.value_int, updated_at = NOW()`,
    [KEY_REFEREE, params.refereeCents],
  );
}

export async function createDriverReferral(params: {
  referrerStudentId: string;
  refereeEmail: string;
}): Promise<{ inviteCode: string; shareUrl: string }> {
  const existing = await queryOne<{ invite_code: string }>(
    `SELECT invite_code FROM driver_referrals
     WHERE referrer_student_id=$1 AND LOWER(referee_email)=LOWER($2)`,
    [params.referrerStudentId, params.refereeEmail],
  );

  if (existing) {
    return {
      inviteCode: existing.invite_code,
      shareUrl: `https://vecta.io/drive?ref=${existing.invite_code}`,
    };
  }

  const referral = await queryOne<{ invite_code: string }>(
    `
    INSERT INTO driver_referrals (referrer_student_id, referee_email)
    VALUES ($1, $2)
    RETURNING invite_code
  `,
    [params.referrerStudentId, params.refereeEmail],
  );

  const inviteCode = referral!.invite_code;

  return {
    inviteCode,
    shareUrl: `https://vecta.io/drive?ref=${inviteCode}`,
  };
}

export async function createGenericDriverInvite(
  referrerStudentId: string,
): Promise<{ inviteCode: string; shareUrl: string; shareMessage: string }> {
  const { referrerCents, refereeCents } = await getDriverReferralOfferCents();
  const refD = (referrerCents / 100).toFixed(0);
  const refDD = (refereeCents / 100).toFixed(0);

  const referral = await queryOne<{ invite_code: string }>(
    `
    INSERT INTO driver_referrals (referrer_student_id, referee_email)
    VALUES ($1, 'generic')
    RETURNING invite_code
  `,
    [referrerStudentId],
  );

  const inviteCode = referral!.invite_code;
  const shareUrl = `https://vecta.io/drive?ref=${inviteCode}`;

  const shareMessage = [
    `🚗 Earn money driving with Vecta!`,
    ``,
    `I use Vecta for rides on campus. They need drivers`,
    `and you keep 90% of every fare.`,
    ``,
    `Sign up as a driver here:`,
    shareUrl,
    ``,
    `Referrer earns $${refD} Vecta credit and new drivers earn $${refDD} after their first completed ride. 🎉`,
  ].join('\n');

  return { inviteCode, shareUrl, shareMessage };
}

async function creditStudentLedger(
  client: PoolClient,
  studentId: string,
  amountCents: number,
  description: string,
): Promise<void> {
  const riderAccount = await client.query(
    `SELECT la.id,
            (SELECT COALESCE(MAX(balance_after_cents), 0)
             FROM ledger_entries WHERE account_id = la.id)::text AS balance
     FROM ledger_accounts la
     WHERE la.student_id = $1`,
    [studentId],
  );

  let accountId: string;
  let currentBalance: number;

  if (!riderAccount.rows[0]) {
    const newAccount = await client.query(
      `INSERT INTO ledger_accounts
         (student_id, account_number, routing_number, account_type, status, currency)
       VALUES ($1, 'V' || replace(gen_random_uuid()::text, '-', ''), '021000021', 'CHECKING', 'ACTIVE', 'USD')
       RETURNING id`,
      [studentId],
    );
    accountId = newAccount.rows[0]!.id;
    currentBalance = 0;
  } else {
    accountId = riderAccount.rows[0]!.id;
    currentBalance = Number.parseInt(riderAccount.rows[0]!.balance, 10);
    if (!Number.isFinite(currentBalance)) currentBalance = 0;
  }

  await client.query(
    `
    INSERT INTO ledger_entries (
      transaction_id, account_id, entry_type,
      amount_cents, balance_after_cents, description, status
    ) VALUES (gen_random_uuid(), $1, 'CREDIT', $2::bigint, $3::bigint, $4, 'POSTED')
  `,
    [accountId, amountCents, currentBalance + amountCents, description],
  );
}

/** Called when a referred driver completes their first ride (after ride is committed). */
export async function processReferralForDriverFirstRide(
  driverStudentId: string,
  inviteCode: string,
): Promise<void> {
  const code = inviteCode.trim().toUpperCase();
  const { referrerCents, refereeCents } = await getDriverReferralOfferCents();

  await withTransaction(async (client) => {
    const referral = await client.query(
      `SELECT * FROM driver_referrals
       WHERE UPPER(invite_code)=UPPER($1) AND referee_student_id=$2 AND status='SIGNED_UP'
       FOR UPDATE`,
      [code, driverStudentId],
    );

    if (!referral.rows[0]) return;

    const r = referral.rows[0] as { referrer_student_id: string; referee_student_id: string };

    await client.query(
      `UPDATE driver_referrals
       SET status='COMPLETED', completed_at=NOW()
       WHERE UPPER(invite_code)=UPPER($1) AND referee_student_id=$2`,
      [code, driverStudentId],
    );

    await creditStudentLedger(
      client,
      r.referrer_student_id,
      referrerCents,
      `Driver referral bonus — $${(referrerCents / 100).toFixed(2)}`,
    );
    await creditStudentLedger(
      client,
      r.referee_student_id,
      refereeCents,
      `New driver referral welcome — $${(refereeCents / 100).toFixed(2)}`,
    );

    await client.query(
      `UPDATE driver_referrals
       SET status='CREDITED',
           referrer_credited_at=NOW(),
           referee_credited_at=NOW()
       WHERE UPPER(invite_code)=UPPER($1) AND referee_student_id=$2`,
      [code, driverStudentId],
    );

    logger.info(
      { inviteCode: code, referrerId: r.referrer_student_id, driverStudentId },
      'Referral credited',
    );
  });
}
