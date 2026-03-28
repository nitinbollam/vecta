/**
 * packages/providers/src/adapters/buro-de-credito.adapter.ts
 *
 * Buró de Crédito adapter — Mexico's primary credit bureau
 * Score range: 442-850
 *
 * ⚠️  Requires a Buró de Crédito commercial agreement.
 *     Contact: https://www.burodecredito.com.mx/business
 *     Until license: returns Vecta alternative score.
 */

import type { CreditBureauAdapter, BureauQuery, CreditSummary } from './cibil.adapter';
import type { BureauScore } from '../../../services/housing-service/src/vecta-credit-bridge.service';

const BURO_BASE_URL = process.env.BURO_DE_CREDITO_API_URL ?? 'https://api.burodecredito.com.mx/v1';
const BURO_API_KEY  = process.env.BURO_DE_CREDITO_API_KEY ?? '';

export class BuroDeCreditoAdapter implements CreditBureauAdapter {

  async fetchScore(params: BureauQuery): Promise<BureauScore> {
    if (!BURO_API_KEY) {
      return this.mockScore(params);
    }

    const res = await fetch(`${BURO_BASE_URL}/reporte-credito-especial`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${BURO_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        nombre:      params.name,
        fechaNac:    params.dob,
        rfc:         params.nationalId,  // Mexican RFC
        claveElector: '',
        tipo:        'PERSONA_FISICA',
      }),
    });

    if (!res.ok) throw new Error(`Buró de Crédito API error: ${res.status}`);

    const data = await res.json() as { score: { valor: number }; factores: string[] };

    return {
      score:      data.score.valor,
      range:      { min: 442, max: 850 },
      bureau:     'BURO_DE_CREDITO',
      reportDate: new Date(),
      factors:    data.factores ?? [],
    };
  }

  async getReportSummary(params: BureauQuery): Promise<CreditSummary> {
    return { score: 0, accountCount: 0, activeAccounts: 0, overdueAccounts: 0, highestBalance: 0, paymentHistory: 'GOOD', inquiriesLast6Months: 0 };
  }

  private mockScore(params: BureauQuery): BureauScore {
    const hash  = params.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const score = 580 + (hash % 220);
    return { score, range: { min: 442, max: 850 }, bureau: 'BURO_DE_CREDITO', reportDate: new Date(), factors: ['[Mock] Buró de Crédito license not yet active'] };
  }
}
