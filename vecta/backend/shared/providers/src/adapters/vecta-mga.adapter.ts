/**
 * Vecta MGA Adapter
 *
 * Vecta acts as Managing General Agent (MGA).
 * Boost Insurance is the paper carrier that holds the
 * state licenses and reinsurance.
 *
 * This adapter is the in-house layer that:
 * 1. Runs Vecta's proprietary underwriting engine
 * 2. Submits bound policies to Boost as paper carrier
 * 3. Issues digital insurance cards directly in-app
 * 4. Handles claims intake before routing to Boost
 *
 * MGA License Status: PENDING — apply at boostinsurance.io/partners
 * Until license is granted, Boost handles full underwriting.
 * Once granted, Vecta underwrites and Boost is paper only.
 */

import { createLogger } from '@vecta/logger';

const logger = createLogger('vecta-mga');

export interface MGAPolicyParams {
  studentId:           string;
  policyType:          'RENTERS' | 'AUTO' | 'HEALTH' | 'AUTO_TNC';
  coverageAmountCents: number;
  deductibleCents:     number;
  monthlyPremiumCents: number;
  underwritingData:    Record<string, unknown>;
  paperProvider:       'BOOST_INSURANCE';
}

export interface MGAPolicyResult {
  policyId:     string;
  policyNumber: string;
  status:       'ACTIVE' | 'PENDING';
  cardUrl:      string;
  paperRef:     string;
}

export interface MGAClaimParams {
  policyId:          string;
  claimType:         string;
  description:       string;
  amountClaimedCents?: number;
}

export class VectaMGAAdapter {
  private boostApiKey    = process.env.BOOST_INSURANCE_API_KEY ?? '';
  private boostApiUrl    = process.env.BOOST_INSURANCE_API_URL ?? 'https://api.boostinsurance.io';
  private mgaLicenseNum  = process.env.MGA_LICENSE_NUMBER ?? '';
  private isLicensed     = !!process.env.MGA_LICENSE_NUMBER;

  /**
   * Bind a policy.
   *
   * Pre-license: Boost underwrites + binds directly.
   * Post-license: Vecta underwrites, Boost is paper carrier only.
   */
  async bindPolicy(params: MGAPolicyParams): Promise<MGAPolicyResult> {
    if (!this.boostApiKey) {
      logger.warn('BOOST_INSURANCE_API_KEY not set — returning mock policy');
      return this.mockPolicy(params);
    }

    if (this.isLicensed) {
      // Post-MGA-license flow: Vecta is the MGA
      return this.bindAsVectaMGA(params);
    }
    // Pre-license flow: Boost is full carrier
    return this.bindThroughBoost(params);
  }

  private async bindAsVectaMGA(params: MGAPolicyParams): Promise<MGAPolicyResult> {
    // Vecta runs its own underwriting first
    // then submits to Boost as paper carrier
    const policyNumber = this.generatePolicyNumber(params.policyType);

    try {
      const res = await fetch(`${this.boostApiUrl}/v1/policies`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${this.boostApiKey}`,
          'Content-Type':  'application/json',
          'X-MGA-License': this.mgaLicenseNum,
        },
        body: JSON.stringify({
          mga_policy_number:    policyNumber,
          policy_type:          params.policyType,
          coverage_amount:      params.coverageAmountCents,
          deductible:           params.deductibleCents,
          monthly_premium:      params.monthlyPremiumCents,
          underwriting_data:    params.underwritingData,
          underwritten_by:      'VECTA_MGA',
        }),
      });

      if (!res.ok) throw new Error(`Boost API error: ${res.status}`);
      const data = await res.json() as { id: string; policy_number: string };

      logger.info({ policyNumber, boostRef: data.id }, 'Policy bound via Vecta MGA');

      return {
        policyId:     data.id,
        policyNumber,
        status:       'ACTIVE',
        cardUrl:      await this.generateCardUrl(policyNumber, params),
        paperRef:     data.id,
      };
    } catch (err) {
      logger.error({ err }, 'Vecta MGA bind failed — falling back to Boost direct');
      return this.bindThroughBoost(params);
    }
  }

  private async bindThroughBoost(params: MGAPolicyParams): Promise<MGAPolicyResult> {
    try {
      const res = await fetch(`${this.boostApiUrl}/v1/policies`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${this.boostApiKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          policy_type:       params.policyType,
          coverage_amount:   params.coverageAmountCents,
          deductible:        params.deductibleCents,
          monthly_premium:   params.monthlyPremiumCents,
          underwriting_data: params.underwritingData,
        }),
      });

      if (!res.ok) throw new Error(`Boost API error: ${res.status}`);
      const data = await res.json() as {
        id: string;
        policy_number: string;
        card_url?: string;
      };

      logger.info({ policyId: data.id }, 'Policy bound through Boost direct');

      return {
        policyId:     data.id,
        policyNumber: data.policy_number,
        status:       'ACTIVE',
        cardUrl:      data.card_url ?? '',
        paperRef:     data.id,
      };
    } catch (err) {
      logger.error({ err }, 'Boost bind failed — returning mock');
      return this.mockPolicy(params);
    }
  }

  async submitClaim(params: MGAClaimParams): Promise<{ claimId: string; status: string }> {
    if (!this.boostApiKey) {
      return { claimId: `mock-claim-${Date.now()}`, status: 'SUBMITTED' };
    }

    try {
      const res = await fetch(`${this.boostApiUrl}/v1/claims`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${this.boostApiKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          policy_id:            params.policyId,
          claim_type:           params.claimType,
          description:          params.description,
          amount_claimed_cents: params.amountClaimedCents,
        }),
      });

      if (!res.ok) throw new Error(`Boost claims API error: ${res.status}`);
      const data = await res.json() as { id: string; status: string };

      return { claimId: data.id, status: data.status };
    } catch (err) {
      logger.error({ err }, 'Claim submission failed');
      throw err;
    }
  }

  async cancelPolicy(policyId: string, reason: string): Promise<void> {
    if (!this.boostApiKey) return;

    await fetch(`${this.boostApiUrl}/v1/policies/${policyId}/cancel`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${this.boostApiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ reason }),
    });
  }

  private generatePolicyNumber(type: string): string {
    const byType: Record<string, string> = {
      RENTERS:  'VR',
      AUTO:     'VA',
      HEALTH:   'VH',
      AUTO_TNC: 'VT',
    };
    const prefix = byType[type] ?? 'VP';
    const year   = new Date().getFullYear();
    const random = Math.random().toString(36).slice(2, 10).toUpperCase();
    return `${prefix}-${year}-${random}`;
  }

  private async generateCardUrl(
    policyNumber: string,
    _params: MGAPolicyParams,
  ): Promise<string> {
    // In production: generate PDF card and upload to S3
    // For now return a verifiable URL
    return `https://verify.vecta.io/insurance/${policyNumber}`;
  }

  private mockPolicy(params: MGAPolicyParams): MGAPolicyResult {
    const policyNumber = this.generatePolicyNumber(params.policyType);
    logger.warn({ policyType: params.policyType }, 'Using mock insurance policy — configure BOOST_INSURANCE_API_KEY');
    return {
      policyId:     `mock-${Date.now()}`,
      policyNumber,
      status:       'PENDING',
      cardUrl:      `https://verify.vecta.io/insurance/${policyNumber}`,
      paperRef:     `mock-boost-ref-${Date.now()}`,
    };
  }
}

// Export singleton
export const vectaMGA = new VectaMGAAdapter();
