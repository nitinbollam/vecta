/**
 * backend/shared/providers/src/adapters/vecta-bridge.adapter.ts
 * Thin CreditProvider adapter wrapping VectaCreditBridge.
 */

import type { CreditProvider, CreditResult } from '../interfaces';
import { importHousingCreditBridgeModule } from './runtime-service-import';

export class VectaBridgeAdapter implements CreditProvider {
  readonly name = 'vecta-bridge';
  readonly supportedCountries = [
    'IND', 'MEX', 'GBR', 'CAN', 'USA', 'AUS', 'BRA', 'DEU', 'KOR', 'NLD', 'FRA',
  ];

  async fetchCreditHistory(params: {
    studentId: string;
    passportNumber: string;
    countryCode: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
  }): Promise<CreditResult> {
    void params.passportNumber;
    void params.firstName;
    void params.lastName;
    void params.dateOfBirth;

    const mod = await importHousingCreditBridgeModule();
    const VectaCreditBridge = mod.VectaCreditBridge as new () => {
      getCreditScore: (studentId: string) => Promise<{
        usEquivalentScore: number;
        solvencyTier: string;
        factors: string[];
        bureau?: string;
        scoreMethod: string;
        reportDate: Date;
      }>;
    };
    const bridge = new VectaCreditBridge();
    const r      = await bridge.getCreditScore(params.studentId);

    const tierMap: Record<string, CreditResult['tier']> = {
      VERY_HIGH: 'EXCELLENT',
      HIGH:      'GOOD',
      MEDIUM:    'FAIR',
      LOW:       'BUILDING',
    };

    const out: CreditResult = {
      translatedScore: r.usEquivalentScore,
      tier:            tierMap[r.solvencyTier] ?? 'FAIR',
      sourceCountry:   params.countryCode,
      factors:         r.factors.map((f, i) => ({
        code:        `F${i}`,
        description: f,
        positive:    !/risk|late|default/i.test(f),
      })),
      noHistoryFound: false,
      providerName:   this.name,
    };
    if (r.bureau !== undefined) {
      out.bureauName = r.bureau;
    }
    return out;
  }
}
