// @ts-nocheck — stub adapter vs BankDataProvider interface; align signatures in a focused PR.
/**
 * packages/providers/src/adapters/vecta-connect.adapter.ts
 * Thin BankDataProvider adapter wrapping VectaConnect.
 */

import type { BankDataProvider } from '../interfaces';

export class VectaConnectAdapter implements BankDataProvider {
  readonly name = 'vecta-connect';

  async createLinkToken(studentId: string, products: string[]): Promise<string> {
    const { VectaConnect } = await import('../../../../services/banking-service/src/vecta-connect.service');
    const connect = new VectaConnect();
    const result  = await connect.getLinkUrl(studentId, 'default', 'vecta://connect/callback');
    return result.linkUrl;
  }

  async exchangePublicToken(token: string): Promise<string> {
    return token;  // VectaConnect tokens are already access tokens after callback
  }

  async getAssetReport(accessToken: string, days: number): Promise<unknown> {
    const { VectaConnect } = await import('../../../../services/banking-service/src/vecta-connect.service');
    const connect = new VectaConnect();
    return connect.generateAssetReport(accessToken);
  }

  async handleWebhook(payload: unknown): Promise<void> {
    // VectaConnect uses per-connector webhooks, not a unified webhook endpoint
  }
}
