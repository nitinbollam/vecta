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
export type TransactionCategory = 'RENT_INCOME' | 'ESIM_TOPUP' | 'BANK_TRANSFER' | 'CARD_PAYMENT' | 'FEE' | 'OTHER';
export interface TransactionLine {
    id: string;
    date: string;
    description: string;
    amountCents: number;
    balanceCents: number;
    category: TransactionCategory;
    direction: 'CREDIT' | 'DEBIT';
    status: 'PENDING' | 'CLEARED' | 'RETURNED';
}
export declare function getStudentTransactions(studentId: string, options?: {
    limit?: number;
    offset?: number;
    since?: string;
}): Promise<{
    transactions: TransactionLine[];
    totalCount: number;
}>;
//# sourceMappingURL=unit-transactions.service.d.ts.map