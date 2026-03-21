/**
 * services/identity-service/src/unit-transactions.service.ts
 *
 * Fetch and categorize Unit.co DDA transactions for the student banking screen.
 *
 * Privacy:
 *   - Transactions are only returned to the authenticated student (never to landlords)
 *   - Counterparty names truncated if > 40 chars (prevents employer identification)
 *   - No transactions endpoint is exposed on the landlord verification portal
 *
 * Categories (heuristic from transaction description):
 *   RENT_INCOME     — Vecta fleet rental income credits
 *   ESIM_TOPUP      — eSIM balance top-up
 *   BANK_TRANSFER   — ACH incoming/outgoing
 *   CARD_PAYMENT    — debit card purchase
 *   FEE             — service fee
 *   OTHER
 */

import { decryptField } from '@vecta/crypto';
import { queryOne } from '@vecta/database';
import { createLogger } from '@vecta/logger';

const logger = createLogger('unit-transactions');

const UNIT_BASE_URL = process.env.UNIT_BASE_URL ?? 'https://api.unit.co';
const UNIT_API_TOKEN = process.env.UNIT_API_TOKEN ?? '';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TransactionCategory =
  | 'RENT_INCOME'
  | 'ESIM_TOPUP'
  | 'BANK_TRANSFER'
  | 'CARD_PAYMENT'
  | 'FEE'
  | 'OTHER';

export interface TransactionLine {
  id:           string;
  date:         string;         // ISO date
  description:  string;         // Sanitised counterparty / memo
  amountCents:  number;         // Positive = credit, negative = debit
  balanceCents: number;         // Running balance after transaction
  category:     TransactionCategory;
  direction:    'CREDIT' | 'DEBIT';
  status:       'PENDING' | 'CLEARED' | 'RETURNED';
}

// ---------------------------------------------------------------------------
// Fetch transactions from Unit.co API
// ---------------------------------------------------------------------------

async function unitGet<T>(path: string): Promise<T> {
  const res = await fetch(`${UNIT_BASE_URL}${path}`, {
    headers: {
      Authorization:  `Bearer ${UNIT_API_TOKEN}`,
      'Content-Type': 'application/vnd.api+json',
    },
  });

  if (!res.ok) {
    throw new Error(`Unit.co ${path} → ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Categorise by description heuristics
// ---------------------------------------------------------------------------

function categorize(description: string, direction: 'CREDIT' | 'DEBIT'): TransactionCategory {
  const d = description.toLowerCase();

  if (d.includes('vecta') || d.includes('rental income') || d.includes('lease-back')) {
    return 'RENT_INCOME';
  }
  if (d.includes('esim') || d.includes('sim') || d.includes('mobile')) {
    return 'ESIM_TOPUP';
  }
  if (d.includes('ach') || d.includes('wire') || d.includes('transfer')) {
    return 'BANK_TRANSFER';
  }
  if (direction === 'DEBIT' && (d.includes('purchase') || d.includes('pos') || d.includes('payment'))) {
    return 'CARD_PAYMENT';
  }
  if (d.includes('fee') || d.includes('charge')) {
    return 'FEE';
  }
  return 'OTHER';
}

// ---------------------------------------------------------------------------
// Sanitise description (truncate + remove PII patterns)
// ---------------------------------------------------------------------------

function sanitizeDescription(raw: string): string {
  // Remove common PII patterns (SSN-like, full account numbers)
  const cleaned = raw
    .replace(/\d{4}-\d{4}-\d{4}-\d{4}/g, '****')    // card numbers
    .replace(/\b\d{9,17}\b/g, '****')                  // account numbers
    .trim();

  return cleaned.length > 40 ? cleaned.slice(0, 37) + '…' : cleaned;
}

// ---------------------------------------------------------------------------
// Main: get transactions for a student
// ---------------------------------------------------------------------------

export async function getStudentTransactions(
  studentId: string,
  options: {
    limit?:  number;
    offset?: number;
    since?:  string;   // ISO date — filter transactions after this date
  } = {},
): Promise<{ transactions: TransactionLine[]; totalCount: number }> {
  // Get encrypted Unit account ID
  const row = await queryOne<{ unit_account_id_enc: string }>(
    'SELECT unit_account_id_enc FROM students WHERE id = $1',
    [studentId],
  );

  if (!row?.unit_account_id_enc) {
    return { transactions: [], totalCount: 0 };
  }

  const accountId = await decryptField(row.unit_account_id_enc);

  const limit  = options.limit  ?? 20;
  const offset = options.offset ?? 0;
  const since  = options.since  ?? '';

  const qp = new URLSearchParams({
    'filter[accountId]': accountId,
    'page[limit]':       String(limit),
    'page[offset]':      String(offset),
    'sort':              '-createdAt',
  });

  if (since) {
    qp.set('filter[since]', since);
  }

  const data = await unitGet<{
    data: Array<{
      id: string;
      type: string;
      attributes: {
        createdAt:   string;
        amount:      number;     // cents
        direction:   'Credit' | 'Debit';
        balance:     number;
        status:      string;
        description: string;
        summary?:    string;
      };
    }>;
    meta?: { totalCount?: number };
  }>(`/transactions?${qp.toString()}`);

  const transactions: TransactionLine[] = data.data.map((tx) => {
    const direction: 'CREDIT' | 'DEBIT' =
      tx.attributes.direction === 'Credit' ? 'CREDIT' : 'DEBIT';

    const rawDescription = tx.attributes.summary ?? tx.attributes.description ?? '';
    const description    = sanitizeDescription(rawDescription);

    return {
      id:           tx.id,
      date:         tx.attributes.createdAt.slice(0, 10),
      description,
      amountCents:  direction === 'CREDIT' ? tx.attributes.amount : -tx.attributes.amount,
      balanceCents: tx.attributes.balance,
      category:     categorize(description, direction),
      direction,
      status:
        tx.attributes.status === 'Pending'  ? 'PENDING'  :
        tx.attributes.status === 'Returned' ? 'RETURNED' :
        'CLEARED',
    };
  });

  logger.info(
    { studentId, count: transactions.length },
    'Transactions fetched',
  );

  return {
    transactions,
    totalCount: data.meta?.totalCount ?? transactions.length,
  };
}
