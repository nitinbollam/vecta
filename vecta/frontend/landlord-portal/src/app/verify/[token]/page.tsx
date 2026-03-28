/**
 * apps/landlord-portal/src/app/verify/[token]/page.tsx
 *
 * The 30-Second Landlord Decision UI — Next.js Server Component.
 *
 * Zero-knowledge: renders ✅/❌ facts only — no raw passport, balance, or nationality.
 * Single-use: token consumed atomically server-side before any data is rendered.
 * Adversarial: expired / consumed / invalid tokens immediately render TokenExpiredError.
 */

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
interface TrustAttributes {
  studentId: string;
  kycStatus: 'APPROVED' | 'PENDING' | 'REJECTED' | 'NEEDS_REVIEW';
  nfcChipVerified: boolean;
  livenessScore: number;
  facialMatchScore: number;
  visaType: string;
  visaExpiryYear: number;
  universityName: string;
  programOfStudy: string;
  solvencyVerified: boolean;
  balanceTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  guaranteeMonths: number;
  monthlyRentTarget: number;
  novaScore: number;
  novaScoreTier: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'BUILDING';
  checkrStatus: 'APPROVED' | 'PENDING' | 'REJECTED' | 'SKIPPED' | null;
  compositeScore: number;
  guaranteeTier: 'PLATINUM' | 'GOLD' | 'SILVER' | 'STANDARD' | 'INSUFFICIENT';
  maxRentApproval: number;
  depositMultiplier: number;
  reputationScore?: number;
  reputationTier?: 'BUILDING' | 'FAIR' | 'GOOD' | 'EXCELLENT';
  onTimePayments?: number;
  monthsOfHistory?: number;
}

interface SignedTrustCertificate {
  certId: string;
  version: '1';
  issuedAt: string;
  expiresAt: string;
  issuer: 'Vecta Financial Services LLC';
  attributes: TrustAttributes;
  canonicalHash: string;
  signature: string;
  publicKeyHex: string;
  keyId: string;
  certStatus: 'FULL' | 'CONTINGENT' | 'PARTIAL' | 'INVALID';
}
import { AcceptTenantButton } from '@/components/AcceptTenantButton';
import { ProofBadge } from '@/components/ProofBadge';

export const metadata: Metadata = {
  title: 'Vecta | Verify Tenant',
  robots: { index: false, follow: false },
};

export const dynamic    = 'force-dynamic';
export const revalidate = 0;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ErrorCode =
  | 'TOKEN_EXPIRED' | 'TOKEN_ALREADY_USED' | 'TOKEN_INVALID' | 'TOKEN_NOT_FOUND'
  | 'KYC_NOT_APPROVED' | 'INCOMPLETE_PROFILE' | 'NETWORK_ERROR';

type CertOutcome =
  | { ok: true;  certificate: SignedTrustCertificate }
  | { ok: false; code: ErrorCode; message: string; usedAt?: string };

// ---------------------------------------------------------------------------
// Server-side fetch (runs in Node, never in browser)
// ---------------------------------------------------------------------------

async function fetchCertificate(
  token:         string,
  landlordIp:    string,
  landlordEmail: string | undefined,
): Promise<CertOutcome> {
  const base = process.env.VECTA_INTERNAL_API_URL ?? 'http://api-gateway:4000';
  const url  = `${base}/api/v1/certificate/${encodeURIComponent(token)}`;

  try {
    const reqHeaders: Record<string, string> = {
      'X-Forwarded-For': landlordIp,
      'Cache-Control':   'no-store, no-cache',
    };
    if (landlordEmail) reqHeaders['X-Landlord-Email'] = landlordEmail;

    const res = await fetch(url, {
      method:  'GET',
      headers: reqHeaders,
      cache:   'no-store',
      signal:  AbortSignal.timeout(8_000),
    });

    if (res.ok) {
      const { certificate } = await res.json() as { certificate: SignedTrustCertificate };
      return { ok: true, certificate };
    }

    const body = await res.json().catch(() => ({} as Record<string, unknown>)) as {
      error?: string; message?: string; usedAt?: string;
    };

    const code = ((): ErrorCode => {
      if (res.status === 401) return body.error === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
      if (res.status === 404) return 'TOKEN_NOT_FOUND';
      if (res.status === 409) return 'TOKEN_ALREADY_USED';
      if (res.status === 422) return body.error === 'KYC_NOT_APPROVED' ? 'KYC_NOT_APPROVED' : 'INCOMPLETE_PROFILE';
      return 'TOKEN_INVALID';
    })();

    const err: { ok: false; code: ErrorCode; message: string; usedAt?: string } = {
      ok: false,
      code,
      message: body.message ?? 'Verification failed.',
    };
    if (body.usedAt !== undefined) err.usedAt = body.usedAt;
    return err;
  } catch {
    return { ok: false, code: 'NETWORK_ERROR', message: 'Could not connect to Vecta. Please refresh.' };
  }
}

// ---------------------------------------------------------------------------
// Error UI — renders immediately, no data leaked to browser
// ---------------------------------------------------------------------------

const ERROR_CONFIG: Record<ErrorCode, {
  icon: string; title: string; body: string; action: string;
  bg: string; border: string; titleClass: string;
}> = {
  TOKEN_EXPIRED: {
    icon: '⏱️', title: 'Verification Link Expired',
    body: 'Vecta ID links expire after 30 days for security reasons.',
    action: 'Ask the applicant to share a new Vecta ID link from their app.',
    bg: 'bg-amber-50', border: 'border-amber-200', titleClass: 'text-amber-900',
  },
  TOKEN_ALREADY_USED: {
    icon: '🔒', title: 'Link Already Opened',
    body: 'This link has already been used. Each link can only be viewed once.',
    action: 'Request a fresh link from the applicant.',
    bg: 'bg-blue-50', border: 'border-blue-200', titleClass: 'text-blue-900',
  },
  TOKEN_INVALID: {
    icon: '⚠️', title: 'Invalid Link',
    body: 'This verification link is not valid.',
    action: 'Ask the applicant to generate a fresh Vecta ID link.',
    bg: 'bg-red-50', border: 'border-red-200', titleClass: 'text-red-900',
  },
  TOKEN_NOT_FOUND: {
    icon: '🔍', title: 'Link Not Found',
    body: 'This verification link does not exist in Vecta.',
    action: 'Check the URL is complete and try again.',
    bg: 'bg-red-50', border: 'border-red-200', titleClass: 'text-red-900',
  },
  KYC_NOT_APPROVED: {
    icon: '⏳', title: 'Identity Verification Pending',
    body: 'This applicant has not yet completed passport verification.',
    action: 'Ask the applicant to complete NFC passport verification in their Vecta app.',
    bg: 'bg-yellow-50', border: 'border-yellow-200', titleClass: 'text-yellow-900',
  },
  INCOMPLETE_PROFILE: {
    icon: '📋', title: 'Profile Incomplete',
    body: 'Financial verification is not yet complete.',
    action: 'Ask the applicant to link their bank account in the Vecta app.',
    bg: 'bg-orange-50', border: 'border-orange-200', titleClass: 'text-orange-900',
  },
  NETWORK_ERROR: {
    icon: '📡', title: 'Connection Error',
    body: 'Could not reach Vecta servers.',
    action: 'Refresh the page. If the issue persists, contact landlords@vecta.io.',
    bg: 'bg-slate-50', border: 'border-slate-200', titleClass: 'text-slate-900',
  },
};

function TokenExpiredError({ code, usedAt }: { code: ErrorCode; usedAt?: string }) {
  const c = ERROR_CONFIG[code];
  const body = code === 'TOKEN_ALREADY_USED' && usedAt
    ? `This link was opened on ${new Date(usedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`
    : c.body;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className={`max-w-md w-full ${c.bg} border ${c.border} rounded-3xl p-8 text-center shadow-sm`}>
        <div className="text-5xl mb-5">{c.icon}</div>
        <h1 className={`text-xl font-extrabold ${c.titleClass} mb-3`}>{c.title}</h1>
        <p className="text-sm text-gray-600 leading-relaxed mb-6">{body}</p>
        <div className="bg-white rounded-xl p-4 border border-gray-100 text-left">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">What to do</p>
          <p className="text-sm text-gray-700">{c.action}</p>
        </div>
        <p className="text-xs text-gray-400 mt-6">
          Questions?{' '}
          <a href="mailto:landlords@vecta.io" className="text-[#001F3F] hover:underline">
            landlords@vecta.io
          </a>
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zero-knowledge fact row
// ---------------------------------------------------------------------------

type FactStatus = 'verified' | 'contingent' | 'pending' | 'failed';

function TrustFact({ label, value, status, subtext }: {
  label: string; value: string; status: FactStatus; subtext?: string;
}) {
  const s = {
    verified:   { icon: '✅', bg: 'bg-green-50',  border: 'border-green-100', lc: 'text-green-700', vc: 'text-green-900' },
    contingent: { icon: '⚠️', bg: 'bg-amber-50',  border: 'border-amber-100', lc: 'text-amber-700', vc: 'text-amber-900' },
    pending:    { icon: '⏳', bg: 'bg-blue-50',   border: 'border-blue-100',  lc: 'text-blue-600',  vc: 'text-blue-900'  },
    failed:     { icon: '❌', bg: 'bg-red-50',    border: 'border-red-100',   lc: 'text-red-600',   vc: 'text-red-900'   },
  }[status];

  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl ${s.bg} border ${s.border}`}>
      <span className="text-lg flex-shrink-0 mt-0.5">{s.icon}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-bold uppercase tracking-wide ${s.lc} mb-0.5`}>{label}</p>
        <p className={`text-sm font-bold ${s.vc}`}>{value}</p>
        {subtext && <p className="text-xs text-gray-500 mt-0.5">{subtext}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function TrustCertificatePage({ params }: { params: { token: string } }) {
  const { token } = params;

  // Guard: strict format check before any I/O
  if (!token || token.length < 80 || !token.startsWith('ey')) notFound();

  const headersList  = await headers();
  const landlordIp   = (
    headersList.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? headersList.get('x-real-ip')
    ?? 'unknown'
  );
  const landlordEmail = headersList.get('x-landlord-email')?.toLowerCase() ?? undefined;

  // Fetch and atomically consume token
  const outcome = await fetchCertificate(token, landlordIp, landlordEmail);

  // Any error → render error UI immediately, zero data leaked
  if (!outcome.ok) {
    return outcome.usedAt !== undefined
      ? <TokenExpiredError code={outcome.code} usedAt={outcome.usedAt} />
      : <TokenExpiredError code={outcome.code} />;
  }

  const { certificate } = outcome;
  const { attributes: a, certStatus } = certificate;

  // Derived display values — no PII
  const tierColor: Record<string, string> = {
    PLATINUM: 'text-violet-700', GOLD: 'text-yellow-700',
    SILVER:   'text-slate-600',  STANDARD: 'text-blue-700',
    INSUFFICIENT: 'text-red-600',
  };

  const balanceLabel = {
    VERY_HIGH: 'Excellent liquidity (≥ $100,000 verified)',
    HIGH:      'Strong liquidity ($50,000 – $100,000 verified)',
    MEDIUM:    'Adequate liquidity ($10,000 – $50,000 verified)',
    LOW:       'Entry liquidity (< $10,000 verified)',
  }[a.balanceTier];

  const checkrFact: FactStatus =
    a.checkrStatus === 'APPROVED'  ? 'verified' :
    a.checkrStatus === 'PENDING'   ? 'contingent' :
    a.checkrStatus === 'REJECTED'  ? 'failed' : 'pending';

  return (
    <main className="min-h-screen bg-slate-50">

      {/* Header */}
      <header className="bg-[#001F3F] text-white shadow">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-extrabold text-xl tracking-tight">VECTA</span>
            <span className="text-[#00E6CC]">·</span>
            <span className="text-blue-300 text-xs uppercase tracking-widest font-medium">Tenant Certificate</span>
          </div>
          <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${
            certStatus === 'FULL'       ? 'bg-green-500 text-white' :
            certStatus === 'CONTINGENT' ? 'bg-amber-400 text-amber-900' :
            'bg-blue-400 text-white'
          }`}>
            {certStatus === 'FULL' ? '✓ VERIFIED' : certStatus}
          </span>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Identity strip */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#001F3F] to-[#00B8A4] flex items-center justify-center text-white font-extrabold text-xl flex-shrink-0">
              {a.universityName.slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-0.5">F-1 Student Applicant</p>
              <p className="font-extrabold text-gray-900 text-base truncate">{a.universityName}</p>
              <p className="text-sm text-gray-500 truncate">{a.programOfStudy}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className={`text-2xl font-extrabold ${tierColor[a.guaranteeTier] ?? 'text-gray-700'}`}>
                {a.compositeScore}
              </p>
              <p className="text-xs text-gray-400">/ 1000</p>
              <p className={`text-xs font-bold ${tierColor[a.guaranteeTier] ?? ''}`}>{a.guaranteeTier}</p>
            </div>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-3 pt-4 border-t border-gray-50 text-center">
            <div>
              <p className="text-xl font-extrabold text-[#001F3F]">{a.guaranteeMonths}</p>
              <p className="text-xs text-gray-500">Months Guaranteed</p>
            </div>
            <div className="border-x border-gray-100">
              <p className="text-xl font-extrabold text-[#001F3F]">{a.depositMultiplier}×</p>
              <p className="text-xs text-gray-500">Deposit Multiplier</p>
            </div>
            <div>
              <p className="text-xl font-extrabold text-[#001F3F]">
                ${(a.maxRentApproval / 1000).toFixed(0)}K
              </p>
              <p className="text-xs text-gray-500">Max Rent/Mo</p>
            </div>
          </div>
        </div>

        {typeof a.reputationScore === 'number' ? (
          <div className="bg-white rounded-3xl border border-teal-100 shadow-sm p-6">
            <h2 className="text-xs font-bold text-teal-700 uppercase tracking-wider mb-3">
              Vecta Reputation Score
            </h2>
            <div className="flex flex-wrap items-end gap-4">
              <p className="text-4xl font-extrabold text-[#00B8A4]">{a.reputationScore}</p>
              <span className="text-xs font-bold px-3 py-1 rounded-full bg-teal-50 text-teal-800 border border-teal-100">
                {a.reputationTier ?? 'BUILDING'}
              </span>
            </div>
            <p className="text-sm text-slate-600 mt-3">
              {(a.onTimePayments ?? 0).toLocaleString()} on-time payments ·{' '}
              {(a.monthsOfHistory ?? 0).toLocaleString()} months history
            </p>
            <p className="text-xs text-teal-800 font-semibold mt-2">
              Anchored to public record · Verified by Vecta
            </p>
            <p className="text-xs text-slate-500 mt-3 leading-relaxed">
              This score is built from verified rent payment history, not self-reported data.
            </p>
          </div>
        ) : (
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 text-sm text-slate-600">
            New to Vecta — reputation building in progress
          </div>
        )}

        {/* Contingent warning */}
        {certStatus === 'CONTINGENT' && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
            <span className="text-lg flex-shrink-0">⚠️</span>
            <div>
              <p className="text-sm font-bold text-amber-900 mb-1">Contingent Certificate</p>
              <p className="text-xs text-amber-800 leading-relaxed">
                Background check is still in progress. Identity and financial verifications are confirmed.
                You may conditionally accept, subject to background check completion.
              </p>
            </div>
          </div>
        )}

        {/* Zero-knowledge trust facts */}
        <div className="space-y-3">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Verified Trust Signals</h2>

          <TrustFact
            label="Identity Verification"
            value={a.kycStatus === 'APPROVED' ? 'KYC: Identity Confirmed' : `KYC: ${a.kycStatus}`}
            status={a.kycStatus === 'APPROVED' ? 'verified' : 'failed'}
            subtext={`NFC chip ${a.nfcChipVerified ? '✓ authenticated' : '✗ not read'} · Liveness ${(a.livenessScore * 100).toFixed(0)}% · Biometric match ${(a.facialMatchScore * 100).toFixed(0)}%`}
          />

          <TrustFact
            label="Visa Status"
            value={a.visaExpiryYear >= new Date().getFullYear() ? `F-1 Valid — Expires ${a.visaExpiryYear}` : 'F-1 — Please verify current I-20'}
            status={a.visaExpiryYear >= new Date().getFullYear() + 1 ? 'verified' : 'contingent'}
            subtext="Verified via NFC passport chip — not self-reported"
          />

          <TrustFact
            label="Financial Liquidity"
            value={balanceLabel ?? 'Verified'}
            status={a.solvencyVerified ? 'verified' : 'pending'}
            subtext="Plaid multi-institution asset report. Exact balance withheld per Fair Housing Act §3604."
          />

          <TrustFact
            label="Rent Guarantee"
            value={`${a.guaranteeMonths} months confirmed${a.monthlyRentTarget > 0 ? ` · $${a.monthlyRentTarget.toLocaleString()}/mo` : ''}`}
            status={a.guaranteeMonths >= 12 ? 'verified' : a.guaranteeMonths > 0 ? 'contingent' : 'pending'}
            subtext="Vecta Letter of Credit — cryptographically signed and HMAC-stamped"
          />

          <TrustFact
            label="International Credit"
            value={`Nova Credit Score: ${a.novaScore}/850 — ${a.novaScoreTier}`}
            status={a.novaScore >= 670 ? 'verified' : a.novaScore >= 580 ? 'contingent' : 'pending'}
            subtext="Home-country credit history translated to US 300–850 scale via Nova Credit"
          />

          {a.checkrStatus !== null && (
            <TrustFact
              label="Background Screening"
              value={
                a.checkrStatus === 'APPROVED' ? 'Checkr: Identity + Criminal — Cleared' :
                a.checkrStatus === 'PENDING'  ? 'Checkr: In Progress (2–3 business days)' :
                a.checkrStatus === 'REJECTED' ? 'Checkr: Did not pass screening' :
                'Checkr: Waived for this application'
              }
              status={checkrFact}
              subtext={a.checkrStatus === 'APPROVED' ? 'Identity verification + nationwide criminal search' : undefined}
            />
          )}
        </div>

        {/* Fair Housing notice */}
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 text-xs text-gray-500 leading-relaxed">
          <span className="font-bold text-gray-700">Fair Housing Act (42 U.S.C. § 3604): </span>
          National origin, passport number, and home-country information are cryptographically vaulted
          and excluded from this certificate. Rental decisions must be based solely on the verifiable
          facts shown above.
        </div>

        {/* Accept tenant button — Client Component */}
        <AcceptTenantButton
          certId={certificate.certId}
          certStatus={certStatus}
          maxRentApproval={a.maxRentApproval}
          guaranteeMonths={a.guaranteeMonths}
        />

        {/* Cryptographic proof badge */}
        <ProofBadge certificate={certificate} />

        {/* Certificate metadata */}
        <div className="text-center text-xs text-gray-400 space-y-1 pb-8">
          <p>Certificate: <span className="font-mono">{certificate.certId.slice(0, 18)}…</span></p>
          <p>Issued: {new Date(certificate.issuedAt).toLocaleString()}</p>
          <p className={new Date(certificate.expiresAt) < new Date() ? 'text-red-500 font-bold' : ''}>
            Expires: {new Date(certificate.expiresAt).toLocaleString()}
          </p>
          <p>Algorithm: Ed25519 · Issuer: Vecta Financial Services LLC</p>
        </div>

      </div>
    </main>
  );
}
