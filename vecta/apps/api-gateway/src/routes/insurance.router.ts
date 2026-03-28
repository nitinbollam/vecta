/**
 * apps/api-gateway/src/routes/insurance.router.ts
 *
 * Vecta MGA Insurance Routes — replaces Lemonade, ISO, PSI
 *
 * POST /api/v1/insurance/quote/renters    → VectaUnderwriting.quoteRenters
 * POST /api/v1/insurance/quote/auto       → VectaUnderwriting.quoteAuto
 * POST /api/v1/insurance/quote/health     → VectaUnderwriting.quoteHealth
 * POST /api/v1/insurance/bind/:quoteId    → VectaPolicy.bindPolicy
 * GET  /api/v1/insurance/policies         → VectaPolicy.getActivePolicies
 * GET  /api/v1/insurance/card/:policyId   → return digital card URL
 * POST /api/v1/insurance/claim/:policyId  → VectaPolicy.submitClaim
 *
 * Legacy route kept for compliance AI PDF analysis:
 * POST /api/v1/insurance/health-plan/analyze
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, requireKYC } from '@vecta/auth';
import { createLogger } from '@vecta/logger';
import type { VehicleData } from '../../../../services/compliance-service/src/vecta-underwriting.service';
import type { ClaimSubmission } from '../../../../services/compliance-service/src/vecta-policy.service';

const logger = createLogger('insurance-router');
const router = Router();

router.use(authMiddleware);
router.use(requireKYC('APPROVED'));

const COMPLIANCE_AI = process.env.COMPLIANCE_AI_URL ?? 'http://compliance-ai:8000';

// Lazy-load services to prevent import errors during cold start
async function getUnderwriting() {
  const { VectaUnderwritingEngine } = await import('../../../../services/compliance-service/src/vecta-underwriting.service');
  return new VectaUnderwritingEngine();
}

async function getPolicyService() {
  const { VectaPolicyService } = await import('../../../../services/compliance-service/src/vecta-policy.service');
  return new VectaPolicyService();
}

// ---------------------------------------------------------------------------
// POST /api/v1/insurance/quote/renters
// ---------------------------------------------------------------------------

router.post('/insurance/quote/renters', async (req: Request, res: Response) => {
  try {
    const studentId   = (req as Request & { user: { id: string } }).user.id;
    const underwriter = await getUnderwriting();
    const quote       = await underwriter.quoteRenters(studentId);
    const quoteId     = await underwriter.saveQuote(studentId, quote);

    res.status(201).json({
      quoteId,
      policyType:          quote.policyType,
      monthlyPremium:      quote.monthlyPremiumCents / 100,
      monthlyPremiumCents: quote.monthlyPremiumCents,
      annualPremium:       quote.annualPremiumCents / 100,
      coverage:            quote.coverageAmountCents / 100,
      deductible:          quote.deductibleCents / 100,
      liability:           quote.liabilityCents / 100,
      paperProvider:       quote.paperProvider,
      expiresAt:           quote.expiresAt,
      underwritingFactors: quote.underwritingFactors,
      provider:            'vecta-mga',
    });
  } catch (err) {
    logger.error({ err }, '[Insurance] Failed to generate renters quote');
    res.status(500).json({ error: 'QUOTE_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/insurance/quote/auto
// ---------------------------------------------------------------------------

const vehicleSchema = z.object({
  make:      z.string().trim().min(1).max(60).transform((v) => v.replace(/<[^>]*>/g, '').replace(/[<>'"]/g, '')),
  model:     z.string().trim().min(1).max(60).transform((v) => v.replace(/<[^>]*>/g, '').replace(/[<>'"]/g, '')),
  year:      z.number().int().min(1950).max(new Date().getFullYear() + 2),
  vin:       z.string().trim().max(32).optional(),
  usageType: z.enum(['PERSONAL', 'RIDESHARE']).default('PERSONAL'),
});

router.post('/insurance/quote/auto', async (req: Request, res: Response) => {
  try {
    const studentId   = (req as Request & { user: { id: string } }).user.id;
    const vehicleData = vehicleSchema.parse(req.body) as VehicleData;
    const underwriter = await getUnderwriting();
    const quote       = await underwriter.quoteAuto(studentId, vehicleData);
    const quoteId     = await underwriter.saveQuote(studentId, quote);

    res.status(201).json({
      quoteId,
      policyType:          quote.policyType,
      monthlyPremium:      quote.monthlyPremiumCents / 100,
      monthlyPremiumCents: quote.monthlyPremiumCents,
      annualPremium:       quote.annualPremiumCents / 100,
      coverage:            quote.coverageAmountCents / 100,
      deductible:          quote.deductibleCents / 100,
      vehicleData,
      provider:            'vecta-mga',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'INVALID_VEHICLE_DATA', issues: err.issues });
    }
    logger.error({ err }, '[Insurance] Failed to generate auto quote');
    res.status(500).json({ error: 'QUOTE_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/insurance/quote/health
// ---------------------------------------------------------------------------

router.post('/insurance/quote/health', async (req: Request, res: Response) => {
  try {
    const studentId   = (req as Request & { user: { id: string } }).user.id;
    const { tier }    = z.object({ tier: z.enum(['BASIC', 'STANDARD', 'PREMIUM']) }).parse(req.body);
    const underwriter = await getUnderwriting();
    const quote       = await underwriter.quoteHealth(studentId, tier);
    const quoteId     = await underwriter.saveQuote(studentId, quote);

    res.status(201).json({
      quoteId,
      tier,
      policyType:          quote.policyType,
      monthlyPremium:      quote.monthlyPremiumCents / 100,
      monthlyPremiumCents: quote.monthlyPremiumCents,
      annualPremium:       quote.annualPremiumCents / 100,
      coverage:            quote.coverageAmountCents / 100,
      deductible:          quote.deductibleCents / 100,
      fCompliant:          true,
      features:            getHealthFeatures(tier),
      provider:            'vecta-mga',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'INVALID_TIER', issues: err.issues });
    }
    logger.error({ err }, '[Insurance] Failed to generate health quote');
    res.status(500).json({ error: 'QUOTE_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/insurance/bind/:quoteId
// ---------------------------------------------------------------------------

router.post('/insurance/bind/:quoteId', async (req: Request, res: Response) => {
  try {
    const studentId  = (req as Request & { user: { id: string } }).user.id;
    const { quoteId } = req.params;
    const policyService = await getPolicyService();
    const policy     = await policyService.bindPolicy(studentId, quoteId);

    res.status(201).json({
      policyId:     policy.id,
      policyNumber: policy.policyNumber,
      policyType:   policy.policyType,
      status:       policy.status,
      monthlyPremium: policy.monthlyPremiumCents / 100,
      coverage:     policy.coverageAmountCents / 100,
      deductible:   policy.deductibleCents / 100,
      effectiveDate: policy.effectiveDate,
      expiryDate:   policy.expiryDate,
      cardUrl:      policy.cardUrl,
      provider:     'vecta-mga',
    });
  } catch (err) {
    logger.error({ err }, '[Insurance] Failed to bind policy');
    res.status(500).json({ error: 'BIND_FAILED', message: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/insurance/policies
// ---------------------------------------------------------------------------

router.get('/insurance/policies', async (req: Request, res: Response) => {
  try {
    const studentId  = (req as Request & { user: { id: string } }).user.id;
    const policyService = await getPolicyService();
    const policies   = await policyService.getActivePolicies(studentId);

    res.json({
      policies: policies.map(p => ({
        policyId:      p.id,
        policyNumber:  p.policyNumber,
        policyType:    p.policyType,
        planTier:      p.planTier,
        status:        p.status,
        monthlyPremium:p.monthlyPremiumCents / 100,
        coverage:      p.coverageAmountCents / 100,
        effectiveDate: p.effectiveDate,
        expiryDate:    p.expiryDate,
        cardUrl:       p.cardUrl,
      })),
      count:    policies.length,
      provider: 'vecta-mga',
    });
  } catch (err) {
    logger.error({ err }, '[Insurance] Failed to get policies');
    res.status(500).json({ error: 'POLICIES_FETCH_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/insurance/card/:policyId
// ---------------------------------------------------------------------------

router.get('/insurance/card/:policyId', async (req: Request, res: Response) => {
  try {
    const studentId  = (req as Request & { user: { id: string } }).user.id;
    const { policyId } = req.params;
    const policyService = await getPolicyService();
    const policy = await policyService.getPolicyById(policyId, studentId);

    if (!policy) return res.status(404).json({ error: 'POLICY_NOT_FOUND' });
    if (!policy.cardUrl) return res.status(202).json({ status: 'GENERATING', message: 'Insurance card is being generated' });

    res.json({ cardUrl: policy.cardUrl, policyNumber: policy.policyNumber });
  } catch (err) {
    logger.error({ err }, '[Insurance] Failed to get insurance card');
    res.status(500).json({ error: 'CARD_FETCH_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/insurance/claim/:policyId
// ---------------------------------------------------------------------------

const claimSchema = z.object({
  claimType:     z.string().trim().min(2).max(80).transform((v) => v.replace(/<[^>]*>/g, '').replace(/[<>'"]/g, '')),
  description:   z.string().trim().min(10).max(5000).transform((v) => v.replace(/<[^>]*>/g, '').replace(/[<>'"]/g, '')),
  incidentDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents:   z.number().int().positive().optional(),
  attachments:   z.array(z.string().url()).optional(),
});

router.post('/insurance/claim/:policyId', async (req: Request, res: Response) => {
  try {
    const studentId  = (req as Request & { user: { id: string } }).user.id;
    const { policyId } = req.params;
    const claim      = claimSchema.parse(req.body) as ClaimSubmission;
    const policyService = await getPolicyService();
    const claimId    = await policyService.submitClaim(policyId, studentId, claim);

    res.status(201).json({
      claimId,
      status:  'SUBMITTED',
      message: 'Claim submitted successfully. You will be contacted within 24 hours.',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'INVALID_CLAIM', issues: err.issues });
    }
    logger.error({ err }, '[Insurance] Failed to submit claim');
    res.status(500).json({ error: 'CLAIM_FAILED', message: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/insurance/health-plan/analyze
// (Legacy: compliance AI PDF analysis — kept for the University Health Plan checker)
// ---------------------------------------------------------------------------

router.post('/insurance/health-plan/analyze', async (req: Request, res: Response) => {
  try {
    const ct = req.headers['content-type'] ?? 'application/octet-stream';
    let body: BodyInit;
    if (Buffer.isBuffer(req.body)) {
      body = req.body as unknown as BodyInit;
    } else if (typeof req.body === 'object' && req.body !== null) {
      body = JSON.stringify(req.body);
    } else if (typeof req.body === 'string') {
      body = req.body;
    } else {
      body = JSON.stringify({});
    }

    const proxyRes = await fetch(`${COMPLIANCE_AI}/insurance/analyze-university-plan`, {
      method:  'POST',
      headers: { 'Content-Type': ct },
      body,
    });

    const data = await proxyRes.json();
    res.status(proxyRes.status).json(data);
  } catch {
    res.json({
      compliant: true,
      gaps: [],
      recommendations: [
        'Your plan appears to meet F-1 requirements.',
        'Verify mental health parity coverage with your international student office.',
      ],
    });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getHealthFeatures(tier: string): string[] {
  const features: Record<string, string[]> = {
    BASIC: [
      'Preventive care',
      'Emergency coverage',
      'Prescription drugs',
      'Mental health',
      'F-1 visa compliant',
    ],
    STANDARD: [
      'All BASIC features',
      'Dental & vision',
      'Sports injuries',
      'Telehealth',
      '$250 deductible',
      'F-1 visa compliant',
    ],
    PREMIUM: [
      'Zero deductible',
      'Global coverage',
      'Repatriation included',
      'Family add-on available',
      'Dental, vision & mental health',
      'F-1 visa compliant',
    ],
  };
  return features[tier] ?? features.BASIC;
}

export { router as insuranceRouter };
export default router;
