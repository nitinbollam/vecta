/**
 * packages/providers/src/adapters/equifax-canada.adapter.ts
 *
 * Equifax Canada credit bureau adapter
 * Score range: 300-900 (760+ = Excellent, 725-759 = Very Good)
 *
 * ⚠️  Requires Equifax Canada Data Access Agreement.
 *     Contact: https://www.equifax.ca/business/credit-bureau
 *     Timeline: 4-6 weeks.
 */

import type { CreditBureauAdapter, BureauQuery, CreditSummary } from './cibil.adapter';
import type { BureauScore } from '../../../services/housing-service/src/vecta-credit-bridge.service';

const EQUIFAX_CA_BASE_URL = process.env.EQUIFAX_CANADA_API_URL ?? 'https://api.equifax.ca/v1';
const EQUIFAX_CA_API_KEY  = process.env.EQUIFAX_CANADA_API_KEY ?? '';

export class EquifaxCanadaAdapter implements CreditBureauAdapter {

  async fetchScore(params: BureauQuery): Promise<BureauScore> {
    if (!EQUIFAX_CA_API_KEY) {
      return this.mockScore(params);
    }

    const res = await fetch(`${EQUIFAX_CA_BASE_URL}/consumer/credit-report`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${EQUIFAX_CA_API_KEY}`,
        'Content-Type':  'application/json',
        'X-Client-Id':   process.env.EQUIFAX_CANADA_CLIENT_ID ?? '',
      },
      body: JSON.stringify({
        consumer: {
          name:   { full: params.name },
          dob:    params.dob,
          sin:    params.nationalId,  // Social Insurance Number
        },
        product:  'CREDIT_REPORT_SCORE_ONLY',
        reason:   'HOUSING_SCREENING',
      }),
    });

    if (!res.ok) throw new Error(`Equifax Canada API error: ${res.status}`);

    const data = await res.json() as {
      hitCode:    string;
      score:      number;
      riskFactors: Array<{ code: string; text: string }>;
    };

    return {
      score:      data.score,
      range:      { min: 300, max: 900 },
      bureau:     'EQUIFAX_CANADA',
      reportDate: new Date(),
      factors:    data.riskFactors?.map(f => f.text) ?? [],
    };
  }

  async getReportSummary(params: BureauQuery): Promise<CreditSummary> {
    return { score: 0, accountCount: 0, activeAccounts: 0, overdueAccounts: 0, highestBalance: 0, paymentHistory: 'GOOD', inquiriesLast6Months: 0 };
  }

  private mockScore(params: BureauQuery): BureauScore {
    const hash  = params.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const score = 600 + (hash % 250);
    return { score, range: { min: 300, max: 900 }, bureau: 'EQUIFAX_CANADA', reportDate: new Date(), factors: ['[Mock] Equifax Canada license not yet active'] };
  }
}
