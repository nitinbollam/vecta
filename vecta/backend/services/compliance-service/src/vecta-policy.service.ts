/**
 * services/compliance-service/src/vecta-policy.service.ts
 *
 * Vecta MGA Policy Service
 * Binds insurance quotes → active policies, generates digital cards, manages lifecycle.
 */

import { randomBytes } from 'crypto';
import { createLogger, logAuditEvent } from '@vecta/logger';
import { query, queryOne } from '@vecta/database';

const logger = createLogger('vecta-policy');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InsurancePolicy {
  id:                   string;
  studentId:            string;
  quoteId?:             string;
  policyType:           'RENTERS' | 'AUTO' | 'HEALTH';
  policyNumber:         string;
  planTier?:            string;
  status:               'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'PENDING_PAYMENT';
  coverageAmountCents:  number;
  deductibleCents:      number;
  monthlyPremiumCents:  number;
  annualPremiumCents:   number;
  effectiveDate:        Date;
  expiryDate:           Date;
  paperProvider:        string;
  paperPolicyRef?:      string;
  cardUrl?:             string;
  createdAt:            Date;
}

export interface ClaimSubmission {
  claimType:      string;
  description:    string;
  incidentDate:   string;   // ISO date
  amountCents?:   number;
  attachments?:   string[]; // S3 URLs
}

// ---------------------------------------------------------------------------
// VectaPolicyService
// ---------------------------------------------------------------------------

export class VectaPolicyService {

  /**
   * Bind a quote to an active insurance policy.
   *
   * Flow:
   *   1. Load and validate the quote (must be ACTIVE, not expired)
   *   2. Generate a Vecta policy number
   *   3. Submit to paper provider (Boost/State National) to get a legal backing ref
   *   4. Generate digital insurance card PDF
   *   5. Store in DB
   *   6. Send notification to student
   */
  async bindPolicy(studentId: string, quoteId: string): Promise<InsurancePolicy> {
    // Load quote
    const quoteRow = await queryOne(
      `SELECT * FROM insurance_quotes WHERE id = $1 AND student_id = $2`,
      [quoteId, studentId],
    );

    if (!quoteRow) throw new Error('Quote not found or does not belong to this student');
    if (quoteRow.status !== 'ACTIVE') throw new Error(`Quote is ${quoteRow.status} — cannot bind`);
    if (new Date(String(quoteRow.expires_at)) < new Date()) {
      throw new Error('Quote has expired — please get a new quote');
    }

    const policyType = String(quoteRow.policy_type) as 'RENTERS' | 'AUTO' | 'HEALTH';

    // Generate policy number: VECTA-RENTERS-2026-A3F7B2C1
    const policyNumber = this.generatePolicyNumber(policyType);

    // Effective immediately, expires in 1 year
    const effectiveDate = new Date();
    const expiryDate    = new Date(Date.now() + 365 * 24 * 3600_000);

    // Submit to paper provider
    const paperRef = await this.submitToPaperProvider({
      policyNumber,
      policyType,
      studentId,
      monthlyPremiumCents: Number(quoteRow.monthly_premium_cents),
      coverageAmountCents: Number(quoteRow.coverage_amount_cents),
      deductibleCents:     Number(quoteRow.deductible_cents),
      effectiveDate,
      expiryDate,
      paperProvider:       String(quoteRow.paper_provider),
    });

    // Insert policy
    const result = await query(`
      INSERT INTO insurance_policies (
        student_id, quote_id, policy_type, policy_number, plan_tier,
        coverage_amount_cents, deductible_cents, liability_cents,
        monthly_premium_cents, annual_premium_cents,
        effective_date, expiry_date,
        paper_provider, paper_policy_ref, paper_status,
        underwriting_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'bound', $15)
      RETURNING *
    `, [
      studentId,
      quoteId,
      policyType,
      policyNumber,
      quoteRow.plan_tier ?? null,
      quoteRow.coverage_amount_cents,
      quoteRow.deductible_cents,
      quoteRow.liability_cents,
      quoteRow.monthly_premium_cents,
      quoteRow.annual_premium_cents,
      effectiveDate.toISOString().slice(0, 10),
      expiryDate.toISOString().slice(0, 10),
      quoteRow.paper_provider,
      paperRef,
      quoteRow.underwriting_data,
    ]);

    const policy = this.mapPolicy(result.rows[0]);

    // Mark quote as converted
    await query(
      `UPDATE insurance_quotes SET status = 'CONVERTED', converted_to_policy = $1 WHERE id = $2`,
      [policy.id, quoteId],
    );

    // Generate digital card (async — don't block binding)
    void this.generateAndAttachInsuranceCard(policy).catch(err => {
      logger.warn({ err, policyId: policy.id }, '[Policy] Card generation failed (non-critical)');
    });

    void logAuditEvent('POLICY_BOUND', studentId, 'insurance.policy', {
      policyNumber,
      policyType,
      paperProvider: String(quoteRow.paper_provider),
    });

    logger.info({ studentId, policyNumber, policyType }, '[Policy] Bound');
    return policy;
  }

  // ---------------------------------------------------------------------------
  // Get active policies
  // ---------------------------------------------------------------------------

  async getActivePolicies(studentId: string): Promise<InsurancePolicy[]> {
    const result = await query(
      `SELECT * FROM insurance_policies WHERE student_id = $1 AND status = 'ACTIVE' ORDER BY created_at DESC`,
      [studentId],
    );
    return result.rows.map(r => this.mapPolicy(r));
  }

  async getPolicyById(policyId: string, studentId: string): Promise<InsurancePolicy | null> {
    const row = await queryOne(
      `SELECT * FROM insurance_policies WHERE id = $1 AND student_id = $2`,
      [policyId, studentId],
    );
    return row ? this.mapPolicy(row) : null;
  }

  // ---------------------------------------------------------------------------
  // Submit claim
  // ---------------------------------------------------------------------------

  async submitClaim(policyId: string, studentId: string, claim: ClaimSubmission): Promise<string> {
    const policy = await this.getPolicyById(policyId, studentId);
    if (!policy) throw new Error('Policy not found');
    if (policy.status !== 'ACTIVE') throw new Error('Can only submit claims on active policies');

    const result = await query(`
      INSERT INTO insurance_claims (
        policy_id, student_id, claim_type, description,
        incident_date, amount_claimed_cents, attachments
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      policyId,
      studentId,
      claim.claimType,
      claim.description,
      claim.incidentDate,
      claim.amountCents ?? null,
      JSON.stringify(claim.attachments ?? []),
    ]);

    const claimId = String(result.rows[0].id);

    void logAuditEvent('CLAIM_SUBMITTED', studentId, 'insurance.claim', {
      policyId,
      claimType: claim.claimType,
      claimId,
    });

    return claimId;
  }

  // ---------------------------------------------------------------------------
  // Digital insurance card generation
  // ---------------------------------------------------------------------------

  /**
   * Generate a PDF insurance card and upload to S3.
   *
   * In production: use pdfkit + @aws-sdk/client-s3
   * Card includes:
   *   - Policy number, effective/expiry dates
   *   - Coverage summary
   *   - Vecta MGA branding + paper provider name
   *   - Emergency claims number: 1-800-VECTA-ID
   *   - QR code linking to digital verification
   */
  private async generateAndAttachInsuranceCard(policy: InsurancePolicy): Promise<void> {
    try {
      const cardUrl = await this.uploadInsuranceCard(policy);

      await query(
        `UPDATE insurance_policies SET card_url = $1 WHERE id = $2`,
        [cardUrl, policy.id],
      );

      logger.info({ policyId: policy.id, cardUrl }, '[Policy] Insurance card generated');
    } catch (err) {
      logger.error({ err }, '[Policy] Insurance card generation failed');
    }
  }

  private async uploadInsuranceCard(policy: InsurancePolicy): Promise<string> {
    // In production:
    //   const doc     = new PDFDocument();
    //   const s3      = new S3Client({ region: 'us-east-1' });
    //   Build PDF with policy details, upload to:
    //   s3://vecta-insurance-cards/{policyId}/card.pdf
    //   Return pre-signed URL or CloudFront URL

    const placeholderUrl = `https://storage.vecta.io/insurance-cards/${policy.id}/card.pdf`;
    return placeholderUrl;
  }

  // ---------------------------------------------------------------------------
  // Paper provider integration
  // ---------------------------------------------------------------------------

  private async submitToPaperProvider(params: {
    policyNumber:        string;
    policyType:          string;
    studentId:           string;
    monthlyPremiumCents: number;
    coverageAmountCents: number;
    deductibleCents:     number;
    effectiveDate:       Date;
    expiryDate:          Date;
    paperProvider:       string;
  }): Promise<string> {
    try {
      const { BoostInsuranceAdapter } = await import('../../../shared/providers/src/adapters/boost-insurance.adapter');
      const boost = new BoostInsuranceAdapter();

      const ref = await boost.submitPolicy({
        externalRef:         params.policyNumber,
        policyType:          params.policyType,
        studentId:           params.studentId,
        monthlyPremiumCents: params.monthlyPremiumCents,
        coverageAmountCents: params.coverageAmountCents,
        deductibleCents:     params.deductibleCents,
        effectiveDate:       params.effectiveDate.toISOString().slice(0, 10),
        expiryDate:          params.expiryDate.toISOString().slice(0, 10),
      });

      return ref;
    } catch (err) {
      logger.warn({ err }, '[Policy] Paper provider submission failed — proceeding with pending status');
      return `PENDING_${params.policyNumber}`;
    }
  }

  // ---------------------------------------------------------------------------
  // Policy number generation
  // ---------------------------------------------------------------------------

  private generatePolicyNumber(policyType: string): string {
    const typeCode = { RENTERS: 'REN', AUTO: 'AUTO', HEALTH: 'HLTH' }[policyType] ?? 'GEN';
    const year     = new Date().getFullYear();
    const random   = randomBytes(4).toString('hex').toUpperCase();
    return `VECTA-${typeCode}-${year}-${random}`;
  }

  // ---------------------------------------------------------------------------
  // Mapper
  // ---------------------------------------------------------------------------

  private mapPolicy(row: Record<string, unknown>): InsurancePolicy {
    return {
      id:                  String(row.id),
      studentId:           String(row.student_id),
      quoteId:             row.quote_id ? String(row.quote_id) : undefined,
      policyType:          String(row.policy_type) as 'RENTERS',
      policyNumber:        String(row.policy_number),
      planTier:            row.plan_tier ? String(row.plan_tier) : undefined,
      status:              String(row.status) as 'ACTIVE',
      coverageAmountCents: Number(row.coverage_amount_cents),
      deductibleCents:     Number(row.deductible_cents),
      monthlyPremiumCents: Number(row.monthly_premium_cents),
      annualPremiumCents:  Number(row.annual_premium_cents),
      effectiveDate:       new Date(String(row.effective_date)),
      expiryDate:          new Date(String(row.expiry_date)),
      paperProvider:       String(row.paper_provider),
      paperPolicyRef:      row.paper_policy_ref ? String(row.paper_policy_ref) : undefined,
      cardUrl:             row.card_url ? String(row.card_url) : undefined,
      createdAt:           new Date(String(row.created_at)),
    };
  }
}
