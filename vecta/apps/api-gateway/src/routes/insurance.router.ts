/**
 * apps/api-gateway/src/routes/insurance.router.ts
 *
 * Insurance routes:
 *   GET  /api/v1/insurance/quotes/renters     — Lemonade renters quote
 *   GET  /api/v1/insurance/quotes/auto        — Lemonade auto quote (LESSOR only)
 *   POST /api/v1/insurance/health-plan/analyze — Proxy to compliance-ai (Claude Vision)
 *   GET  /api/v1/insurance/quotes/all         — ISO + PSI health insurance quotes
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, requireKYC } from '@vecta/auth';
import { createLogger } from '@vecta/logger';
import { lemonadeService } from '../../../../services/identity-service/src/lemonade.service';

const logger = createLogger('insurance-router');
const router = Router();

router.use(authMiddleware);
router.use(requireKYC('APPROVED'));

const COMPLIANCE_AI = process.env.COMPLIANCE_AI_URL ?? 'http://compliance-ai:8000';

// ---------------------------------------------------------------------------
// Renters insurance quote
// ---------------------------------------------------------------------------

router.get('/insurance/quotes/renters', async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;

    const params = z.object({
      monthlyRent:      z.coerce.number().positive().max(20_000),
      city:             z.string().min(2).max(100),
      state:            z.string().length(2).toUpperCase(),
      zipCode:          z.string().min(5).max(10),
      propertyAddress:  z.string().optional(),
    }).parse(req.query);

    // Fetch student profile for name + DOB
    const { queryOne } = await import('@vecta/database');
    const student = await queryOne<{
      full_name: string; verified_email: string; trust_score: number | null;
    }>(
      'SELECT full_name, verified_email, trust_score FROM students WHERE id = $1',
      [studentId],
    );

    if (!student) { res.status(404).json({ error: 'STUDENT_NOT_FOUND' }); return; }

    const quote = await lemonadeService.getRentersQuote({
      studentId,
      fullName:      student.full_name,
      dateOfBirth:   '1999-01-01',   // placeholder — full DOB not stored
      email:         student.verified_email,
      propertyAddress: params.propertyAddress ?? '',
      city:          params.city,
      state:         params.state,
      zipCode:       params.zipCode,
      monthlyRent:   params.monthlyRent,
      coverageRequested: {
        personalProperty: 10_000,
        liability:        100_000,
        lossOfUse:        3_000,
      },
      novaCreditScore:     student.trust_score ?? undefined,
      isFurnishedApartment: false,
    });

    res.json({ quote });
  } catch (err) {
    logger.error({ err }, 'Renters quote failed');
    res.status(500).json({ error: 'QUOTE_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Auto insurance quote (LESSOR vehicles only)
// ---------------------------------------------------------------------------

router.get('/insurance/quotes/auto', async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;
    const role      = req.vectaUser!.role;

    if (role !== 'LESSOR') {
      res.status(422).json({
        error:   'LESSOR_REQUIRED',
        message: 'Auto insurance quotes are only available for enrolled vehicle LESSORs.',
      });
      return;
    }

    const params = z.object({
      vin:           z.string().length(17),
      vehicleYear:   z.coerce.number().int().min(2000),
      make:          z.string(),
      model:         z.string(),
      garageZipCode: z.string().min(5),
      annualMileage: z.coerce.number().int().min(1000).max(50_000).default(8000),
    }).parse(req.query);

    const { queryOne } = await import('@vecta/database');
    const student = await queryOne<{
      full_name: string; verified_email: string; trust_score: number | null;
    }>(
      'SELECT full_name, verified_email, trust_score FROM students WHERE id = $1',
      [studentId],
    );

    if (!student) { res.status(404).json({ error: 'STUDENT_NOT_FOUND' }); return; }

    const quote = await lemonadeService.getAutoQuote({
      studentId,
      fullName:    student.full_name,
      dateOfBirth: '1999-01-01',
      email:       student.verified_email,
      passportNumber: 'REDACTED',   // Not used for quote, only for bind
      visaType:    'F-1',
      i20ExpirationYear: new Date().getFullYear() + 2,
      garageZipCode: params.garageZipCode,
      vehicle: {
        vin:         params.vin,
        year:        params.vehicleYear,
        make:        params.make,
        model:       params.model,
        primaryUse:  'personal',   // F-1 LESSOR constraint enforced here
        annualMileage: params.annualMileage,
      },
      novaCreditScore: student.trust_score ?? undefined,
      coverageRequested: {
        liability:     { bodily: '100/300', property: '100' },
        collision:     true,
        comprehensive: true,
        deductible:    500,
      },
    });

    res.json({ quote });
  } catch (err) {
    logger.error({ err }, 'Auto quote failed');
    if (err instanceof Error && err.message.includes('F1_LESSOR')) {
      res.status(422).json({ error: 'F1_CONSTRAINT', message: err.message });
      return;
    }
    res.status(500).json({ error: 'QUOTE_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Health plan analysis proxy → compliance-ai (Claude Vision)
// ---------------------------------------------------------------------------

router.post('/insurance/health-plan/analyze', async (req: Request, res: Response) => {
  try {
    // Forward multipart/form-data directly to compliance-ai
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.includes('multipart/form-data')) {
      res.status(400).json({ error: 'MULTIPART_REQUIRED' }); return;
    }

    const studentId = req.vectaUser!.sub;
    const passHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!['content-type', 'content-length'].includes(k)) continue;
      if (typeof v === 'string') passHeaders[k] = v;
      if (Array.isArray(v) && v.length > 0) passHeaders[k] = v[0]!;
    }
    passHeaders['x-student-id'] = studentId;

    // Rebuild fetch with same headers and raw stream body
    const upstreamRes = await fetch(
      `${COMPLIANCE_AI}/insurance/analyze-university-plan`,
      {
        method: 'POST',
        headers: passHeaders,
        body: req as unknown as ReadableStream,
        duplex: 'half' as 'half',
      } as unknown as RequestInit,
    );

    const data = await upstreamRes.json();
    res.status(upstreamRes.status).json(data);
  } catch (err) {
    logger.error({ err }, 'Health plan analysis proxy failed');
    res.status(500).json({ error: 'ANALYSIS_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// ISO + PSI quotes
// ---------------------------------------------------------------------------

router.get('/insurance/quotes/health', async (req: Request, res: Response) => {
  try {
    const studentId = req.vectaUser!.sub;

    const { queryOne } = await import('@vecta/database');
    const student = await queryOne<{ university_name: string | null }>(
      'SELECT university_name FROM students WHERE id = $1',
      [studentId],
    );

    const upstreamRes = await fetch(
      `${COMPLIANCE_AI}/insurance/iso-quotes?` +
      `student_id=${encodeURIComponent(studentId)}&` +
      `university=${encodeURIComponent(student?.university_name ?? '')}`,
    );

    if (!upstreamRes.ok) {
      res.status(upstreamRes.status).json({ error: 'QUOTES_UNAVAILABLE' }); return;
    }

    const data = await upstreamRes.json();
    res.json(data);
  } catch (err) {
    logger.error({ err }, 'Health insurance quotes failed');
    res.status(500).json({ error: 'QUOTES_FAILED' });
  }
});

export { router as insuranceRouter };
