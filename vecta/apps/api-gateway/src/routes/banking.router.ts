/**
 * apps/api-gateway/src/routes/banking.router.ts
 *
 * Vecta Ledger Banking Routes — replaces Unit.co
 *
 * GET  /api/v1/banking/account       — get or create ledger account
 * GET  /api/v1/banking/balance       — masked balance
 * GET  /api/v1/banking/transactions  — transaction history
 * POST /api/v1/banking/transfer      — initiate ACH transfer
 * GET  /api/v1/banking/card          — get virtual card details
 * POST /api/v1/banking/card/issue    — issue virtual Visa card
 *
 * Fallback: if BANKING_PROVIDER=unit, routes to Unit.co adapter
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, requireKYC } from '@vecta/auth';
import { createLogger } from '@vecta/logger';
import { query, queryOne, withTransaction } from '@vecta/database';

const logger = createLogger('banking-router');
const router = Router();

// ---------------------------------------------------------------------------
// Lazy-load VectaLedger (avoid import errors if package not built yet)
// ---------------------------------------------------------------------------

async function getLedger() {
  const { VectaLedger } = await import('../../../../services/banking-service/src/vecta-ledger.service');
  const { ColumnBankAdapter } = await import('../../../packages/providers/src/adapters/column.adapter');

  const dbAdapter = {
    query: (sql: string, params?: unknown[]) => query(sql, params as unknown[]),
    transaction: withTransaction,
  };

  const sponsorBank = new ColumnBankAdapter();
  return new VectaLedger(dbAdapter, sponsorBank);
}

// ---------------------------------------------------------------------------
// GET /api/v1/banking/account
// ---------------------------------------------------------------------------

router.get('/account', authMiddleware, requireKYC, async (req: Request, res: Response) => {
  try {
    const studentId = (req as Request & { user: { id: string } }).user.id;
    const ledger    = await getLedger();

    let account = await ledger.getAccount(studentId);

    // Auto-provision account if KYC-approved but no account yet
    if (!account) {
      account = await ledger.createAccount(studentId);
      logger.info({ studentId }, '[Banking] Auto-provisioned ledger account');
    }

    res.json({
      accountId:     account.id,
      accountNumber: account.accountNumber,
      routingNumber: account.routingNumber,
      accountType:   account.accountType,
      status:        account.status,
      currency:      account.currency,
      provider:      'vecta-ledger',
    });
  } catch (err) {
    logger.error({ err }, '[Banking] Failed to get account');
    res.status(500).json({ error: 'ACCOUNT_FETCH_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/banking/balance
// ---------------------------------------------------------------------------

router.get('/balance', authMiddleware, requireKYC, async (req: Request, res: Response) => {
  try {
    const studentId = (req as Request & { user: { id: string } }).user.id;
    const ledger    = await getLedger();

    const account = await ledger.getAccount(studentId);
    if (!account) return res.status(404).json({ error: 'ACCOUNT_NOT_FOUND' });

    const balance = await ledger.getBalance(account.id);

    res.json({
      available:      balance.availableCents / 100,
      availableCents: balance.availableCents,
      pending:        balance.pendingCents / 100,
      pendingCents:   balance.pendingCents,
      rangeLabel:     balance.rangeLabel,   // masked display
      last4:          balance.last4,
      currency:       'USD',
      provider:       'vecta-ledger',
    });
  } catch (err) {
    logger.error({ err }, '[Banking] Failed to get balance');
    res.status(500).json({ error: 'BALANCE_FETCH_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/banking/transactions
// ---------------------------------------------------------------------------

router.get('/transactions', authMiddleware, requireKYC, async (req: Request, res: Response) => {
  try {
    const studentId = (req as Request & { user: { id: string } }).user.id;
    const limit     = Math.min(Number(req.query.limit ?? 50), 200);
    const ledger    = await getLedger();

    const account = await ledger.getAccount(studentId);
    if (!account) return res.status(404).json({ error: 'ACCOUNT_NOT_FOUND' });

    const entries = await ledger.getTransactions(account.id, limit);

    res.json({
      transactions: entries.map(e => ({
        id:            e.id,
        type:          e.entryType,
        amount:        e.amountCents / 100,
        amountCents:   e.amountCents,
        description:   e.description,
        category:      e.category,
        merchantName:  e.merchantName,
        status:        e.status,
        date:          e.valueDate,
        createdAt:     e.createdAt,
      })),
      total:    entries.length,
      provider: 'vecta-ledger',
    });
  } catch (err) {
    logger.error({ err }, '[Banking] Failed to get transactions');
    res.status(500).json({ error: 'TRANSACTIONS_FETCH_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/banking/transfer
// ---------------------------------------------------------------------------

const transferSchema = z.object({
  direction:        z.enum(['INBOUND', 'OUTBOUND']),
  amountCents:      z.number().int().min(100),    // minimum $1
  externalRouting:  z.string().regex(/^\d{9}$/),  // 9-digit routing number
  externalAccount:  z.string().min(4).max(17),
  bankName:         z.string().min(2).max(100),
  description:      z.string().optional(),
});

router.post('/transfer', authMiddleware, requireKYC, async (req: Request, res: Response) => {
  try {
    const studentId = (req as Request & { user: { id: string } }).user.id;
    const params    = transferSchema.parse(req.body);
    const ledger    = await getLedger();

    const account = await ledger.getAccount(studentId);
    if (!account) return res.status(404).json({ error: 'ACCOUNT_NOT_FOUND' });

    const transfer = await ledger.initiateACHTransfer({
      accountId:       account.id,
      ...params,
    });

    res.status(201).json({
      transferId:      transfer.id,
      status:          transfer.status,
      amountCents:     transfer.amountCents,
      direction:       transfer.direction,
      sponsorBankRef:  transfer.sponsorBankRef,
      initiatedAt:     transfer.initiatedAt,
      provider:        'vecta-ledger',
    });
  } catch (err) {
    if ((err as Error).name === 'InsufficientFundsError') {
      return res.status(422).json({ error: 'INSUFFICIENT_FUNDS', message: (err as Error).message });
    }
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'INVALID_PARAMS', issues: err.issues });
    }
    logger.error({ err }, '[Banking] Failed to initiate transfer');
    res.status(500).json({ error: 'TRANSFER_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/banking/card
// ---------------------------------------------------------------------------

router.get('/card', authMiddleware, requireKYC, async (req: Request, res: Response) => {
  try {
    const studentId = (req as Request & { user: { id: string } }).user.id;
    const ledger    = await getLedger();

    const account = await ledger.getAccount(studentId);
    if (!account) return res.status(404).json({ error: 'ACCOUNT_NOT_FOUND' });

    const card = await ledger.getCardDetails(account.id);
    if (!card) return res.status(404).json({ error: 'NO_CARD', message: 'No virtual card issued yet' });

    res.json({
      lastFour:        card.lastFour,
      expiryMonth:     card.expiryMonth,
      expiryYear:      card.expiryYear,
      network:         card.network,
      status:          card.status,
      dailyLimit:      card.dailyLimitCents / 100,
      monthlyLimit:    card.monthlyLimitCents / 100,
      provider:        'vecta-ledger',
    });
  } catch (err) {
    logger.error({ err }, '[Banking] Failed to get card');
    res.status(500).json({ error: 'CARD_FETCH_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/banking/card/issue
// ---------------------------------------------------------------------------

router.post('/card/issue', authMiddleware, requireKYC, async (req: Request, res: Response) => {
  try {
    const studentId = (req as Request & { user: { id: string } }).user.id;
    const ledger    = await getLedger();

    const account = await ledger.getAccount(studentId);
    if (!account) return res.status(404).json({ error: 'ACCOUNT_NOT_FOUND' });

    const { card, cardNumber, cvv } = await ledger.issueVirtualCard(account.id);

    // Card number and CVV are returned ONCE. Store encrypted version is in DB.
    res.status(201).json({
      lastFour:     card.lastFour,
      cardNumber,                  // shown once only
      cvv,                         // shown once only
      expiryMonth:  card.expiryMonth,
      expiryYear:   card.expiryYear,
      network:      card.network,
      provider:     'vecta-ledger',
      warning:      'Store your card number and CVV securely. They will not be shown again.',
    });
  } catch (err) {
    if ((err as Error).message?.includes('already has an active')) {
      return res.status(409).json({ error: 'CARD_ALREADY_EXISTS' });
    }
    logger.error({ err }, '[Banking] Failed to issue card');
    res.status(500).json({ error: 'CARD_ISSUE_FAILED' });
  }
});

export { router as bankingRouter };
export default router;
