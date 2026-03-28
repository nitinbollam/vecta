/**
 * packages/providers/src/adapters/boost-insurance.adapter.ts
 *
 * Boost Insurance adapter — paper provider for Vecta MGA
 *
 * Boost Insurance (https://boostinsurance.io) acts as the "paper carrier":
 *   - They hold the insurance licenses in all 50 states
 *   - Vecta acts as the MGA (Managing General Agent) that does underwriting
 *   - Boost takes on the actual risk and regulatory obligations
 *   - Vecta earns a commission on each policy bound
 *
 * API: https://api.boostinsurance.io/v1
 *
 * ⚠️  Requires a Boost Insurance MGA agreement.
 *     Contact: sales@boostinsurance.io
 *     Timeline: 4-8 weeks for licensing and API access.
 *
 *     Until the agreement is in place, all methods return mock responses.
 *     The policy binds successfully in Vecta's DB but gets PENDING_* ref.
 */

import { createLogger } from '@vecta/logger';

const logger = createLogger('boost-insurance');

const BOOST_BASE_URL = process.env.BOOST_INSURANCE_API_URL ?? 'https://api.boostinsurance.io';
const BOOST_API_KEY  = process.env.BOOST_INSURANCE_API_KEY ?? '';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolicySubmission {
  externalRef:         string;    // our policy number
  policyType:          string;    // renters | auto | health
  studentId:           string;
  monthlyPremiumCents: number;
  coverageAmountCents: number;
  deductibleCents:     number;
  effectiveDate:       string;    // YYYY-MM-DD
  expiryDate:          string;    // YYYY-MM-DD
  vehicleData?:        {
    make: string; model: string; year: number; vin?: string;
  };
}

export interface ClaimSubmission {
  policyRef:           string;
  claimType:           string;
  description:         string;
  incidentDate:        string;
  amountClaimedCents?: number;
}

export interface PaperPolicyRef {
  boostPolicyId:   string;
  status:          'PENDING' | 'BOUND' | 'CANCELLED';
}

export interface ClaimRef {
  boostClaimId: string;
  status:       string;
}

// ---------------------------------------------------------------------------
// Boost Insurance adapter
// ---------------------------------------------------------------------------

export class BoostInsuranceAdapter {

  private async request<T>(
    method: string,
    path:   string,
    body?:  object,
  ): Promise<T> {
    if (!BOOST_API_KEY) {
      logger.warn('[Boost] API key not set — returning mock response');
      return this.getMockResponse<T>(path, body);
    }

    const res = await fetch(`${BOOST_BASE_URL}${path}`, {
      method,
      headers: {
        'X-API-Key':    BOOST_API_KEY,
        'Content-Type': 'application/json',
        'X-MGA-License': process.env.MGA_LICENSE_NUMBER ?? '',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(`Boost API error ${res.status}: ${err.error ?? res.statusText}`);
    }

    return res.json() as Promise<T>;
  }

  /**
   * Submit a policy to Boost for paper backing.
   * Returns Boost's policy reference number.
   */
  async submitPolicy(params: PolicySubmission): Promise<string> {
    const productCode = this.getProductCode(params.policyType);

    const result = await this.request<{ policy_id: string; status: string }>(
      'POST',
      '/v1/policies',
      {
        product:           productCode,
        external_ref:      params.externalRef,
        effective_date:    params.effectiveDate,
        expiration_date:   params.expiryDate,
        premium_cents:     params.monthlyPremiumCents * 12,  // annual premium
        coverage: {
          limit_cents:     params.coverageAmountCents,
          deductible_cents:params.deductibleCents,
        },
        insured: {
          id: params.studentId,
        },
      },
    );

    logger.info({ boostPolicyId: result.policy_id, externalRef: params.externalRef }, '[Boost] Policy bound');
    return result.policy_id;
  }

  async submitRentersPolicy(params: PolicySubmission): Promise<PaperPolicyRef> {
    const id = await this.submitPolicy({ ...params, policyType: 'renters' });
    return { boostPolicyId: id, status: 'BOUND' };
  }

  async submitAutoPolicy(params: PolicySubmission): Promise<PaperPolicyRef> {
    const id = await this.submitPolicy({ ...params, policyType: 'auto' });
    return { boostPolicyId: id, status: 'BOUND' };
  }

  async submitHealthPolicy(params: PolicySubmission): Promise<PaperPolicyRef> {
    const id = await this.submitPolicy({ ...params, policyType: 'health' });
    return { boostPolicyId: id, status: 'BOUND' };
  }

  async processClaim(params: ClaimSubmission): Promise<ClaimRef> {
    const result = await this.request<{ claim_id: string; status: string }>(
      'POST',
      '/v1/claims',
      {
        policy_ref:           params.policyRef,
        claim_type:           params.claimType,
        description:          params.description,
        incident_date:        params.incidentDate,
        amount_claimed_cents: params.amountClaimedCents,
      },
    );

    return { boostClaimId: result.claim_id, status: result.status };
  }

  async cancelPolicy(policyRef: string, reason: string): Promise<void> {
    await this.request('DELETE', `/v1/policies/${policyRef}`, { reason });
  }

  private getProductCode(policyType: string): string {
    const codes: Record<string, string> = {
      renters: 'RENTERS_INSURANCE_STANDARD',
      auto:    'AUTO_LIABILITY_COMPREHENSIVE',
      health:  'STUDENT_HEALTH_PLAN',
    };
    return codes[policyType.toLowerCase()] ?? 'RENTERS_INSURANCE_STANDARD';
  }

  private getMockResponse<T>(path: string, body?: object): T {
    if (path.includes('/policies') && !path.includes('/')) {
      const externalRef = (body as PolicySubmission)?.externalRef ?? 'VECTA-MOCK';
      return {
        policy_id: `boost_mock_${externalRef}_${Date.now()}`,
        status:    'BOUND',
      } as unknown as T;
    }
    if (path.includes('/claims')) {
      return {
        claim_id: `boost_claim_mock_${Date.now()}`,
        status:   'SUBMITTED',
      } as unknown as T;
    }
    if (path.includes('DELETE')) {
      return {} as T;
    }
    return {} as T;
  }
}
