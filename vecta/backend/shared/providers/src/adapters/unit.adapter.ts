/**
 * packages/providers/src/adapters/unit.adapter.ts
 *
 * Unit.co implementation of BankingProvider.
 * Wraps the existing unit.service.ts with the standardised interface.
 */

import type { BankingProvider, BankAccount } from '../interfaces';
import { createLogger } from '@vecta/logger';

const logger = createLogger('unit-adapter');
const BASE   = process.env.UNIT_BASE_URL   ?? 'https://api.unit.co';
const TOKEN  = process.env.UNIT_API_TOKEN  ?? '';

async function unitReq<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization:  `Bearer ${TOKEN}`,
      'Content-Type': 'application/vnd.api+json',
      Accept:         'application/vnd.api+json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Unit.co ${method} ${path} → ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

function mapUnitKYC(status: string): BankAccount['kycStatus'] {
  switch (status) {
    case 'Active':       return 'APPROVED';
    case 'Under Review': return 'NEEDS_REVIEW';
    case 'Archived':     return 'REJECTED';
    default:             return 'PENDING';
  }
}

export class UnitAdapter implements BankingProvider {
  readonly name              = 'Unit.co';
  readonly supportsNoSSN     = true;

  async provision(studentId: string, passport: {
    firstName: string; lastName: string; dateOfBirth: string;
    passportNumber: string; issuingCountry: string;
  }): Promise<BankAccount> {
    // Create individual customer
    const customer = await unitReq<{ data: { id: string; attributes: { status: string } } }>(
      'POST', '/customers',
      {
        data: {
          type: 'individualCustomer',
          attributes: {
            fullName:    { first: passport.firstName, last: passport.lastName },
            email:       `${studentId}@vecta-kyc.internal`,
            phone:       { countryCode: '1', number: '5550000000' },
            address:     { street: 'TBD', city: 'TBD', state: 'CA', postalCode: '00000', country: 'US' },
            dateOfBirth: passport.dateOfBirth,
            passport:    { number: passport.passportNumber, country: passport.issuingCountry },
            idempotencyKey: `vecta-${studentId}`,
          },
        },
      },
    );

    const customerId = customer.data.id;

    // Open DDA
    const account = await unitReq<{ data: { id: string; attributes: { balance: number; available: number } } }>(
      'POST', '/accounts',
      {
        data: {
          type: 'depositAccount',
          attributes: {
            depositProduct: 'checking',
            idempotencyKey: `vecta-dda-${studentId}`,
          },
          relationships: {
            customer: { data: { type: 'customer', id: customerId } },
          },
        },
      },
    );

    return {
      accountId:     account.data.id,
      routingNumber: '084106768',         // Unit.co routing number
      accountNumber: '',                  // Fetched separately when needed
      status:        'ACTIVE',
      kycStatus:     mapUnitKYC(customer.data.attributes.status),
      availableUsd:  account.data.attributes.available / 100,
      currency:      'USD',
      providerName:  this.name,
      providerRefId: customerId,
    };
  }

  async getKYCStatus(providerRefId: string): Promise<BankAccount['kycStatus']> {
    const res = await unitReq<{ data: { attributes: { status: string } } }>(
      'GET', `/customers/${providerRefId}`,
    );
    return mapUnitKYC(res.data.attributes.status);
  }

  async getBalance(providerRefId: string): Promise<{ available: number; pending: number }> {
    const res = await unitReq<{ data: Array<{ attributes: { available: number; balance: number } }> }>(
      'GET', `/accounts?filter[customerId]=${providerRefId}`,
    );
    const acc = res.data[0]?.attributes;
    return { available: (acc?.available ?? 0) / 100, pending: 0 };
  }

  async getTransactions(providerRefId: string, limit: number) {
    const res = await unitReq<{ data: Array<{
      id: string;
      attributes: { createdAt: string; amount: number; direction: string; balance: number; summary: string; status: string };
    }> }>(
      'GET', `/transactions?filter[customerId]=${providerRefId}&page[limit]=${limit}&sort=-createdAt`,
    );
    return res.data.map((tx) => ({
      id:          tx.id,
      date:        tx.attributes.createdAt.slice(0, 10),
      description: tx.attributes.summary ?? '',
      amountCents: tx.attributes.direction === 'Credit' ? tx.attributes.amount : -tx.attributes.amount,
      direction:   (tx.attributes.direction === 'Credit' ? 'CREDIT' : 'DEBIT') as 'CREDIT' | 'DEBIT',
      status:      (tx.attributes.status === 'Pending' ? 'PENDING' : 'CLEARED') as 'PENDING' | 'CLEARED' | 'RETURNED',
    }));
  }

  async handleWebhook(payload: unknown, signature: string) {
    const p = payload as { data?: { type?: string; attributes?: { status?: string }; relationships?: { customer?: { data?: { id?: string } } } } };
    const type = p.data?.type ?? '';
    const customerId = p.data?.relationships?.customer?.data?.id;

    if (type === 'customerUpdated') {
      return {
        type:       'KYC_STATUS_CHANGED' as const,
        customerId,
        kycStatus:  mapUnitKYC(p.data?.attributes?.status ?? ''),
      };
    }
    return { type: 'UNKNOWN' as const };
  }
}
