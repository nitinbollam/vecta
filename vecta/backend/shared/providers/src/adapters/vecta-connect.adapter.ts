/**
 * packages/providers/src/adapters/vecta-connect.adapter.ts
 * Thin BankDataProvider adapter wrapping VectaConnect.
 */

import type { AssetReport, BankDataProvider, LinkTokenResult } from '../interfaces';
import { importBankingServiceModule } from './runtime-service-import';

export class VectaConnectAdapter implements BankDataProvider {
  readonly name = 'vecta-connect';
  readonly supportsInternationalBanks = true;

  async createLinkToken(studentId: string, products: string[]): Promise<LinkTokenResult> {
    void products;
    const mod = await importBankingServiceModule('vecta-connect.service');
    const VectaConnect = mod.VectaConnect as new () => {
      getLinkUrl: (
        sid: string,
        bankId: string,
        redirect: string,
      ) => Promise<{ linkUrl: string; state: string }>;
    };
    const connect = new VectaConnect();
    const result  = await connect.getLinkUrl(studentId, 'default', 'vecta://connect/callback');
    return {
      linkToken:    result.linkUrl,
      expiresAt:    new Date(Date.now() + 3600_000).toISOString(),
      providerName: this.name,
    };
  }

  async exchangePublicToken(publicToken: string): Promise<{ accessToken: string; itemId: string }> {
    return { accessToken: publicToken, itemId: publicToken };
  }

  async getAssetReport(accessToken: string, daysRequested: number): Promise<AssetReport> {
    void daysRequested;
    const mod = await importBankingServiceModule('vecta-connect.service');
    const VectaConnect = mod.VectaConnect as new () => {
      generateAssetReport: (connectionId: string) => Promise<{
        connectionId: string;
        reportDate: Date;
        averageMonthlyBalance: number;
        currency: string;
      }>;
    };
    const connect = new VectaConnect();
    const r       = await connect.generateAssetReport(accessToken);
    const balanceUsd = r.averageMonthlyBalance / 100;
    const verifiedAt = r.reportDate.toISOString();
    return {
      reportId:        r.connectionId,
      totalBalanceUsd: balanceUsd,
      accounts:        [
        {
          institutionName: 'Connected bank',
          type:            'CHECKING',
          balanceUsd:      balanceUsd,
          verifiedAt,
        },
      ],
      verifiedAt,
      providerName: this.name,
    };
  }

  async handleWebhook(_payload: unknown): Promise<{
    type: 'ITEM_ERROR' | 'ASSET_REPORT_READY' | 'AUTH_GRANTED' | 'UNKNOWN';
    itemId?: string;
  }> {
    return { type: 'UNKNOWN' };
  }
}
