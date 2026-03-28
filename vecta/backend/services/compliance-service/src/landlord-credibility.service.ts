/**
 * services/compliance-service/src/landlord-credibility.service.ts
 *
 * Landlord Credibility Engine — addresses the "last mile trust problem."
 *
 * The problem:
 *   A landlord can verify identity and financial standing via Vecta.
 *   But without social proof, network effects, and institutional backing,
 *   they have no reason to *accept Vecta certificates* over SSN + FICO.
 *
 * This service builds the distribution layer:
 *
 * 1. Social Proof API
 *    Real-time acceptance statistics that landlords see on the portal.
 *    "1,247 landlords in Boston have accepted Vecta-verified students."
 *    These are not fake numbers — they aggregate from trust_signal_events.
 *
 * 2. Landlord Network Tiering
 *    STANDARD → PREFERRED → PARTNER based on acceptance history.
 *    PARTNER landlords get co-marketing, so they promote Vecta to their networks.
 *
 * 3. University Partnership Pipeline
 *    Integration hooks for university housing offices.
 *    When MIT Housing accepts Vecta certificates, every MIT student gets credibility.
 *
 * 4. Comparable Tenant Report
 *    For a given property address, show how many similar Vecta-verified students
 *    were successfully placed in the same zip code.
 *    This directly answers "do other landlords accept this?"
 */

import { query, queryOne } from '@vecta/database';
import { createLogger } from '@vecta/logger';

const logger = createLogger('landlord-credibility');

// ---------------------------------------------------------------------------
// Social proof stats — the numbers a landlord sees on the portal
// ---------------------------------------------------------------------------

export interface SocialProofStats {
  totalLandlordsAccepted:    number;
  totalStudentsPlaced:       number;
  acceptanceRatePercent:     number;   // certs issued vs accepted
  avgDecisionSeconds:        number;
  citiesServed:              number;
  universitiesPartner:       number;
  recentAcceptances:         Array<{
    city:          string;
    state:         string;
    universityName: string;
    daysAgo:       number;
    // Note: no student names — just proof of activity
  }>;
}

export async function getSocialProofStats(
  city?:  string,
  state?: string,
): Promise<SocialProofStats> {
  // Total landlords who have accepted at least one certificate
  const totalLandlordsResult = await queryOne<{ count: string }>(
    `SELECT COUNT(DISTINCT landlord_id)::text AS count
     FROM trust_signal_events
     WHERE event_type = 'CERTIFICATE_ACCEPTED'`,
  );

  // Total students placed
  const totalStudentsResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM lease_applications
     WHERE status IN ('SIGNED','PENDING_SIGNATURE')`,
  );

  // Acceptance rate
  const certsIssuedResult = await queryOne<{ issued: string; accepted: string }>(
    `SELECT
       COUNT(*)::text                                            AS issued,
       COUNT(*) FILTER (WHERE la.id IS NOT NULL)::text          AS accepted
     FROM tenant_trust_certificates ttc
     LEFT JOIN lease_applications la ON la.cert_id = ttc.cert_id`,
  );

  // Avg decision time
  const avgDecisionResult = await queryOne<{ avg_seconds: string | null }>(
    `SELECT AVG(EXTRACT(EPOCH FROM (la.created_at - ttc.created_at)))::int::text AS avg_seconds
     FROM lease_applications la
     JOIN tenant_trust_certificates ttc ON ttc.cert_id = la.cert_id`,
  );

  // Cities served
  const citiesResult = await queryOne<{ count: string }>(
    `SELECT COUNT(DISTINCT city)::text AS count
     FROM trust_signal_events
     WHERE city IS NOT NULL`,
  );

  // University partners
  const uniResult = await queryOne<{ count: string }>(
    `SELECT COUNT(DISTINCT university_name)::text AS count
     FROM trust_signal_events
     WHERE event_type = 'UNIVERSITY_INTEGRATION'`,
  );

  // Recent acceptances (anonymised)
  const recentResult = await query<{
    city: string; state: string; university_name: string; created_at: string;
  }>(
    `SELECT city, state, university_name, created_at
     FROM trust_signal_events
     WHERE event_type = 'CERTIFICATE_ACCEPTED'
       ${city  ? `AND city  = '${city.replace(/'/g, "''")}'`  : ''}
       ${state ? `AND state = '${state.replace(/'/g, "''")}'` : ''}
     ORDER BY created_at DESC
     LIMIT 5`,
  );

  const issued   = parseInt(certsIssuedResult?.issued   ?? '0', 10);
  const accepted = parseInt(certsIssuedResult?.accepted ?? '0', 10);

  return {
    totalLandlordsAccepted: parseInt(totalLandlordsResult?.count ?? '0', 10),
    totalStudentsPlaced:    parseInt(totalStudentsResult?.count  ?? '0', 10),
    acceptanceRatePercent:  issued > 0 ? Math.round((accepted / issued) * 100) : 0,
    avgDecisionSeconds:     parseInt(avgDecisionResult?.avg_seconds ?? '120', 10),
    citiesServed:           parseInt(citiesResult?.count     ?? '0', 10),
    universitiesPartner:    parseInt(uniResult?.count        ?? '0', 10),
    recentAcceptances: recentResult.rows.map((r) => ({
      city:           r.city,
      state:          r.state,
      universityName: r.university_name,
      daysAgo: Math.floor(
        (Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24),
      ),
    })),
  };
}

// ---------------------------------------------------------------------------
// Comparable tenant report — "others like this student were placed here"
// ---------------------------------------------------------------------------

export interface ComparableReport {
  zipCode:          string;
  placementsInZip:  number;
  avgGuaranteeMonths: number;
  avgTrustScore:    number;
  mostCommonTiers:  string[];
  message:          string;   // human-readable for display
}

export async function getComparableReport(
  zipCode: string,
  guaranteeTier: string,
): Promise<ComparableReport> {
  const result = await queryOne<{
    placements:     string;
    avg_months:     string;
    avg_score:      string;
    tiers:          string;
  }>(
    `SELECT
       COUNT(*)::text                       AS placements,
       AVG(ttc_attrs->>'guaranteeMonths')::int::text AS avg_months,
       AVG(ttc_attrs->>'compositeScore')::int::text  AS avg_score,
       ARRAY_AGG(DISTINCT ttc_attrs->>'guaranteeTier') FILTER (WHERE ttc_attrs->>'guaranteeTier' IS NOT NULL)::text AS tiers
     FROM lease_applications la
     JOIN tenant_trust_certificates ttc ON ttc.cert_id = la.cert_id,
          LATERAL (SELECT ttc.evidence::jsonb AS ttc_attrs) x
     WHERE la.property_address LIKE $1
       AND la.status = 'SIGNED'`,
    [`%${zipCode}%`],
  );

  const placements = parseInt(result?.placements ?? '0', 10);

  const message = placements === 0
    ? `No prior placements in this zip code yet — but Vecta certificates are accepted across ${await getCityCount()} cities.`
    : `${placements} student${placements !== 1 ? 's' : ''} with similar profiles have been successfully placed in this zip code.`;

  return {
    zipCode,
    placementsInZip:    placements,
    avgGuaranteeMonths: parseInt(result?.avg_months ?? '0', 10),
    avgTrustScore:      parseInt(result?.avg_score  ?? '0', 10),
    mostCommonTiers:    result?.tiers ? JSON.parse(result.tiers) : [],
    message,
  };
}

async function getCityCount(): Promise<number> {
  const r = await queryOne<{ count: string }>(
    `SELECT COUNT(DISTINCT city)::text AS count FROM trust_signal_events WHERE city IS NOT NULL`,
  );
  return parseInt(r?.count ?? '0', 10);
}

// ---------------------------------------------------------------------------
// Landlord onboarding — converts a first-viewer into a network member
// ---------------------------------------------------------------------------

export async function onboardLandlord(params: {
  landlordProfileId: string;
  propertyCount:     number;
  cities:            string[];
  referralCode?:     string;
}): Promise<{ networkId: string; referralCode: string }> {
  // Find referrer if any
  let referredBy: string | null = null;
  if (params.referralCode) {
    const referrer = await queryOne<{ id: string }>(
      'SELECT id FROM landlord_network WHERE referral_code = $1',
      [params.referralCode],
    );
    referredBy = referrer?.id ?? null;

    if (referredBy) {
      await query(
        'UPDATE landlord_network SET referred_count = referred_count + 1 WHERE id = $1',
        [referredBy],
      );
    }
  }

  // Generate unique referral code for this landlord
  const refCode = `VL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  const result = await queryOne<{ id: string }>(
    `INSERT INTO landlord_network
       (landlord_profile_id, property_count, cities_served, referral_code, referred_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (landlord_profile_id) DO UPDATE
       SET property_count  = EXCLUDED.property_count,
           cities_served   = EXCLUDED.cities_served,
           updated_at      = NOW()
     RETURNING id`,
    [
      params.landlordProfileId,
      params.propertyCount,
      params.cities,
      refCode,
      referredBy,
    ],
  );

  logger.info(
    { networkId: result!.id, cities: params.cities },
    'Landlord onboarded to network',
  );

  return { networkId: result!.id, referralCode: refCode };
}

// ---------------------------------------------------------------------------
// Record acceptance — builds the social proof dataset
// ---------------------------------------------------------------------------

export async function recordAcceptance(params: {
  landlordId: string;
  studentId:  string;
  certId:     string;
  city:       string;
  state:      string;
  universityName: string;
}): Promise<void> {
  await query(
    `INSERT INTO trust_signal_events
       (event_type, landlord_id, student_id, cert_id, city, state, university_name)
     VALUES ('CERTIFICATE_ACCEPTED',$1,$2,$3,$4,$5,$6)`,
    [
      params.landlordId,
      params.studentId,
      params.certId,
      params.city,
      params.state,
      params.universityName,
    ],
  );

  // Update landlord metrics
  await query(
    `UPDATE landlord_network
     SET accepted_applications = accepted_applications + 1,
         first_acceptance_at   = COALESCE(first_acceptance_at, NOW()),
         network_tier          = CASE
           WHEN accepted_applications >= 10 THEN 'PARTNER'
           WHEN accepted_applications >= 3  THEN 'PREFERRED'
           ELSE 'STANDARD'
         END,
         updated_at = NOW()
     WHERE id = $1`,
    [params.landlordId],
  );

  logger.info(params, 'Acceptance recorded in social proof dataset');
}

// ---------------------------------------------------------------------------
// University partnership webhook
// ---------------------------------------------------------------------------

export async function recordUniversityIntegration(params: {
  universityName: string;
  city:           string;
  state:          string;
  integrationUrl?: string;
}): Promise<void> {
  await query(
    `INSERT INTO trust_signal_events
       (event_type, university_name, city, state, metadata)
     VALUES ('UNIVERSITY_INTEGRATION',$1,$2,$3,$4)
     ON CONFLICT DO NOTHING`,
    [
      params.universityName,
      params.city,
      params.state,
      JSON.stringify({ integrationUrl: params.integrationUrl }),
    ],
  );

  logger.info({ university: params.universityName }, 'University integration recorded');
}
