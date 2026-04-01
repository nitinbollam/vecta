/**
 * services/compliance-service/src/vecta-underwriting.service.ts
 *
 * Vecta Proprietary Underwriting Engine — replaces Lemonade, ISO, PSI
 *
 * Competitive advantage:
 *   Traditional insurers price F-1 students as high-risk unknowns.
 *   Vecta can price LOWER because we have verified:
 *     - NFC passport identity (not an anonymous applicant)
 *     - Real bank balance via VectaConnect (not self-reported)
 *     - University enrollment (low-risk demographic)
 *     - Solvency tier (payment reliability indicator)
 *
 * This lets us undercut Lemonade by 10-30% while remaining profitable.
 */

import { createLogger } from '@vecta/logger';
import { query, queryOne } from '@vecta/database';
import { vectaMGA } from '@vecta/providers';

const logger = createLogger('vecta-underwriting');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InsuranceQuote {
  id?:                  string;
  policyType:           'RENTERS' | 'AUTO' | 'HEALTH';
  planTier?:            'BASIC' | 'STANDARD' | 'PREMIUM';
  monthlyPremiumCents:  number;
  annualPremiumCents:   number;
  coverageAmountCents:  number;
  deductibleCents:      number;
  liabilityCents:       number;
  paperProvider:        string;
  expiresAt:            Date;
  underwritingFactors:  UnderwritingFactors;
}

export interface UnderwritingFactors {
  baseRateCents:        number;
  nfcDiscount:          number;
  solvencyDiscount:     number;
  universityDiscount:   number;
  cityMultiplier:       number;
  finalPremiumCents:    number;
}

export interface VehicleData {
  make:       string;
  model:      string;
  year:       number;
  vin?:       string;
  usageType:  'PERSONAL' | 'RIDESHARE';
}

type SolvencyTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

interface VerifiedStudentData {
  id:                  string;
  firstName:           string;
  lastName:            string;
  city:                string;
  state:               string;
  nfcVerified:         boolean;
  solvencyTier:        SolvencyTier;
  universityVerified:  boolean;
  universityName:      string;
  bankBalanceCents:    number;
}

// ---------------------------------------------------------------------------
// City rate multipliers (based on renter cost-of-living and claim frequency)
// ---------------------------------------------------------------------------

const CITY_RATE_MULTIPLIERS: Record<string, number> = {
  // High cost / high claim frequency
  'New York':        1.45,
  'San Francisco':   1.40,
  'Los Angeles':     1.35,
  'Boston':          1.30,
  'Seattle':         1.25,
  'Washington DC':   1.25,
  'Chicago':         1.20,
  'Miami':           1.20,
  // Medium cost
  'Philadelphia':    1.15,
  'Austin':          1.10,
  'Denver':          1.10,
  'Atlanta':         1.08,
  'Houston':         1.05,
  'Dallas':          1.05,
  // Below-average cost
  'Phoenix':         1.00,
  'Columbus':        0.95,
  'Raleigh':         0.95,
  'Pittsburgh':      0.90,
  'Cleveland':       0.88,
  // Default
  'DEFAULT':         1.00,
};

// ---------------------------------------------------------------------------
// VectaUnderwritingEngine
// ---------------------------------------------------------------------------

export class VectaUnderwritingEngine {

  // ---------------------------------------------------------------------------
  // Renters Insurance
  // ---------------------------------------------------------------------------

  /**
   * Quote renters insurance for a verified Vecta student.
   *
   * Base rate: $8/month (vs Lemonade's $10-15)
   * Discounts available only to Vecta verified students — our key moat.
   */
  async quoteRenters(studentId: string): Promise<InsuranceQuote> {
    const student = await this.getVerifiedStudentData(studentId);

    // Base rate
    let monthlyPremiumCents = 800;  // $8.00
    const factors: Partial<UnderwritingFactors> = { baseRateCents: monthlyPremiumCents };

    // NFC passport verified: -$1.00/month (reduces fraud risk significantly)
    const nfcDiscount = student.nfcVerified ? 100 : 0;
    monthlyPremiumCents -= nfcDiscount;

    // Verified solvency tier: -$0.50/month for HIGH/VERY_HIGH (reduces non-payment risk)
    const solvencyDiscount = (student.solvencyTier === 'HIGH' || student.solvencyTier === 'VERY_HIGH') ? 50 : 0;
    monthlyPremiumCents -= solvencyDiscount;

    // University affiliation verified: -$0.50/month (better risk profile)
    const universityDiscount = student.universityVerified ? 50 : 0;
    monthlyPremiumCents -= universityDiscount;

    // City multiplier: NYC costs more than Columbus
    const cityMultiplier = this.getCityRateMultiplier(student.city);
    monthlyPremiumCents  = Math.round(monthlyPremiumCents * cityMultiplier);

    // Minimum $5/month
    monthlyPremiumCents = Math.max(monthlyPremiumCents, 500);

    const finalFactors: UnderwritingFactors = {
      baseRateCents:     800,
      nfcDiscount,
      solvencyDiscount,
      universityDiscount,
      cityMultiplier,
      finalPremiumCents: monthlyPremiumCents,
    };

    logger.info({ studentId, monthlyPremiumCents, factors: finalFactors }, '[Underwriting] Renters quote generated');

    return {
      policyType:          'RENTERS',
      monthlyPremiumCents,
      annualPremiumCents:  monthlyPremiumCents * 12,
      coverageAmountCents: 3_000_000,    // $30,000 personal property
      deductibleCents:     50_000,       // $500
      liabilityCents:      10_000_000,   // $100,000
      paperProvider:       'boost',
      expiresAt:           new Date(Date.now() + 24 * 3600_000),
      underwritingFactors: finalFactors,
    };
  }

  // ---------------------------------------------------------------------------
  // Auto Insurance
  // ---------------------------------------------------------------------------

  async quoteAuto(studentId: string, vehicleData: VehicleData): Promise<InsuranceQuote> {
    const student = await this.getVerifiedStudentData(studentId);

    // Base rate: $45/month
    let monthlyPremiumCents = 4500;

    // Vehicle age factor: newer cars cost more to insure
    const vehicleAge    = new Date().getFullYear() - vehicleData.year;
    if (vehicleAge < 3)  monthlyPremiumCents += 1500;   // New car: +$15
    else if (vehicleAge < 7) monthlyPremiumCents += 500; // Mid-age: +$5
    else monthlyPremiumCents -= 500;                     // Older: -$5

    // Rideshare use: +$15/month
    if (vehicleData.usageType === 'RIDESHARE') monthlyPremiumCents += 1500;

    // NFC verified identity discount: -$5/month
    if (student.nfcVerified) monthlyPremiumCents -= 500;

    // Solvency discount: -$3/month
    if (student.solvencyTier === 'HIGH' || student.solvencyTier === 'VERY_HIGH') {
      monthlyPremiumCents -= 300;
    }

    // City multiplier
    const cityMultiplier = this.getCityRateMultiplier(student.city);
    monthlyPremiumCents  = Math.round(monthlyPremiumCents * cityMultiplier);
    monthlyPremiumCents  = Math.max(monthlyPremiumCents, 3500);  // minimum $35

    return {
      policyType:          'AUTO',
      monthlyPremiumCents,
      annualPremiumCents:  monthlyPremiumCents * 12,
      coverageAmountCents: 100_000_00,     // $1,000,000 liability
      deductibleCents:     100_000,        // $1,000
      liabilityCents:      30_000_000,     // $300,000
      paperProvider:       'boost',
      expiresAt:           new Date(Date.now() + 24 * 3600_000),
      underwritingFactors: {
        baseRateCents:     4500,
        nfcDiscount:       student.nfcVerified ? 500 : 0,
        solvencyDiscount:  0,
        universityDiscount:0,
        cityMultiplier,
        finalPremiumCents: monthlyPremiumCents,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Student Health Plans
  // ---------------------------------------------------------------------------

  async quoteHealth(studentId: string, planTier: 'BASIC' | 'STANDARD' | 'PREMIUM'): Promise<InsuranceQuote> {
    const rates: Record<string, {
      premium:      number;
      deductible:   number;
      coverage:     number;
      liability:    number;
    }> = {
      BASIC: {
        premium:    8900,      // $89
        deductible: 50_000,   // $500
        coverage:   50_000_000,  // $500,000
        liability:  0,
      },
      STANDARD: {
        premium:    14_900,   // $149
        deductible: 25_000,   // $250
        coverage:   100_000_000, // $1M
        liability:  0,
      },
      PREMIUM: {
        premium:    19_900,   // $199
        deductible: 0,
        coverage:   200_000_000, // $2M
        liability:  0,
      },
    };

    const rate = rates[planTier];

    return {
      policyType:          'HEALTH',
      planTier,
      monthlyPremiumCents: rate.premium,
      annualPremiumCents:  rate.premium * 12,
      coverageAmountCents: rate.coverage,
      deductibleCents:     rate.deductible,
      liabilityCents:      0,
      paperProvider:       'state-national',
      expiresAt:           new Date(Date.now() + 24 * 3600_000),
      underwritingFactors: {
        baseRateCents:     rate.premium,
        nfcDiscount:       0,
        solvencyDiscount:  0,
        universityDiscount:0,
        cityMultiplier:    1.0,
        finalPremiumCents: rate.premium,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Save quote to DB
  // ---------------------------------------------------------------------------

  async saveQuote(studentId: string, quote: InsuranceQuote): Promise<string> {
    const result = await query(`
      INSERT INTO insurance_quotes (
        student_id, policy_type, plan_tier,
        monthly_premium_cents, annual_premium_cents,
        coverage_amount_cents, deductible_cents, liability_cents,
        paper_provider, expires_at, underwriting_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `, [
      studentId,
      quote.policyType,
      quote.planTier ?? null,
      quote.monthlyPremiumCents,
      quote.annualPremiumCents,
      quote.coverageAmountCents,
      quote.deductibleCents,
      quote.liabilityCents,
      quote.paperProvider,
      quote.expiresAt.toISOString(),
      JSON.stringify(quote.underwritingFactors),
    ]);

    return result.rows[0].id as string;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getCityRateMultiplier(city: string): number {
    const key = Object.keys(CITY_RATE_MULTIPLIERS).find(
      k => k.toLowerCase() === (city ?? '').toLowerCase(),
    );
    return CITY_RATE_MULTIPLIERS[key ?? 'DEFAULT'];
  }

  /**
   * RIDE_TNC — commercial TNC coverage via Vecta MGA + Boost paper carrier.
   * Personal auto policies are not primary for on-platform rides.
   */
  /**
   * Bind via Vecta MGA (Boost paper). Does not persist; use policy service or TNC bind for DB rows.
   */
  async bindPolicy(
    studentId: string,
    params: {
      policyType:          string;
      coverageAmountCents: number;
      deductibleCents:     number;
      monthlyPremiumCents: number;
      paperProvider:       string;
      underwritingData:    Record<string, unknown>;
    },
  ): Promise<{ policyId: string; policyNumber: string; cardUrl: string }> {
    const policyType = params.policyType as 'RENTERS' | 'AUTO' | 'HEALTH' | 'AUTO_TNC';

    const result = await vectaMGA.bindPolicy({
      studentId,
      policyType,
      coverageAmountCents: params.coverageAmountCents,
      deductibleCents:     params.deductibleCents,
      monthlyPremiumCents: params.monthlyPremiumCents,
      underwritingData: {
        ...params.underwritingData,
        quotedPaperProvider: params.paperProvider,
      },
      paperProvider:       'BOOST_INSURANCE',
    });

    return {
      policyId:     result.policyId,
      policyNumber: result.policyNumber,
      cardUrl:      result.cardUrl,
    };
  }

  async quoteTNCCoverage(driverId: string): Promise<{
    periodOneCents: number;
    periodTwoCents: number;
    periodThreeCents: number;
    perMileCents: number;
    annualPremiumCents: number;
  }> {
    const driver = await this.getDriverProfile(driverId);
    let perMileCents = 8;
    const rating = Number(driver.rating ?? 5);
    if (rating >= 4.8) perMileCents = 6;
    if (rating < 4.0) perMileCents = 12;
    const vy = Number(driver.vehicle_year ?? 2020);
    if (vy < 2015) perMileCents += 2;

    return {
      periodOneCents: 0,
      periodTwoCents: perMileCents,
      periodThreeCents: perMileCents,
      perMileCents,
      annualPremiumCents: perMileCents * 12000,
    };
  }

  async bindTNCPolicy(driverId: string): Promise<{
    policyId: string;
    policyNumber: string;
    status: string;
    cardUrl: string;
  }> {
    const quote = await this.quoteTNCCoverage(driverId);
    const driver = await this.getDriverProfile(driverId);

    const result = await vectaMGA.bindPolicy({
      studentId:           driver.student_id,
      policyType:          'AUTO_TNC',
      coverageAmountCents: 100_000_000,
      deductibleCents:     100_000,
      monthlyPremiumCents: Math.round(quote.perMileCents * 1000),
      underwritingData: {
        tncPeriods:   ['PERIOD_2', 'PERIOD_3'],
        perMileCents: quote.perMileCents,
        vehicleUsage: 'RIDESHARE',
      },
      paperProvider: 'BOOST_INSURANCE',
    });

    const effective = new Date();
    const expiry = new Date(effective);
    expiry.setFullYear(expiry.getFullYear() + 1);

    const dbStatus = result.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING_PAYMENT';

    const row = await queryOne<{ id: string }>(
      `
      INSERT INTO insurance_policies (
        student_id, policy_type, policy_number,
        status, coverage_amount_cents, deductible_cents, liability_cents,
        monthly_premium_cents, annual_premium_cents,
        effective_date, expiry_date,
        paper_provider, paper_policy_ref, underwriting_data, card_url
      ) VALUES (
        $1, 'AUTO_TNC', $2, $3,
        100000000, 100000, 100000000,
        $4, $5,
        $6::date, $7::date,
        'boost', $8, $9::jsonb,
        $10
      )
      RETURNING id
    `,
      [
        driver.student_id,
        result.policyNumber,
        dbStatus,
        Math.round(quote.perMileCents * 1000),
        quote.annualPremiumCents,
        effective.toISOString().slice(0, 10),
        expiry.toISOString().slice(0, 10),
        result.paperRef,
        JSON.stringify({
          tncPeriods: ['PERIOD_2', 'PERIOD_3'],
          perMileCents: quote.perMileCents,
          vehicleUsage: 'RIDESHARE',
          paperCarrier: 'BOOST_INSURANCE',
          mgaPolicyId: result.policyId,
        }),
        result.cardUrl || null,
      ],
    );

    return {
      policyId:     String(row!.id),
      policyNumber: result.policyNumber,
      status:       result.status,
      cardUrl:      result.cardUrl || `https://verify.vecta.io/insurance/${result.policyNumber}`,
    };
  }

  private async getDriverProfile(driverId: string): Promise<{
    id: string;
    student_id: string;
    rating: number;
    vehicle_year: number | null;
  }> {
    const row = await queryOne<{
      id: string;
      student_id: string;
      rating: string | null;
      vehicle_year: number | null;
    }>(
      `SELECT id, student_id, rating, vehicle_year FROM driver_profiles WHERE id = $1`,
      [driverId],
    );
    if (!row) {
      throw new Error(`Driver not found: ${driverId}`);
    }
    return {
      id: String(row.id),
      student_id: String(row.student_id),
      rating: Number(row.rating ?? 5),
      vehicle_year: row.vehicle_year,
    };
  }

  private async getVerifiedStudentData(studentId: string): Promise<VerifiedStudentData> {
    const row = await queryOne(`
      SELECT
        s.id, s.first_name, s.last_name,
        s.city, s.state,
        s.nfc_verified,
        s.solvency_tier,
        s.university_name,
        s.university_verified,
        COALESCE(lb.available_balance_cents, 0) AS bank_balance_cents
      FROM students s
      LEFT JOIN ledger_balances lb ON lb.student_id = s.id
      WHERE s.id = $1
    `, [studentId]);

    if (!row) throw new Error(`Student not found: ${studentId}`);

    return {
      id:                 String(row.id),
      firstName:          String(row.first_name ?? ''),
      lastName:           String(row.last_name ?? ''),
      city:               String(row.city ?? ''),
      state:              String(row.state ?? ''),
      nfcVerified:        Boolean(row.nfc_verified),
      solvencyTier:       (String(row.solvency_tier ?? 'MEDIUM')) as SolvencyTier,
      universityVerified: Boolean(row.university_verified),
      universityName:     String(row.university_name ?? ''),
      bankBalanceCents:   Number(row.bank_balance_cents ?? 0),
    };
  }
}
