/**
 * apps/landlord-portal/src/app/id/[vectaIdNumber]/page.tsx
 *
 * PUBLIC — no authentication required.
 * Anyone with a Vecta ID number (VID-XXXX-XXXX-XXXX) can verify the card.
 * URL: https://verify.vecta.io/id/VID-X4K2-9M7P-3QR1
 *
 * Zero-knowledge: shows verifiable facts only — no passport number, DOB,
 * nationality, or bank balance (Fair Housing Act compliance).
 */

import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';

export const dynamic    = 'force-dynamic';
export const revalidate = 0;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VectaIDVerifyResult {
  valid:           boolean;
  name:            string;
  university:      string;
  visaStatus:      string;
  visaExpiryYear:  number;
  nfcVerified:     boolean;
  issuedAt:        string;
  expiresAt:       string;
  frontImageUrl:   string;
  error?:          string;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({ params }: { params: { vectaIdNumber: string } }): Promise<Metadata> {
  const id = params.vectaIdNumber;
  return {
    title:   `Vecta ID Verification — ${id}`,
    description: 'Verify this Vecta digital identity card',
    robots:  { index: false, follow: false },
  };
}

// ---------------------------------------------------------------------------
// Server-side API fetch
// ---------------------------------------------------------------------------

async function fetchVectaID(vectaIdNumber: string): Promise<VectaIDVerifyResult | null> {
  const base = process.env.VECTA_INTERNAL_API_URL ?? 'https://vecta-elaf.onrender.com';
  const url  = `${base}/api/v1/identity/verify/${encodeURIComponent(vectaIdNumber)}`;

  try {
    const res = await fetch(url, {
      cache:   'no-store',
      signal:  AbortSignal.timeout(8_000),
      headers: { 'Cache-Control': 'no-store' },
    });
    return await res.json() as VectaIDVerifyResult;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fact row component
// ---------------------------------------------------------------------------

type FactStatus = 'verified' | 'locked' | 'warning' | 'invalid';

function FactRow({ icon, label, value, status }: {
  icon: string; label: string; value: string; status: FactStatus;
}) {
  const styles: Record<FactStatus, { bg: string; border: string; lc: string; vc: string }> = {
    verified: { bg: 'bg-green-50',  border: 'border-green-100', lc: 'text-green-700',  vc: 'text-green-900'  },
    locked:   { bg: 'bg-slate-50',  border: 'border-slate-100', lc: 'text-slate-500',  vc: 'text-slate-600'  },
    warning:  { bg: 'bg-amber-50',  border: 'border-amber-100', lc: 'text-amber-700',  vc: 'text-amber-900'  },
    invalid:  { bg: 'bg-red-50',    border: 'border-red-100',   lc: 'text-red-600',    vc: 'text-red-700'    },
  };
  const s = styles[status];

  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl ${s.bg} border ${s.border}`}>
      <span className="text-lg flex-shrink-0 mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-bold uppercase tracking-wide ${s.lc} mb-0.5`}>{label}</p>
        <p className={`text-sm font-semibold ${s.vc}`}>{value}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function VectaIDVerifyPage({ params }: { params: { vectaIdNumber: string } }) {
  const { vectaIdNumber } = params;

  // Strict format guard — VID-XXXX-XXXX-XXXX
  if (!/^VID-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(vectaIdNumber)) {
    notFound();
  }

  const result = await fetchVectaID(vectaIdNumber);
  const isNetworkError = result === null;

  // All fields valid
  const isValid = result?.valid === true;
  const isExpired = result?.valid === false && !result?.error?.includes('NOT_FOUND');

  return (
    <main className="min-h-screen bg-slate-50">

      {/* Header */}
      <header className="bg-[#001F3F] text-white shadow">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-extrabold text-xl tracking-tight">VECTA</span>
            <span className="text-[#00E6CC]">·</span>
            <span className="text-blue-300 text-xs uppercase tracking-widest font-medium">ID Verification</span>
          </div>
          <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${
            isValid        ? 'bg-green-500 text-white' :
            isNetworkError ? 'bg-slate-400 text-white' :
                             'bg-red-500 text-white'
          }`}>
            {isValid ? '✓ VALID' : isNetworkError ? '? OFFLINE' : '✗ INVALID'}
          </span>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Network error */}
        {isNetworkError && (
          <div className="bg-slate-100 border border-slate-200 rounded-3xl p-8 text-center">
            <div className="text-4xl mb-4">📡</div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Could not reach Vecta servers</h2>
            <p className="text-sm text-slate-600">Please refresh the page or try again in a moment.</p>
          </div>
        )}

        {/* Invalid / Not found */}
        {!isNetworkError && !result?.valid && result?.error === 'NOT_FOUND' && (
          <div className="bg-red-50 border border-red-200 rounded-3xl p-8 text-center">
            <div className="text-4xl mb-4">🔍</div>
            <h2 className="text-lg font-bold text-red-900 mb-2">ID Not Found</h2>
            <p className="text-sm text-red-700">
              The Vecta ID <span className="font-mono font-bold">{vectaIdNumber}</span> does not exist.
              Please check the ID number is correct.
            </p>
          </div>
        )}

        {/* Expired */}
        {!isNetworkError && !result?.valid && isExpired && (
          <div className="bg-amber-50 border border-amber-200 rounded-3xl p-8 text-center">
            <div className="text-4xl mb-4">⏱️</div>
            <h2 className="text-lg font-bold text-amber-900 mb-2">ID Card Expired</h2>
            <p className="text-sm text-amber-700">
              This Vecta ID card expired on{' '}
              {result?.expiresAt ? new Date(result.expiresAt).toLocaleDateString('en-US', { dateStyle: 'long' }) : 'an unknown date'}.
              Ask the holder to generate a new card in their Vecta app.
            </p>
          </div>
        )}

        {/* Valid card */}
        {result && result.valid && (
          <>
            {/* Big verification badge */}
            <div className="bg-green-50 border border-green-200 rounded-3xl p-6 text-center">
              <div className="text-5xl mb-3">✅</div>
              <h2 className="text-2xl font-extrabold text-green-900">VECTA ID VERIFIED</h2>
              <p className="text-sm text-green-700 mt-2">
                This digital identity card is authentic and has not been tampered with.
              </p>
              <p className="font-mono text-xs text-green-600 mt-3 bg-green-100 inline-block px-3 py-1 rounded-full">
                {vectaIdNumber}
              </p>
            </div>

            {/* Card image */}
            {result.frontImageUrl && (
              <div className="flex justify-center">
                <div className="relative shadow-[0_8px_32px_rgba(0,230,204,0.3)] rounded-2xl overflow-hidden"
                     style={{ maxWidth: '420px', width: '100%', aspectRatio: '1.586' }}>
                  <Image
                    src={result.frontImageUrl}
                    alt="Vecta ID Card"
                    fill
                    style={{ objectFit: 'cover' }}
                    unoptimized
                  />
                </div>
              </div>
            )}

            {/* Zero-knowledge facts */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Verified Facts</h3>

              <FactRow icon="✅" label="Legal Name"    value={result.name}       status="verified" />
              <FactRow icon="✅" label="University"    value={result.university}  status="verified" />
              <FactRow icon="✅" label="Visa Status"   value={result.visaStatus}  status="verified" />
              <FactRow
                icon="✅"
                label="Visa Valid Until"
                value={`${result.visaExpiryYear}`}
                status={result.visaExpiryYear >= new Date().getFullYear() ? 'verified' : 'warning'}
              />
              <FactRow
                icon="✅"
                label="NFC Chip Verified"
                value={result.nfcVerified ? 'Yes — ICAO 9303 passport chip authenticated' : 'Pending'}
                status={result.nfcVerified ? 'verified' : 'warning'}
              />
              <FactRow
                icon="✅"
                label="Identity Confirmed"
                value={new Date(result.issuedAt).toLocaleDateString('en-US', { dateStyle: 'long' })}
                status="verified"
              />
              <FactRow
                icon="✅"
                label="Card Expires"
                value={new Date(result.expiresAt).toLocaleDateString('en-US', { dateStyle: 'long' })}
                status="verified"
              />

              {/* Locked fields */}
              <FactRow icon="🔒" label="Passport Number"  value="Encrypted vault"  status="locked" />
              <FactRow icon="🔒" label="Date of Birth"    value="Encrypted vault"  status="locked" />
              <FactRow icon="🔒" label="Nationality"      value="Encrypted vault (Fair Housing Act §3604)" status="locked" />
            </div>

            {/* Cryptographic signature notice */}
            <div className="bg-[#001F3F] rounded-2xl p-5">
              <div className="flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">🔐</span>
                <div>
                  <p className="text-sm font-bold text-white mb-1">
                    Cryptographic signature verified
                  </p>
                  <p className="text-xs text-blue-200 leading-relaxed">
                    This card has not been tampered with. The identity data was cryptographically
                    signed by Vecta Financial Services LLC using Ed25519 at issuance time.
                    Verification performed at verify.vecta.io.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Fair Housing notice */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4 text-xs text-gray-500 leading-relaxed shadow-sm">
          <span className="font-bold text-gray-700">Fair Housing Act (42 U.S.C. § 3604): </span>
          National origin, passport number, and home-country information are cryptographically vaulted
          and intentionally excluded from this verification. Rental decisions must be based solely
          on the verifiable facts shown above.
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-gray-400 pb-8 space-y-1">
          <p>Vecta Financial Services LLC</p>
          <p>
            <a href="https://vecta.io" className="hover:underline">vecta.io</a>
            {' · '}
            <a href="mailto:support@vecta.io" className="hover:underline">support@vecta.io</a>
          </p>
        </div>

      </div>
    </main>
  );
}
