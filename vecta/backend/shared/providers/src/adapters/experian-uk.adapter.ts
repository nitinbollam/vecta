/**
 * packages/providers/src/adapters/experian-uk.adapter.ts
 *
 * Experian UK credit bureau adapter
 * Score range: 0-999 (881+ = Excellent, 721-880 = Good, 561-720 = Fair)
 *
 * ⚠️  Requires Experian UK Data Bureau agreement.
 *     Contact: https://www.experian.co.uk/business/data-bureau
 *     Timeline: 6-8 weeks, FCA regulated entity required.
 */

import type { CreditBureauAdapter, BureauQuery, CreditSummary } from './cibil.adapter';
import type { BureauScore } from '../../../../services/housing-service/src/vecta-credit-bridge.service';

const EXPERIAN_BASE_URL = process.env.EXPERIAN_UK_API_URL ?? 'https://sandbox.experian.co.uk/consumerservices/credit-profile/v2';
const EXPERIAN_API_KEY  = process.env.EXPERIAN_UK_API_KEY ?? '';

export class ExperianUKAdapter implements CreditBureauAdapter {

  async fetchScore(params: BureauQuery): Promise<BureauScore> {
    if (!EXPERIAN_API_KEY) {
      return this.mockScore(params);
    }

    // Experian UK uses OAuth2 client credentials
    const tokenRes = await fetch('https://api.experian.com/oauth2/v1/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    `grant_type=client_credentials&client_id=${EXPERIAN_API_KEY}&client_secret=${process.env.EXPERIAN_UK_CLIENT_SECRET}`,
    });
    const { access_token } = await tokenRes.json() as { access_token: string };

    const res = await fetch(`${EXPERIAN_BASE_URL}/credit-report`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type':  'application/json',
        'X-Correlation-Id': `vecta-${Date.now()}`,
      },
      body: JSON.stringify({
        applicant: {
          name:        { full: params.name },
          dateOfBirth: params.dob,
          identification: [{ type: 'NIN', value: params.nationalId }],
        },
        purpose: 'HOUSING_REFERENCE',
      }),
    });

    if (!res.ok) throw new Error(`Experian UK API error: ${res.status}`);

    const data = await res.json() as {
      creditReport: { score: number; keyFacts: Array<{ description: string }> };
    };

    return {
      score:      data.creditReport.score,
      range:      { min: 0, max: 999 },
      bureau:     'EXPERIAN_UK',
      reportDate: new Date(),
      factors:    data.creditReport.keyFacts.map(f => f.description),
    };
  }

  async getReportSummary(params: BureauQuery): Promise<CreditSummary> {
    return { score: 0, accountCount: 0, activeAccounts: 0, overdueAccounts: 0, highestBalance: 0, paymentHistory: 'GOOD', inquiriesLast6Months: 0 };
  }

  private mockScore(params: BureauQuery): BureauScore {
    const hash  = params.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const score = 650 + (hash % 300);
    return { score, range: { min: 0, max: 999 }, bureau: 'EXPERIAN_UK', reportDate: new Date(), factors: ['[Mock] Experian UK license not yet active'] };
  }
}
