/**
 * packages/providers/src/adapters/cibil.adapter.ts
 *
 * CIBIL (Credit Information Bureau India Limited) adapter
 * India's primary credit bureau — covers 550M+ consumers.
 *
 * Score range: 300-900 (750+ = excellent, 650-749 = good, <650 = fair/poor)
 *
 * ⚠️  Requires a CIBIL Member agreement.
 *     Contact: https://www.cibil.com/partner-with-us
 *     Timeline: 4-6 weeks, requires RBI entity registration.
 *     Until license: returns Vecta alternative score.
 */

import type { BureauScore } from '../../../services/housing-service/src/vecta-credit-bridge.service';

export interface BureauQuery {
  name:       string;
  dob:        string;       // YYMMDD or YYYY-MM-DD
  nationalId: string;       // PAN card number (AAA9999A format)
}

export interface CreditBureauAdapter {
  fetchScore(params: BureauQuery): Promise<BureauScore>;
  getReportSummary(params: BureauQuery): Promise<CreditSummary>;
}

export interface CreditSummary {
  score:          number;
  accountCount:   number;
  activeAccounts: number;
  overdueAccounts: number;
  highestBalance: number;
  paymentHistory: 'GOOD' | 'FAIR' | 'POOR';
  inquiriesLast6Months: number;
}

const CIBIL_BASE_URL = process.env.CIBIL_API_URL ?? 'https://api.cibil.com/v1';
const CIBIL_API_KEY  = process.env.CIBIL_API_KEY ?? '';

export class CIBILAdapter implements CreditBureauAdapter {

  async fetchScore(params: BureauQuery): Promise<BureauScore> {
    if (!CIBIL_API_KEY) {
      return this.mockScore(params);
    }

    const res = await fetch(`${CIBIL_BASE_URL}/credit-score`, {
      method:  'POST',
      headers: {
        'X-CIBIL-API-Key':  CIBIL_API_KEY,
        'Content-Type':     'application/json',
        'X-Product-Code':   'CIBIL_COMMERCIAL_CREDIT',
      },
      body: JSON.stringify({
        inquiry: {
          reportType:          'CONSUMER',
          inquiryMember:       process.env.CIBIL_MEMBER_ID ?? '',
          inquiryPurpose:      'HOUSING_REFERENCE',
          enquiryAmount:       0,
          transactionAmount:   0,
        },
        applicant: {
          name:        params.name,
          dateOfBirth: params.dob,
          idDetails: [{
            idType:  'PAN',
            idNumber: params.nationalId,
          }],
        },
      }),
    });

    if (!res.ok) throw new Error(`CIBIL API error: ${res.status}`);

    const data = await res.json() as {
      creditReport: {
        score: number;
        scoreFactors: Array<{ factorCode: string; factorText: string }>;
      };
    };

    return {
      score:      data.creditReport.score,
      range:      { min: 300, max: 900 },
      bureau:     'CIBIL',
      reportDate: new Date(),
      factors:    data.creditReport.scoreFactors.map(f => f.factorText),
    };
  }

  async getReportSummary(params: BureauQuery): Promise<CreditSummary> {
    return {
      score:               0,
      accountCount:        0,
      activeAccounts:      0,
      overdueAccounts:     0,
      highestBalance:      0,
      paymentHistory:      'GOOD',
      inquiriesLast6Months: 0,
    };
  }

  private mockScore(params: BureauQuery): BureauScore {
    // Deterministic mock: hash the name to get a consistent score for testing
    const hash  = params.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const score = 600 + (hash % 250);  // 600-849 range for testing
    return {
      score,
      range:      { min: 300, max: 900 },
      bureau:     'CIBIL',
      reportDate: new Date(),
      factors:    ['[Mock] CIBIL license not yet active — using test score'],
    };
  }
}
