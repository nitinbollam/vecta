/**
 * packages/providers/src/adapters/column.adapter.ts
 *
 * Column Bank adapter — sponsor bank for Vecta Ledger
 *
 * Column provides:
 *   - Direct ACH/Fedwire access (no intermediary)
 *   - BIN sponsorship for Visa debit cards
 *   - Real-time settlement
 *   - Compliance infrastructure (BSA/AML)
 *
 * API docs: https://column.com/docs/api
 * Sign up: https://column.com/
 *
 * ⚠️  Requires a Column Bank partnership agreement before going live.
 *     Until then, all methods return mock responses suitable for testing.
 */

import { createLogger } from '@vecta/logger';

const logger = createLogger('column-adapter');

const COLUMN_BASE_URL  = process.env.COLUMN_BANK_API_URL  ?? 'https://api.column.com';
const COLUMN_API_KEY   = process.env.COLUMN_BANK_API_KEY  ?? '';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ACHRequest {
  transferId:      string;
  direction:       'INBOUND' | 'OUTBOUND';
  amountCents:     number;
  externalRouting: string;
  externalAccount: string;
  description:     string;
}

export interface ACHResponse {
  sponsorRef: string;
  status:     'PENDING' | 'PROCESSING' | 'SETTLED' | 'RETURNED';
  estimatedSettlement: string;  // ISO date
}

export interface ACHStatus {
  sponsorRef: string;
  status:     string;
  returnCode?: string;
  settledAt?:  string;
}

export interface BINRange {
  prefix:     string;
  network:    'VISA' | 'MASTERCARD';
  productCode: string;
}

export interface CardAuthorization {
  cardNumber:     string;
  amountCents:    number;
  merchantName:   string;
  merchantCategory: string;
  currency:       string;
}

export interface AuthResponse {
  approved:      boolean;
  authCode?:     string;
  declineReason?: string;
}

// ---------------------------------------------------------------------------
// SponsorBankProvider interface
// ---------------------------------------------------------------------------

export interface SponsorBankProvider {
  createVirtualAccountNumber():                         Promise<string>;
  initiateACH(transfer: ACHRequest):                    Promise<ACHResponse>;
  getACHStatus(transferId: string):                     Promise<ACHStatus>;
  issueBINRange(prefix: string):                        Promise<BINRange>;
  processCardTransaction(auth: CardAuthorization):      Promise<AuthResponse>;
  getBalance(accountNumber: string):                    Promise<number>;
}

// ---------------------------------------------------------------------------
// Column Bank adapter
// ---------------------------------------------------------------------------

export class ColumnBankAdapter implements SponsorBankProvider {

  private async request<T>(
    method: string,
    path:   string,
    body?:  object,
  ): Promise<T> {
    if (!COLUMN_API_KEY) {
      logger.warn('[Column] API key not set — returning mock response');
      return this.getMockResponse<T>(method, path, body);
    }

    const res = await fetch(`${COLUMN_BASE_URL}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${COLUMN_API_KEY}`,
        'Content-Type':  'application/json',
        'Column-Version': '2024-01-01',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { message?: string };
      throw new Error(`Column API error ${res.status}: ${err.message ?? res.statusText}`);
    }

    return res.json() as Promise<T>;
  }

  async createVirtualAccountNumber(): Promise<string> {
    const result = await this.request<{ account_number: string }>(
      'POST',
      '/v1/bank-accounts',
      { account_type: 'CHECKING', currency: 'USD' },
    );
    return result.account_number;
  }

  async initiateACH(transfer: ACHRequest): Promise<ACHResponse> {
    const payload = {
      type:            transfer.direction === 'OUTBOUND' ? 'credit' : 'debit',
      amount:          transfer.amountCents,
      currency:        'USD',
      routing_number:  transfer.externalRouting,
      account_number:  transfer.externalAccount,
      description:     transfer.description,
      idempotency_key: transfer.transferId,
    };

    const result = await this.request<{
      id: string;
      status: string;
      estimated_settlement_date: string;
    }>('POST', '/v1/ach-transfers', payload);

    return {
      sponsorRef:          result.id,
      status:              'PROCESSING',
      estimatedSettlement: result.estimated_settlement_date,
    };
  }

  async getACHStatus(transferId: string): Promise<ACHStatus> {
    const result = await this.request<{
      id: string;
      status: string;
      return_code?: string;
      settled_at?: string;
    }>('GET', `/v1/ach-transfers/${transferId}`);

    return {
      sponsorRef:  result.id,
      status:      result.status,
      returnCode:  result.return_code,
      settledAt:   result.settled_at,
    };
  }

  async issueBINRange(prefix: string): Promise<BINRange> {
    // BIN ranges are assigned by Column during onboarding, not dynamically
    return {
      prefix,
      network:     'VISA',
      productCode: 'DEBIT_STANDARD',
    };
  }

  async processCardTransaction(auth: CardAuthorization): Promise<AuthResponse> {
    // Card authorizations are pushed to Vecta via Column webhook, not pulled
    // This method is for manual authorization requests if needed
    const result = await this.request<{
      approved: boolean;
      auth_code?: string;
      decline_reason?: string;
    }>('POST', '/v1/card-authorizations', {
      card_number:       auth.cardNumber,
      amount:            auth.amountCents,
      merchant_name:     auth.merchantName,
      merchant_category: auth.merchantCategory,
      currency:          auth.currency,
    });

    return {
      approved:      result.approved,
      authCode:      result.auth_code,
      declineReason: result.decline_reason,
    };
  }

  async getBalance(accountNumber: string): Promise<number> {
    const result = await this.request<{ available_balance: number }>(
      'GET',
      `/v1/bank-accounts/${accountNumber}/balance`,
    );
    return result.available_balance;
  }

  /** Mock responses for testing without a real Column account */
  private getMockResponse<T>(method: string, path: string, body?: object): T {
    if (path.includes('/bank-accounts') && method === 'POST') {
      return { account_number: `40000${Date.now().toString().slice(-8)}0` } as unknown as T;
    }
    if (path.includes('/ach-transfers') && method === 'POST') {
      return {
        id:                        `col_ach_mock_${Date.now()}`,
        status:                    'PROCESSING',
        estimated_settlement_date: new Date(Date.now() + 2 * 24 * 3600_000).toISOString().slice(0, 10),
      } as unknown as T;
    }
    if (path.includes('/ach-transfers') && method === 'GET') {
      return { id: path.split('/').pop(), status: 'SETTLED', settled_at: new Date().toISOString() } as unknown as T;
    }
    if (path.includes('/balance')) {
      return { available_balance: 250000 } as unknown as T;  // $2,500 mock
    }
    if (path.includes('/card-authorizations')) {
      return { approved: true, auth_code: 'MOCK_AUTH' } as unknown as T;
    }
    return {} as T;
  }
}
