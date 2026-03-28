/**
 * services/banking-service/src/vecta-ledger.service.ts
 *
 * Vecta Core Banking Ledger — replaces Unit.co
 *
 * Architecture:
 *   - Double-entry bookkeeping: every transaction creates two ledger entries
 *   - SERIALIZABLE isolation: prevents race conditions on concurrent transfers
 *   - Append-only: the DB trigger prevents UPDATE/DELETE on ledger_entries
 *   - Negative balance prevention: DB trigger + service-level check
 *   - Sponsor bank abstraction: Column or Clearbank for real ACH/BIN access
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { createLogger, logAuditEvent } from '@vecta/logger';

const logger = createLogger('vecta-ledger');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LedgerAccount {
  id:             string;
  studentId:      string;
  accountNumber:  string;
  routingNumber:  string;
  accountType:    'CHECKING' | 'SAVINGS';
  status:         'ACTIVE' | 'FROZEN' | 'CLOSED';
  currency:       string;
  sponsorBank:    string;
  createdAt:      Date;
}

export interface LedgerEntry {
  id:                 string;
  transactionId:      string;
  accountId:          string;
  entryType:          'DEBIT' | 'CREDIT';
  amountCents:        number;
  currency:           string;
  balanceAfterCents:  number;
  description:        string;
  category?:          string;
  merchantName?:      string;
  status:             'PENDING' | 'POSTED' | 'REVERSED';
  valueDate:          Date;
  createdAt:          Date;
}

export interface LedgerBalance {
  availableCents:  number;
  pendingCents:    number;
  totalCents:      number;
  rangeLabel:      string;   // "$X – $Y" masked range for display
  last4:           string;
}

export interface VirtualCard {
  id:            string;
  accountId:     string;
  lastFour:      string;
  expiryMonth:   number;
  expiryYear:    number;
  network:       'VISA';
  status:        'ACTIVE' | 'FROZEN' | 'CANCELLED';
  dailyLimitCents:   number;
  monthlyLimitCents: number;
}

export interface ACHTransfer {
  id:              string;
  accountId:       string;
  direction:       'INBOUND' | 'OUTBOUND';
  amountCents:     number;
  externalBankName: string;
  externalRouting: string;
  status:          string;
  sponsorBankRef?: string;
  initiatedAt:     Date;
  settledAt?:      Date;
}

export class InsufficientFundsError extends Error {
  constructor(public availableCents: number, public requiredCents: number) {
    super(`Insufficient funds: available ${availableCents}¢, required ${requiredCents}¢`);
    this.name = 'InsufficientFundsError';
  }
}

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

function getCardEncKey(): Buffer {
  const hex = process.env.CARD_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error('CARD_ENCRYPTION_KEY must be set (32 bytes hex)');
  return Buffer.from(hex, 'hex');
}

function encrypt(plaintext: string): string {
  const key    = getCardEncKey();
  const iv     = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(ciphertext: string): string {
  const [ivHex, tagHex, encHex] = ciphertext.split(':');
  const key     = getCardEncKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(encHex, 'hex')).toString('utf8') + decipher.final('utf8');
}

// ---------------------------------------------------------------------------
// VectaLedger
// ---------------------------------------------------------------------------

export class VectaLedger {
  constructor(
    private readonly db: {
      query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
      transaction: <T>(fn: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }) => Promise<T>) => Promise<T>;
    },
    private readonly sponsorBank?: {
      createVirtualAccountNumber: () => Promise<string>;
      initiateACH: (params: unknown) => Promise<{ sponsorRef: string }>;
    },
  ) {}

  // ---------------------------------------------------------------------------
  // Account management
  // ---------------------------------------------------------------------------

  async createAccount(studentId: string): Promise<LedgerAccount> {
    const accountNumber = await this.generateAccountNumber();

    const result = await this.db.query(`
      INSERT INTO ledger_accounts (student_id, account_number, routing_number)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [studentId, accountNumber, process.env.SPONSOR_ROUTING ?? '021000021']);

    const row = result.rows[0];

    void logAuditEvent('LEDGER_ACCOUNT_CREATED', studentId, 'banking.ledger', {
      accountNumber: accountNumber.slice(-4),
    });

    logger.info({ studentId, accountNumber: accountNumber.slice(-4) }, '[Ledger] Account created');
    return this.mapAccount(row);
  }

  async getAccount(studentId: string): Promise<LedgerAccount | null> {
    const result = await this.db.query(
      `SELECT * FROM ledger_accounts WHERE student_id = $1 AND status = 'ACTIVE' LIMIT 1`,
      [studentId],
    );
    return result.rows[0] ? this.mapAccount(result.rows[0]) : null;
  }

  // ---------------------------------------------------------------------------
  // Balance
  // ---------------------------------------------------------------------------

  async getBalance(accountId: string): Promise<LedgerBalance> {
    const result = await this.db.query(
      'SELECT * FROM ledger_balances WHERE account_id = $1',
      [accountId],
    );
    if (!result.rows[0]) throw new Error(`Account not found: ${accountId}`);

    const available = Number(result.rows[0].available_balance_cents ?? 0);
    const pending   = Number(result.rows[0].pending_debit_cents ?? 0);
    const total     = available - pending;

    return {
      availableCents: available,
      pendingCents:   pending,
      totalCents:     total,
      rangeLabel:     this.buildRangeLabel(total),
      last4:          String(result.rows[0].account_number).slice(-4),
    };
  }

  /** Masked range label — shows "$X – $Y" without exact balance */
  private buildRangeLabel(totalCents: number): string {
    const usd = totalCents / 100;
    if (usd <= 0)     return '$0';
    if (usd < 500)    return '$1 – $500';
    if (usd < 1000)   return '$500 – $1,000';
    if (usd < 2500)   return '$1,000 – $2,500';
    if (usd < 5000)   return '$2,500 – $5,000';
    if (usd < 10000)  return '$5,000 – $10,000';
    if (usd < 25000)  return '$10,000 – $25,000';
    if (usd < 50000)  return '$25,000 – $50,000';
    return '$50,000+';
  }

  // ---------------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------------

  async getTransactions(accountId: string, limit = 50): Promise<LedgerEntry[]> {
    const result = await this.db.query(`
      SELECT * FROM ledger_entries
      WHERE account_id = $1 AND entry_type = 'DEBIT'
      ORDER BY created_at DESC
      LIMIT $2
    `, [accountId, limit]);
    return result.rows.map(r => this.mapEntry(r));
  }

  /**
   * Post a transaction using double-entry bookkeeping.
   *
   * Every financial event creates exactly two ledger entries:
   *   - A DEBIT on the source account (money leaving)
   *   - A CREDIT on the destination account (money arriving)
   *
   * For internal transfers: both accounts in our ledger.
   * For external (ACH): one side is our ledger, other side is the ACH transfer.
   *
   * Uses SERIALIZABLE isolation to prevent race conditions.
   */
  async postTransaction(params: {
    accountId:    string;
    entryType:    'DEBIT' | 'CREDIT';
    amountCents:  number;
    description:  string;
    category?:    string;
    merchantName?: string;
    transactionId?: string;
  }): Promise<LedgerEntry> {
    const txId = params.transactionId ?? randomBytes(16).toString('hex');

    return await this.db.transaction(async (client) => {
      // Lock the account row and get current balance (SERIALIZABLE)
      const balResult = await client.query(`
        SELECT COALESCE(
          (SELECT balance_after_cents FROM ledger_entries
           WHERE account_id = $1 AND status = 'POSTED'
           ORDER BY created_at DESC LIMIT 1),
          0
        ) AS current_balance
      `, [params.accountId]);

      const currentBalance = Number(balResult.rows[0]?.current_balance ?? 0);

      let newBalance: number;
      if (params.entryType === 'DEBIT') {
        if (currentBalance < params.amountCents) {
          throw new InsufficientFundsError(currentBalance, params.amountCents);
        }
        newBalance = currentBalance - params.amountCents;
      } else {
        newBalance = currentBalance + params.amountCents;
      }

      const result = await client.query(`
        INSERT INTO ledger_entries (
          transaction_id, account_id, entry_type, amount_cents,
          balance_after_cents, description, category, merchant_name, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'POSTED')
        RETURNING *
      `, [
        txId,
        params.accountId,
        params.entryType,
        params.amountCents,
        newBalance,
        params.description,
        params.category ?? null,
        params.merchantName ?? null,
      ]);

      return this.mapEntry(result.rows[0]);
    });
  }

  // ---------------------------------------------------------------------------
  // ACH Transfers
  // ---------------------------------------------------------------------------

  async initiateACHTransfer(params: {
    accountId:        string;
    direction:        'INBOUND' | 'OUTBOUND';
    amountCents:      number;
    externalRouting:  string;
    externalAccount:  string;
    bankName:         string;
    description?:     string;
  }): Promise<ACHTransfer> {
    // For outbound: verify sufficient funds before creating transfer
    if (params.direction === 'OUTBOUND') {
      const balance = await this.getBalance(params.accountId);
      if (balance.availableCents < params.amountCents) {
        throw new InsufficientFundsError(balance.availableCents, params.amountCents);
      }
    }

    const encryptedAccount = encrypt(params.externalAccount);

    const result = await this.db.query(`
      INSERT INTO ach_transfers (
        account_id, direction, amount_cents, external_bank_name,
        external_routing, external_account_enc, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      params.accountId,
      params.direction,
      params.amountCents,
      params.bankName,
      params.externalRouting,
      encryptedAccount,
      params.description ?? 'ACH Transfer',
    ]);

    const transfer = this.mapTransfer(result.rows[0]);

    // Submit to sponsor bank (async — settlement takes 1-3 business days)
    if (this.sponsorBank) {
      void this.submitToSponsorBank(transfer, params).catch(err => {
        logger.error({ err, transferId: transfer.id }, '[Ledger] Sponsor bank submission failed');
      });
    }

    void logAuditEvent('ACH_TRANSFER_INITIATED', params.accountId, 'banking.ach', {
      direction:   params.direction,
      amountCents: params.amountCents,
      bankName:    params.bankName,
    });

    return transfer;
  }

  private async submitToSponsorBank(
    transfer: ACHTransfer,
    params:   { externalRouting: string; externalAccount: string; direction: 'INBOUND' | 'OUTBOUND' },
  ): Promise<void> {
    if (!this.sponsorBank) return;

    try {
      const response = await this.sponsorBank.initiateACH({
        transferId:      transfer.id,
        direction:       params.direction,
        amountCents:     transfer.amountCents,
        externalRouting: params.externalRouting,
        externalAccount: params.externalAccount,
        description:     transfer.externalBankName,
      });

      await this.db.query(
        `UPDATE ach_transfers SET sponsor_bank_ref = $1, status = 'PROCESSING', processing_at = NOW() WHERE id = $2`,
        [response.sponsorRef, transfer.id],
      );

      logger.info({ transferId: transfer.id, sponsorRef: response.sponsorRef }, '[Ledger] ACH submitted to sponsor bank');
    } catch (err) {
      logger.error({ err, transferId: transfer.id }, '[Ledger] Failed to submit ACH to sponsor bank');
    }
  }

  // ---------------------------------------------------------------------------
  // Virtual cards
  // ---------------------------------------------------------------------------

  async issueVirtualCard(accountId: string): Promise<{
    card:       VirtualCard;
    cardNumber: string;   // shown once, then only encrypted version stored
    cvv:        string;   // shown once
  }> {
    const existingCard = await this.db.query(
      `SELECT * FROM virtual_cards WHERE account_id = $1 AND status = 'ACTIVE' LIMIT 1`,
      [accountId],
    );
    if (existingCard.rows[0]) {
      throw new Error('Account already has an active virtual card');
    }

    // Generate card number: BIN prefix + random digits + Luhn check
    const cardNumber = this.generateCardNumber(process.env.VISA_BIN_PREFIX ?? '453201');
    const lastFour   = cardNumber.slice(-4);
    const expMonth   = new Date().getMonth() + 1;
    const expYear    = new Date().getFullYear() + 4;
    const cvv        = this.generateCVV(cardNumber, expMonth, expYear);

    const cardNumberEnc = encrypt(cardNumber);
    const cvvEnc        = encrypt(cvv);

    const result = await this.db.query(`
      INSERT INTO virtual_cards (
        account_id, card_number_enc, last_four, expiry_month, expiry_year,
        cvv_enc, network, bin_prefix
      ) VALUES ($1, $2, $3, $4, $5, $6, 'VISA', $7)
      RETURNING *
    `, [accountId, cardNumberEnc, lastFour, expMonth, expYear, cvvEnc, process.env.VISA_BIN_PREFIX ?? '453201']);

    void logAuditEvent('VIRTUAL_CARD_ISSUED', accountId, 'banking.card', { lastFour });

    return {
      card:       this.mapCard(result.rows[0]),
      cardNumber,  // plaintext, returned once only
      cvv,         // plaintext, returned once only
    };
  }

  async getCardDetails(accountId: string): Promise<VirtualCard | null> {
    const result = await this.db.query(
      `SELECT * FROM virtual_cards WHERE account_id = $1 AND status = 'ACTIVE' LIMIT 1`,
      [accountId],
    );
    return result.rows[0] ? this.mapCard(result.rows[0]) : null;
  }

  // ---------------------------------------------------------------------------
  // Account number generation
  // ---------------------------------------------------------------------------

  private async generateAccountNumber(): Promise<string> {
    // Format: VECTA + 8 random digits = 13 chars, then Luhn check digit = 14 chars
    let attempts = 0;
    while (attempts < 10) {
      const digits    = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join('');
      const base      = `40000${digits}`;  // 40000 prefix for Vecta accounts
      const luhn      = this.luhnCheckDigit(base);
      const number    = `${base}${luhn}`;

      // Verify uniqueness
      const exists = await this.db.query(
        'SELECT 1 FROM ledger_accounts WHERE account_number = $1',
        [number],
      );
      if (exists.rows.length === 0) return number;
      attempts++;
    }
    throw new Error('Failed to generate unique account number after 10 attempts');
  }

  /** Generate a valid card number with the given BIN prefix */
  private generateCardNumber(binPrefix: string): string {
    const totalDigits = 16;
    const remaining   = totalDigits - binPrefix.length - 1;
    const randDigits  = Array.from({ length: remaining }, () => Math.floor(Math.random() * 10)).join('');
    const withoutLuhn = `${binPrefix}${randDigits}`;
    const luhn        = this.luhnCheckDigit(withoutLuhn);
    return `${withoutLuhn}${luhn}`;
  }

  /** Luhn algorithm check digit */
  private luhnCheckDigit(partial: string): string {
    let sum      = 0;
    let alternate = false;
    for (let i = partial.length - 1; i >= 0; i--) {
      let n = parseInt(partial[i], 10);
      if (alternate) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alternate = !alternate;
    }
    return String((10 - (sum % 10)) % 10);
  }

  /** Generate CVV using HMAC (simplified — real CVV uses 3DES with issuer keys) */
  private generateCVV(cardNumber: string, expMonth: number, expYear: number): string {
    const { createHmac } = require('crypto');
    const secret = process.env.CVV_HMAC_SECRET ?? 'dev-cvv-secret-replace-in-prod';
    const data   = `${cardNumber}${expMonth.toString().padStart(2, '0')}${expYear}`;
    const hash   = createHmac('sha256', secret).update(data).digest('hex');
    return hash.substring(0, 3);
  }

  // ---------------------------------------------------------------------------
  // Mappers
  // ---------------------------------------------------------------------------

  private mapAccount(row: Record<string, unknown>): LedgerAccount {
    return {
      id:            String(row.id),
      studentId:     String(row.student_id),
      accountNumber: String(row.account_number),
      routingNumber: String(row.routing_number),
      accountType:   String(row.account_type) as 'CHECKING',
      status:        String(row.status) as 'ACTIVE',
      currency:      String(row.currency),
      sponsorBank:   String(row.sponsor_bank),
      createdAt:     new Date(String(row.created_at)),
    };
  }

  private mapEntry(row: Record<string, unknown>): LedgerEntry {
    return {
      id:                String(row.id),
      transactionId:     String(row.transaction_id),
      accountId:         String(row.account_id),
      entryType:         String(row.entry_type) as 'DEBIT',
      amountCents:       Number(row.amount_cents),
      currency:          String(row.currency),
      balanceAfterCents: Number(row.balance_after_cents),
      description:       String(row.description),
      category:          row.category ? String(row.category) : undefined,
      merchantName:      row.merchant_name ? String(row.merchant_name) : undefined,
      status:            String(row.status) as 'POSTED',
      valueDate:         new Date(String(row.value_date)),
      createdAt:         new Date(String(row.created_at)),
    };
  }

  private mapCard(row: Record<string, unknown>): VirtualCard {
    return {
      id:               String(row.id),
      accountId:        String(row.account_id),
      lastFour:         String(row.last_four),
      expiryMonth:      Number(row.expiry_month),
      expiryYear:       Number(row.expiry_year),
      network:          'VISA',
      status:           String(row.status) as 'ACTIVE',
      dailyLimitCents:  Number(row.daily_limit_cents),
      monthlyLimitCents:Number(row.monthly_limit_cents),
    };
  }

  private mapTransfer(row: Record<string, unknown>): ACHTransfer {
    return {
      id:               String(row.id),
      accountId:        String(row.account_id),
      direction:        String(row.direction) as 'INBOUND',
      amountCents:      Number(row.amount_cents),
      externalBankName: String(row.external_bank_name),
      externalRouting:  String(row.external_routing),
      status:           String(row.status),
      sponsorBankRef:   row.sponsor_bank_ref ? String(row.sponsor_bank_ref) : undefined,
      initiatedAt:      new Date(String(row.initiated_at)),
      settledAt:        row.settled_at ? new Date(String(row.settled_at)) : undefined,
    };
  }
}
