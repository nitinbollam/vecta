/**
 * apps/landlord-portal/src/app/landlord/background-check/page.tsx
 *
 * Background check flow — gets landlord to TRUSTED tier.
 *
 * States:
 *   NOT_STARTED → "Start background check" CTA
 *   PENDING     → "Check in progress" with estimated completion
 *   APPROVED    → "TRUSTED tier unlocked!" with portal link
 *   REJECTED    → "Check did not pass" with support contact
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

type CheckStatus = 'NOT_STARTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'loading';

export default function BackgroundCheckPage() {
  const [status, setStatus]       = useState<CheckStatus>('loading');
  const [consentUrl, setConsentUrl] = useState('');
  const [estimatedCompletion, setEstimatedCompletion] = useState('');
  const [email, setEmail]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  // Read email from session storage (set after email verification)
  useEffect(() => {
    const storedEmail = sessionStorage.getItem('landlord_email') ?? '';
    setEmail(storedEmail);

    if (!storedEmail) {
      setStatus('NOT_STARTED');
      return;
    }

    // Poll current status
    fetch(`/api/landlord/background-check/status?email=${encodeURIComponent(storedEmail)}`)
      .then((r) => r.json())
      .then((data: { status: CheckStatus; estimatedCompletion?: string }) => {
        setStatus(data.status);
        if (data.estimatedCompletion) setEstimatedCompletion(data.estimatedCompletion);
      })
      .catch(() => setStatus('NOT_STARTED'));
  }, []);

  const handleStart = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/landlord/background-check/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ landlordEmail: email }),
      });

      if (!res.ok) {
        const data = await res.json() as { message?: string };
        throw new Error(data.message ?? 'Failed to start check');
      }

      const data = await res.json() as { consentUrl: string };
      setConsentUrl(data.consentUrl);
      setStatus('PENDING');

      // Open Checkr consent flow in new tab
      window.open(data.consentUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [email]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-[#001F3F] py-4 px-6 shadow">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-white text-xl font-extrabold tracking-tight">VECTA</Link>
          <span className="text-[#00E6CC]">·</span>
          <span className="text-blue-300 text-xs uppercase tracking-widest font-medium">
            Background Check
          </span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">

          {status === 'loading' && (
            <div className="text-center text-gray-400 text-sm">Checking status…</div>
          )}

          {status === 'NOT_STARTED' && (
            <>
              <div className="text-center mb-8">
                <div className="text-5xl mb-4">🔍</div>
                <h1 className="text-2xl font-extrabold text-gray-900 mb-2">
                  Unlock TRUSTED Tier
                </h1>
                <p className="text-sm text-gray-500 leading-relaxed">
                  A quick background check via Checkr unlocks the ability to initiate leases
                  directly through Vecta. Takes 2–3 business days.
                </p>
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6 space-y-3">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                  What&apos;s checked
                </p>
                {['Identity verification', 'Criminal record (nationwide)', 'Sex offender registry'].map((item) => (
                  <div key={item} className="flex items-center gap-2 text-sm text-gray-600">
                    <svg className="w-4 h-4 text-[#001F3F]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    {item}
                  </div>
                ))}
                <p className="text-xs text-gray-400 pt-2 border-t border-gray-100">
                  Your SSN is collected by Checkr directly — Vecta never sees it.
                </p>
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3 mb-4">{error}</p>
              )}

              {!email ? (
                <div className="text-center text-sm text-amber-700 bg-amber-50 rounded-xl p-4">
                  Please{' '}
                  <Link href="/landlord/signup" className="underline font-semibold">
                    verify your email
                  </Link>{' '}
                  first.
                </div>
              ) : (
                <button
                  onClick={handleStart}
                  disabled={loading}
                  className="w-full bg-[#001F3F] hover:bg-[#003060] disabled:opacity-60 text-white font-bold py-4 rounded-full text-sm transition-colors"
                >
                  {loading ? 'Starting…' : 'Start Background Check →'}
                </button>
              )}
            </>
          )}

          {status === 'PENDING' && (
            <div className="text-center">
              <div className="text-5xl mb-6">⏳</div>
              <h2 className="text-2xl font-extrabold text-gray-900 mb-3">Check In Progress</h2>
              <p className="text-gray-500 text-sm mb-6 leading-relaxed">
                Checkr is processing your background check. This typically takes 2–3 business days.
                We&apos;ll email you when it&apos;s complete.
              </p>
              {estimatedCompletion && (
                <p className="text-xs text-gray-400 mb-6">
                  Estimated completion: {new Date(estimatedCompletion).toLocaleDateString()}
                </p>
              )}
              {consentUrl && (
                <a
                  href={consentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 rounded-full text-sm text-center transition-colors mb-4"
                >
                  Complete Consent (if not done)
                </a>
              )}
              <Link href="/verify" className="text-sm text-[#001F3F] hover:underline">
                Continue using VERIFIED tier →
              </Link>
            </div>
          )}

          {status === 'APPROVED' && (
            <div className="text-center">
              <div className="w-20 h-20 rounded-full bg-[#001F3F] flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
              <h2 className="text-2xl font-extrabold text-gray-900 mb-2">
                TRUSTED Tier Unlocked!
              </h2>
              <p className="text-gray-500 text-sm mb-8">
                You can now initiate leases directly through the Vecta verification portal.
              </p>
              <Link
                href="/verify"
                className="block w-full bg-[#001F3F] text-white font-bold py-4 rounded-full text-sm text-center"
              >
                Go to Verification Portal →
              </Link>
            </div>
          )}

          {status === 'REJECTED' && (
            <div className="text-center">
              <div className="text-5xl mb-6">⚠️</div>
              <h2 className="text-xl font-extrabold text-gray-900 mb-3">
                Background Check Not Approved
              </h2>
              <p className="text-gray-500 text-sm mb-6 leading-relaxed">
                Your background check did not pass Vecta&apos;s screening requirements.
                You can still use Vecta as a VERIFIED landlord to view student profiles
                and download Letters of Credit.
              </p>
              <a
                href="mailto:landlords@vecta.io"
                className="block w-full bg-gray-100 text-gray-700 font-semibold py-3 rounded-full text-sm text-center"
              >
                Contact Support
              </a>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
