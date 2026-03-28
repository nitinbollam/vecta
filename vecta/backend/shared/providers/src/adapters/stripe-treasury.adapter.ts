/**
 * packages/providers/src/adapters/stripe-treasury.adapter.ts
 *
 * Stripe Treasury implementation of BankingProvider.
 * Hot standby for Unit.co. Swap with BANKING_PROVIDER=stripe.
 *
 * Key differences from Unit.co:
 *   - Financial accounts (not DDA) — functionally identical for students
 *   - KYC via Stripe Identity (separate product)
 *   - No routing/account numbers until KYC cleared
 *
 * Schema impact: NONE. The BankingProvider interface is identical.
 */

import type { BankingProvider, BankAccount } from '../interfaces';
import { createLogger } from '@vecta/logger';

const logger = createLogger('stripe-treasury-adapter');
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY ?? '';

async function stripeReq<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
  const params = body && method === 'GET'
    ? `?${new URLSearchParams(body as Record<string, string>).toString()}`
    : '';

  const res = await fetch(`https://api.stripe.com/v1${path}${params}`, {
    method,
    headers: {
      Authorization:  `Bearer ${STRIPE_KEY}`,
      'Content-Type': method !== 'GET' ? 'application/x-www-form-urlencoded' : '',
      'Stripe-Version': '2024-06-20',
    },
    ...(body && method !== 'GET'
      ? { body: new URLSearchParams(body as Record<string, string>).toString() }
      : {}),
  });

  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } };
    throw new Error(`Stripe ${method} ${path} → ${res.status}: ${err.error?.message ?? 'unknown'}`);
  }

  return res.json() as Promise<T>;
}

function mapStripeKYC(status: string): BankAccount['kycStatus'] {
  switch (status) {
    case 'verified':    return 'APPROVED';
    case 'processing':  return 'PENDING';
    case 'requires_input': return 'NEEDS_REVIEW';
    case 'unverified':  return 'REJECTED';
    default:            return 'PENDING';
  }
}

export class StripeTreasuryAdapter implements BankingProvider {
  readonly name           = 'Stripe Treasury';
  readonly supportsNoSSN  = true;   // Stripe accepts passport via Stripe Identity

  async provision(studentId: string, passport: {
    firstName: string; lastName: string; dateOfBirth: string;
    passportNumber: string; issuingCountry: string;
  }): Promise<BankAccount> {
    // 1. Create connected account (individual)
    const account = await stripeReq<{ id: string }>('POST', '/accounts', {
      type:          'custom',
      country:       'US',
      capabilities:  JSON.stringify({ treasury: { requested: true } }),
      individual: JSON.stringify({
        first_name:    passport.firstName,
        last_name:     passport.lastName,
        dob:           { day: 1, month: 1, year: parseInt(passport.dateOfBirth.slice(0, 4)) },
      }),
      metadata: JSON.stringify({ vecta_student_id: studentId }),
    });

    // 2. Create financial account
    const fa = await stripeReq<{ id: string; status: string; financial_addresses: Array<{ aba?: { routing_number?: string; account_number?: string } }> }>(
      'POST', '/treasury/financial_accounts',
      {
        supported_currencies: JSON.stringify(['usd']),
        features: JSON.stringify({ financial_addresses: { aba: { requested: true } } }),
      },
    );

    const aba = fa.financial_addresses[0]?.aba;

    logger.info({ studentId, accountId: fa.id }, 'Stripe Treasury account provisioned');

    return {
      accountId:    fa.id,
      routingNumber: aba?.routing_number ?? '',
      accountNumber: aba?.account_number ?? '',
      status:        fa.status === 'open' ? 'ACTIVE' : 'PENDING',
      kycStatus:    'PENDING',  // Identity verification is async
      availableUsd: 0,
      currency:     'USD',
      providerName: this.name,
      providerRefId: account.id,
    };
  }

  async getKYCStatus(providerRefId: string): Promise<BankAccount['kycStatus']> {
    const account = await stripeReq<{
      individual?: { verification?: { status?: string } };
    }>('GET', `/accounts/${providerRefId}`);
    return mapStripeKYC(account.individual?.verification?.status ?? 'processing');
  }

  async getBalance(providerRefId: string): Promise<{ available: number; pending: number }> {
    // Financial account balance
    const fas = await stripeReq<{ data: Array<{ id: string; balance: { cash: { usd?: number } } }> }>(
      'GET', '/treasury/financial_accounts',
      { account: providerRefId },
    );
    const fa = fas.data[0];
    if (!fa) return { available: 0, pending: 0 };
    return { available: (fa.balance.cash.usd ?? 0) / 100, pending: 0 };
  }

  async getTransactions(providerRefId: string, limit: number) {
    const txs = await stripeReq<{ data: Array<{
      id: string; created: number; description: string;
      amount: number; flow_type: string; status: string;
    }> }>(
      'GET', '/treasury/transactions',
      { financial_account: providerRefId, limit: String(limit) },
    );

    return txs.data.map((tx) => ({
      id:          tx.id,
      date:        new Date(tx.created * 1000).toISOString().slice(0, 10),
      description: tx.description ?? '',
      amountCents: tx.amount,
      direction:   (tx.amount > 0 ? 'CREDIT' : 'DEBIT') as 'CREDIT' | 'DEBIT',
      status:      (tx.status === 'posted' ? 'CLEARED' : 'PENDING') as 'PENDING' | 'CLEARED' | 'RETURNED',
    }));
  }

  async handleWebhook(payload: unknown, _signature: string) {
    const p = payload as { type?: string; data?: { object?: { customer?: string; verification?: { status?: string } } } };
    if (p.type === 'identity.verification_session.verified') {
      return {
        type:      'KYC_STATUS_CHANGED' as const,
        customerId: p.data?.object?.customer,
        kycStatus: 'APPROVED' as const,
      };
    }
    return { type: 'UNKNOWN' as const };
  }
}
