/**
 * services/housing-service/src/vecta-credit-bridge.service.ts
 *
 * Vecta Credit Bridge — replaces Nova Credit
 *
 * Routes to the right credit bureau by the student's home country.
 * For countries without a bureau integration, computes an alternative
 * score from verified Vecta data (bank balance, income, NFC identity).
 *
 * All national ID values used for bureau lookups are decrypted
 * ONLY for the duration of the API call and never logged.
 */

import { createLogger, logAuditEvent } from '@vecta/logger';
import { queryOne } from '@vecta/database';
import { createDecipheriv } from 'crypto';

const logger = createLogger('vecta-credit-bridge');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreditBridgeResult {
  studentId:       string;
  usEquivalentScore: number;     // 300-850
  originalScore?:  number;
  originalRange?:  string;       // e.g. "300-900"
  bureau?:         string;       // CIBIL | Experian_UK | Equifax_CA | etc.
  scoreMethod:     'BUREAU' | 'ALTERNATIVE' | 'COMPOSITE';
  solvencyTier:    'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  factors:         string[];     // positive/negative factors
  reportDate:      Date;
  f1SafeToShare:   boolean;      // true if safe to share with landlord (no raw national ID)
}

export interface BureauScore {
  score:      number;
  range:      { min: number; max: number };
  bureau:     string;
  reportDate: Date;
  factors?:   string[];
}

// ---------------------------------------------------------------------------
// Country → bureau mapping
// ---------------------------------------------------------------------------

const BUREAU_MAP: Record<string, string> = {
  'IND': 'CIBIL',
  'MEX': 'BURO_DE_CREDITO',
  'GBR': 'EXPERIAN_UK',
  'CAN': 'EQUIFAX_CANADA',
  'AUS': 'EQUIFAX_AUSTRALIA',
  'BRA': 'SERASA',
  'DEU': 'SCHUFA',
  'KOR': 'KCB',
  'NLD': 'BKR',
  'FRA': 'BANQUE_DE_FRANCE',
};

// Scale maps: min and max of each country's credit score range
const SCORE_SCALES: Record<string, { min: number; max: number }> = {
  CIBIL:            { min: 300,  max: 900  },
  BURO_DE_CREDITO:  { min: 442,  max: 850  },
  EXPERIAN_UK:      { min: 0,    max: 999  },
  EQUIFAX_CANADA:   { min: 300,  max: 900  },
  EQUIFAX_AUSTRALIA:{ min: 0,    max: 1200 },
  SERASA:           { min: 0,    max: 1000 },
  SCHUFA:           { min: 0,    max: 100  },  // SCHUFA is inverted: higher = better
  KCB:              { min: 0,    max: 1000 },
  BKR:              { min: 0,    max: 10   },  // Dutch system
  BANQUE_DE_FRANCE: { min: 0,    max: 9    },  // French system: 3 best, 9 worst (inverted)
};

// ---------------------------------------------------------------------------
// VectaCreditBridge
// ---------------------------------------------------------------------------

export class VectaCreditBridge {

  /**
   * Get a US-equivalent credit score for a student.
   * Routes to the appropriate bureau by country of origin,
   * or falls back to VectaConnect alternative scoring.
   */
  async getCreditScore(studentId: string): Promise<CreditBridgeResult> {
    const student = await this.getStudentWithDecryptedCountry(studentId);

    void logAuditEvent('CREDIT_SCORE_REQUESTED', studentId, 'housing.credit', {
      country:     student.country,
      scoreMethod: BUREAU_MAP[student.country] ? 'BUREAU' : 'ALTERNATIVE',
    });

    const bureauName = BUREAU_MAP[student.country];

    if (!bureauName) {
      // No bureau for this country — use alternative scoring
      logger.info({ studentId, country: student.country }, '[CreditBridge] No bureau — using alternative score');
      const altScore = await this.computeAlternativeScore(studentId);
      return this.buildResult(studentId, altScore, 'ALTERNATIVE');
    }

    try {
      const bureauScore = await this.fetchFromBureau(bureauName, student);
      const usScore     = this.translateToUSScale(bureauScore.score, bureauName);

      return {
        studentId,
        usEquivalentScore: usScore,
        originalScore:     bureauScore.score,
        originalRange:     `${bureauScore.range.min}-${bureauScore.range.max}`,
        bureau:            bureauName,
        scoreMethod:       'BUREAU',
        solvencyTier:      this.scoreToTier(usScore),
        factors:           bureauScore.factors ?? [],
        reportDate:        bureauScore.reportDate,
        f1SafeToShare:     true,
      };
    } catch (err) {
      logger.warn({ err, studentId, bureauName }, '[CreditBridge] Bureau fetch failed — using alternative score');
      const altScore = await this.computeAlternativeScore(studentId);
      return this.buildResult(studentId, altScore, 'COMPOSITE');
    }
  }

  // ---------------------------------------------------------------------------
  // Vecta Alternative Scoring
  // ---------------------------------------------------------------------------

  /**
   * Proprietary alternative credit score for students with no bureau data.
   *
   * Inputs (all Vecta-verified):
   *   - Bank balance via VectaConnect (40% weight) — strongest predictor
   *   - Account age (20% weight) — older = more stable
   *   - Consistent income deposits (20% weight)
   *   - University enrollment verified (10% weight)
   *   - NFC passport verified (10% weight)
   *
   * Output: 300-850 US-equivalent score
   */
  async computeAlternativeScore(studentId: string): Promise<number> {
    const row = await queryOne(`
      SELECT
        s.nfc_verified,
        s.university_verified,
        s.solvency_tier,
        COALESCE(lb.available_balance_cents, 0)  AS balance,
        COALESCE(
          (SELECT AVG(amount_cents)
           FROM ledger_entries
           WHERE account_id = la.id
             AND entry_type = 'CREDIT'
             AND created_at > NOW() - INTERVAL '90 days'),
          0
        ) AS avg_monthly_credit,
        EXTRACT(EPOCH FROM (NOW() - la.created_at)) / 86400 AS account_age_days
      FROM students s
      LEFT JOIN ledger_accounts la  ON la.student_id = s.id AND la.status = 'ACTIVE'
      LEFT JOIN ledger_balances  lb ON lb.account_id = la.id
      WHERE s.id = $1
    `, [studentId]);

    if (!row) return 400;  // default low score

    const balance      = Number(row.balance ?? 0);
    const avgCredit    = Number(row.avg_monthly_credit ?? 0);
    const accountAge   = Number(row.account_age_days ?? 0);
    const nfcVerified  = Boolean(row.nfc_verified);
    const uniVerified  = Boolean(row.university_verified);

    // Score components (each normalized to 0-100)
    const balanceScore  = Math.min(balance / 500_000, 1.0) * 100;   // $5,000+ = full score
    const incomeScore   = Math.min(avgCredit / 200_000, 1.0) * 100; // $2,000/mo+ = full
    const ageScore      = Math.min(accountAge / 365, 1.0) * 100;    // 1 year+ = full
    const nfcScore      = nfcVerified ? 100 : 0;
    const uniScore      = uniVerified ? 100 : 0;

    // Weighted average
    const rawScore = (
      balanceScore  * 0.40 +
      incomeScore   * 0.20 +
      ageScore      * 0.20 +
      nfcScore      * 0.10 +
      uniScore      * 0.10
    );

    // Map 0-100 → 300-850
    const usScore = Math.round(300 + (rawScore / 100) * 550);

    logger.info({
      studentId,
      rawScore: Math.round(rawScore),
      usScore,
      components: { balanceScore: Math.round(balanceScore), incomeScore: Math.round(incomeScore), ageScore: Math.round(ageScore), nfcScore, uniScore },
    }, '[CreditBridge] Alternative score computed');

    return Math.min(Math.max(usScore, 300), 850);
  }

  // ---------------------------------------------------------------------------
  // Bureau dispatch
  // ---------------------------------------------------------------------------

  private async fetchFromBureau(bureauName: string, student: {
    name: string; dob: string; nationalIdEnc: string; country: string;
  }): Promise<BureauScore> {
    switch (bureauName) {
      case 'CIBIL': {
        const { CIBILAdapter } = await import('../../packages/providers/src/adapters/cibil.adapter');
        return new CIBILAdapter().fetchScore({
          name:       student.name,
          dob:        student.dob,
          nationalId: this.decryptField(student.nationalIdEnc),
        });
      }
      case 'BURO_DE_CREDITO': {
        const { BuroDeCreditoAdapter } = await import('../../packages/providers/src/adapters/buro-de-credito.adapter');
        return new BuroDeCreditoAdapter().fetchScore({
          name:       student.name,
          dob:        student.dob,
          nationalId: this.decryptField(student.nationalIdEnc),
        });
      }
      case 'EXPERIAN_UK': {
        const { ExperianUKAdapter } = await import('../../packages/providers/src/adapters/experian-uk.adapter');
        return new ExperianUKAdapter().fetchScore({
          name:       student.name,
          dob:        student.dob,
          nationalId: this.decryptField(student.nationalIdEnc),
        });
      }
      case 'EQUIFAX_CANADA': {
        const { EquifaxCanadaAdapter } = await import('../../packages/providers/src/adapters/equifax-canada.adapter');
        return new EquifaxCanadaAdapter().fetchScore({
          name:       student.name,
          dob:        student.dob,
          nationalId: this.decryptField(student.nationalIdEnc),
        });
      }
      default:
        throw new Error(`No adapter for bureau: ${bureauName}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Score translation
  // ---------------------------------------------------------------------------

  /**
   * Translate a foreign credit score to US 300-850 scale
   * using linear interpolation.
   *
   * Special cases:
   *   SCHUFA (Germany): higher score = BETTER (already 0-100)
   *   BKR (Netherlands): lower number = worse risk
   *   Banque de France: 3 = best, 9 = worst (inverted)
   */
  private translateToUSScale(foreignScore: number, bureau: string): number {
    const scale = SCORE_SCALES[bureau];
    if (!scale) return 550;  // unknown bureau — mid-range default

    let normalized: number;

    // Handle inverted scales
    if (bureau === 'BANQUE_DE_FRANCE') {
      // 3 = best → normalize to high; 9 = worst → normalize to low
      normalized = 1.0 - ((foreignScore - 3) / (9 - 3));
    } else if (bureau === 'BKR') {
      // Code 0 = no negative info = best; higher codes = worse
      normalized = Math.max(0, 1.0 - (foreignScore / scale.max));
    } else {
      // Standard: higher = better
      normalized = (foreignScore - scale.min) / (scale.max - scale.min);
    }

    normalized = Math.max(0, Math.min(1, normalized));
    return Math.round(300 + normalized * 550);
  }

  private scoreToTier(usScore: number): CreditBridgeResult['solvencyTier'] {
    if (usScore >= 740) return 'VERY_HIGH';
    if (usScore >= 670) return 'HIGH';
    if (usScore >= 580) return 'MEDIUM';
    return 'LOW';
  }

  private buildResult(
    studentId: string,
    score:     number,
    method:    'ALTERNATIVE' | 'COMPOSITE',
  ): CreditBridgeResult {
    return {
      studentId,
      usEquivalentScore: score,
      scoreMethod:       method,
      solvencyTier:      this.scoreToTier(score),
      factors: [
        'Vecta-verified bank balance',
        'NFC passport identity',
        'University enrollment verified',
        'Consistent account history',
      ],
      reportDate:    new Date(),
      f1SafeToShare: true,
    };
  }

  // ---------------------------------------------------------------------------
  // Data access
  // ---------------------------------------------------------------------------

  private async getStudentWithDecryptedCountry(studentId: string) {
    const row = await queryOne(
      `SELECT first_name, last_name, date_of_birth_enc, nationality_enc, issuing_country FROM students WHERE id = $1`,
      [studentId],
    );
    if (!row) throw new Error(`Student not found: ${studentId}`);

    let country = String(row.issuing_country ?? 'UNK');
    let dob     = '';

    try {
      // Decrypt country/DOB only for this call — never store decrypted values
      if (row.nationality_enc) country = this.decryptField(String(row.nationality_enc));
      if (row.date_of_birth_enc) dob   = this.decryptField(String(row.date_of_birth_enc));
    } catch {
      logger.warn({ studentId }, '[CreditBridge] Could not decrypt nationality/DOB');
    }

    return {
      name:          `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
      country:       country.slice(0, 3).toUpperCase(),
      dob,
      nationalIdEnc: String(row.date_of_birth_enc ?? ''),
    };
  }

  private decryptField(ciphertext: string): string {
    if (!ciphertext || !ciphertext.includes(':')) return ciphertext;
    const [ivHex, tagHex, encHex] = ciphertext.split(':');
    const key      = Buffer.from(process.env.KYC_ENCRYPTION_KEY ?? '', 'hex');
    if (key.length !== 32) throw new Error('KYC_ENCRYPTION_KEY not set');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(Buffer.from(encHex, 'hex')).toString('utf8') + decipher.final('utf8');
  }
}
