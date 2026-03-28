/**
 * packages/providers/src/adapters/vecta-bridge.adapter.ts
 * Thin CreditProvider adapter wrapping VectaCreditBridge.
 */

import type { CreditProvider } from '../interfaces';

export class VectaBridgeAdapter implements CreditProvider {
  readonly name = 'vecta-bridge';

  async fetchCreditHistory(params: {
    studentId:   string;
    countryCode: string;
    name:        string;
    dateOfBirth: string;
  }): Promise<unknown> {
    const { VectaCreditBridge } = await import('../../../../services/housing-service/src/vecta-credit-bridge.service');
    const bridge = new VectaCreditBridge();
    return bridge.getCreditScore(params.studentId);
  }
}
