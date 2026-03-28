/**
 * packages/providers/src/adapters/vecta-id.adapter.ts
 *
 * Thin IdentityProvider adapter wrapping the VectaID NFC service.
 * Implements the same BankingProvider interface as Didit for seamless failover.
 */

import type { IdentityProvider } from '../interfaces';

export class VectaIDAdapter implements IdentityProvider {
  readonly name = 'vecta-id';

  async initiateVerification(studentId: string, returnUrl?: string): Promise<{
    sessionId: string;
    verificationUrl: string;
  }> {
    // VectaID is a native mobile flow — no external URL.
    // The "verificationUrl" is a deep link that opens the passport scan screen.
    return {
      sessionId:       `vecta-id-${studentId}-${Date.now()}`,
      verificationUrl: `vecta://onboarding/passport-scan?studentId=${studentId}`,
    };
  }

  async processWebhook(payload: unknown): Promise<void> {
    // VectaID doesn't use webhooks — results come directly via
    // POST /api/v1/identity/vecta-id/verify from the mobile app.
  }
}
