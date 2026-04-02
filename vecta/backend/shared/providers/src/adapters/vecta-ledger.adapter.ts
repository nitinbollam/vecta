/**
 * backend/shared/providers/src/adapters/vecta-ledger.adapter.ts
 *
 * Thin BankingProvider adapter wrapping VectaLedger.
 * Implements the same interface as Unit.co for seamless failover.
 */

import type { BankingProvider, BankAccount } from '../interfaces';
import { importBankingServiceModule } from './runtime-service-import';

export class VectaLedgerAdapter implements BankingProvider {
  readonly name = 'vecta-ledger';
  readonly supportsNoSSN = true;

  async provision(
    studentId: string,
    _passport: {
      firstName: string;
      lastName: string;
      dateOfBirth: string;
      passportNumber: string;
      issuingCountry: string;
    },
  ): Promise<BankAccount> {
    const mod = await importBankingServiceModule('vecta-ledger.service');
    const VectaLedger = mod.VectaLedger as new (
      deps: { query: unknown; transaction: unknown },
      column?: unknown,
    ) => {
      createAccount: (id: string) => Promise<{
        id: string;
        accountNumber: string;
        routingNumber: string;
        status: string;
      }>;
    };
    const { ColumnBankAdapter } = await import('./column.adapter');
    const { query, withTransaction } = await import('@vecta/database');

    const ledger = new VectaLedger({ query, transaction: withTransaction }, new ColumnBankAdapter());
    const account = await ledger.createAccount(studentId);

    const status: BankAccount['status'] =
      account.status === 'ACTIVE'
        ? 'ACTIVE'
        : account.status === 'FROZEN'
          ? 'FROZEN'
          : account.status === 'CLOSED'
            ? 'CLOSED'
            : 'PENDING';

    return {
      accountId:       account.id,
      routingNumber:   account.routingNumber,
      accountNumber:   account.accountNumber,
      status,
      kycStatus:       'APPROVED',
      availableUsd:    0,
      currency:        'USD',
      providerName:    this.name,
      providerRefId:   account.id,
    };
  }

  async getKYCStatus(studentId: string): Promise<BankAccount['kycStatus']> {
    const { query } = await import('@vecta/database');
    const result = await query('SELECT kyc_status FROM students WHERE id = $1', [studentId]);
    const raw = String(result.rows[0]?.kyc_status ?? 'PENDING').toUpperCase();
    if (raw === 'APPROVED') return 'APPROVED';
    if (raw === 'REJECTED') return 'REJECTED';
    if (raw === 'NEEDS_REVIEW' || raw === 'NEEDS REVIEW') return 'NEEDS_REVIEW';
    return 'PENDING';
  }

  async getBalance(accountId: string): Promise<{ available: number; pending: number }> {
    const mod = await importBankingServiceModule('vecta-ledger.service');
    const VectaLedger = mod.VectaLedger as new (deps: {
      query: unknown;
      transaction: unknown;
    }) => {
      getBalance: (id: string) => Promise<{ availableCents: number; pendingCents: number }>;
    };
    const { query, withTransaction } = await import('@vecta/database');
    const ledger  = new VectaLedger({ query, transaction: withTransaction });
    const balance = await ledger.getBalance(accountId);
    return {
      available: balance.availableCents / 100,
      pending:   balance.pendingCents / 100,
    };
  }

  async getTransactions(
    accountId: string,
    limit: number,
  ): Promise<Array<{
    id: string;
    date: string;
    description: string;
    amountCents: number;
    direction: 'CREDIT' | 'DEBIT';
    status: 'PENDING' | 'CLEARED' | 'RETURNED';
  }>> {
    const mod = await importBankingServiceModule('vecta-ledger.service');
    const VectaLedger = mod.VectaLedger as new (deps: {
      query: unknown;
      transaction: unknown;
    }) => {
      getTransactions: (
        id: string,
        lim?: number,
      ) => Promise<
        Array<{
          id: string;
          createdAt: Date;
          description: string;
          amountCents: number;
          entryType: string;
          status: string;
        }>
      >;
    };
    const { query, withTransaction } = await import('@vecta/database');
    const ledger = new VectaLedger({ query, transaction: withTransaction });
    const rows   = await ledger.getTransactions(accountId, limit);
    return rows.map((tx) => ({
      id:          tx.id,
      date:        tx.createdAt.toISOString().slice(0, 10),
      description: tx.description,
      amountCents: tx.amountCents,
      direction:   tx.entryType === 'CREDIT' ? 'CREDIT' : 'DEBIT',
      status:
        tx.status === 'POSTED' ? 'CLEARED' : tx.status === 'PENDING' ? 'PENDING' : 'RETURNED',
    }));
  }

  async handleWebhook(
    _payload: unknown,
    _signature: string,
  ): Promise<{
    type: 'KYC_STATUS_CHANGED' | 'TRANSACTION_SETTLED' | 'CARD_ISSUED' | 'UNKNOWN';
    customerId?: string;
    kycStatus?: BankAccount['kycStatus'];
  }> {
    return { type: 'UNKNOWN' };
  }
}
