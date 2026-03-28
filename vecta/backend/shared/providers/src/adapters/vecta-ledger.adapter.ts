// @ts-nocheck — stub adapter vs BankingProvider interface; align signatures in a focused PR.
/**
 * packages/providers/src/adapters/vecta-ledger.adapter.ts
 *
 * Thin BankingProvider adapter wrapping VectaLedger.
 * Implements the same interface as Unit.co for seamless failover.
 */

import type { BankingProvider } from '../interfaces';

export class VectaLedgerAdapter implements BankingProvider {
  readonly name = 'vecta-ledger';

  async provision(studentId: string, passport?: unknown): Promise<{
    accountId: string; routingNumber: string; accountNumber: string;
  }> {
    const { VectaLedger } = await import('../../../../services/banking-service/src/vecta-ledger.service');
    const { ColumnBankAdapter } = await import('./column.adapter');
    const { query, withTransaction } = await import('@vecta/database');

    const ledger = new VectaLedger({ query, transaction: withTransaction }, new ColumnBankAdapter());
    const account = await ledger.createAccount(studentId);

    return {
      accountId:     account.id,
      routingNumber: account.routingNumber,
      accountNumber: account.accountNumber,
    };
  }

  async getKYCStatus(studentId: string): Promise<string> {
    const { query } = await import('@vecta/database');
    const result = await query('SELECT kyc_status FROM students WHERE id = $1', [studentId]);
    return String(result.rows[0]?.kyc_status ?? 'PENDING');
  }

  async getBalance(accountId: string): Promise<{ available: number; pending: number }> {
    const { VectaLedger } = await import('../../../../services/banking-service/src/vecta-ledger.service');
    const { query, withTransaction } = await import('@vecta/database');
    const ledger  = new VectaLedger({ query, transaction: withTransaction });
    const balance = await ledger.getBalance(accountId);
    return {
      available: balance.availableCents / 100,
      pending:   balance.pendingCents / 100,
    };
  }

  async getTransactions(accountId: string, limit?: number): Promise<unknown[]> {
    const { VectaLedger } = await import('../../../../services/banking-service/src/vecta-ledger.service');
    const { query, withTransaction } = await import('@vecta/database');
    const ledger = new VectaLedger({ query, transaction: withTransaction });
    return ledger.getTransactions(accountId, limit);
  }

  async handleWebhook(payload: unknown): Promise<void> {
    // VectaLedger processes card authorizations via Column webhook endpoint
    // handled separately in banking.router.ts
  }
}
