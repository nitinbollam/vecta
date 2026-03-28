/**
 * packages/providers/src/adapters/clearbank.adapter.ts
 *
 * ClearBank adapter — alternative sponsor bank for Vecta Ledger (UK-first)
 *
 * ClearBank provides:
 *   - Direct access to UK payment schemes (FPS, CHAPS, BACS)
 *   - EUR payments via SEPA
 *   - FCA-regulated banking infrastructure
 *   - BIN sponsorship for Mastercard/Visa
 *
 * API docs: https://institution.clearbank.co.uk/docs
 * Primary use case: European students, UK banking connections
 *
 * ⚠️  Requires a ClearBank institution agreement before going live.
 */

import { createLogger } from '@vecta/logger';
import type { SponsorBankProvider, ACHRequest, ACHResponse, ACHStatus, BINRange, CardAuthorization, AuthResponse } from './column.adapter';

const logger = createLogger('clearbank-adapter');

const CLEARBANK_BASE_URL = process.env.CLEARBANK_API_URL  ?? 'https://institution.clearbank.co.uk';
const CLEARBANK_API_KEY  = process.env.CLEARBANK_API_KEY  ?? '';

export class ClearBankAdapter implements SponsorBankProvider {

  private async request<T>(
    method: string,
    path:   string,
    body?:  object,
  ): Promise<T> {
    if (!CLEARBANK_API_KEY) {
      logger.warn('[ClearBank] API key not set — returning mock response');
      return this.getMockResponse<T>(path);
    }

    const res = await fetch(`${CLEARBANK_BASE_URL}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${CLEARBANK_API_KEY}`,
        'Content-Type':  'application/json; charset=utf-8',
        'X-Request-Id':  crypto.randomUUID(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { title?: string };
      throw new Error(`ClearBank API error ${res.status}: ${err.title ?? res.statusText}`);
    }

    return res.json() as Promise<T>;
  }

  async createVirtualAccountNumber(): Promise<string> {
    const result = await this.request<{ iban: string; sortCode: string; accountNumber: string }>(
      'POST',
      '/v1/accounts',
      { type: 'CACC', currency: 'USD' },
    );
    return result.accountNumber;
  }

  async initiateACH(transfer: ACHRequest): Promise<ACHResponse> {
    // ClearBank uses CHAPS/FPS for UK payments, SEPA for EU
    // For US ACH, route through Column; ClearBank handles non-US transfers
    const payload = {
      Reference:              transfer.transferId,
      Amount:                 transfer.amountCents / 100,
      Currency:               'USD',
      EndToEndIdentification: transfer.transferId.substring(0, 35),
      CreditorAccount: {
        Identification: transfer.externalAccount,
        SchemeName:     'BBAN',
      },
      CreditorAgent: {
        FinancialInstitutionIdentification: {
          BICFI: transfer.externalRouting,
        },
      },
      RemittanceInformation: {
        Unstructured: transfer.description,
      },
    };

    const result = await this.request<{
      transactionId: string;
      status: string;
    }>('POST', '/v3/payments/fps/singlepayment', payload);

    return {
      sponsorRef:          result.transactionId,
      status:              'PROCESSING',
      estimatedSettlement: new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10),
    };
  }

  async getACHStatus(transferId: string): Promise<ACHStatus> {
    const result = await this.request<{
      transactionId: string;
      status: string;
      settledDate?: string;
    }>('GET', `/v1/transactions/${transferId}`);

    return {
      sponsorRef: result.transactionId,
      status:     result.status,
      settledAt:  result.settledDate,
    };
  }

  async issueBINRange(prefix: string): Promise<BINRange> {
    return { prefix, network: 'MASTERCARD', productCode: 'DEBIT_PREMIUM' };
  }

  async processCardTransaction(auth: CardAuthorization): Promise<AuthResponse> {
    return { approved: true, authCode: 'CB_MOCK_AUTH' };
  }

  async getBalance(accountNumber: string): Promise<number> {
    const result = await this.request<{ balance: { amount: number } }>(
      'GET',
      `/v1/accounts/${accountNumber}/balance`,
    );
    return result.balance.amount * 100;  // convert to cents
  }

  private getMockResponse<T>(path: string): T {
    if (path.includes('/accounts') && !path.includes('/balance')) {
      return { accountNumber: `CB${Date.now().toString().slice(-8)}`, sortCode: '040004', iban: 'GB00CLRB00000000000000' } as unknown as T;
    }
    if (path.includes('/payments')) {
      return { transactionId: `cb_txn_mock_${Date.now()}`, status: 'Executed' } as unknown as T;
    }
    if (path.includes('/balance')) {
      return { balance: { amount: 1500.00 } } as unknown as T;
    }
    return {} as T;
  }
}
