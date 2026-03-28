import { VectaNav } from '@/components/VectaNav';
/**
 * apps/landlord-portal/src/app/landlord/verify-email/page.tsx
 *
 * Handles: /landlord/verify-email?token=<magic-link-token>
 *
 * Flow:
 *   1. Token extracted from URL
 *   2. Server-side POST to API gateway to verify + stamp email_verified=true
 *   3. On success: show VERIFIED confirmation + redirect to verify portal
 *   4. On failure: show error with option to request a new link
 */

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Verify Email — Vecta Landlord Portal',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: { token?: string };
}

async function verifyMagicLink(
  token: string,
): Promise<{ ok: boolean; tier?: string; error?: string }> {
  try {
    const res = await fetch(
      `${process.env.VECTA_INTERNAL_API_URL}/api/v1/landlord/verify-email`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        cache: 'no-store',
      },
    );

    if (!res.ok) {
      const data = await res.json() as { error?: string };
      return { ok: false, error: data.error ?? 'VERIFICATION_FAILED' };
    }

    const data = await res.json() as { tier: string };
    return { ok: true, tier: data.tier };
  } catch {
    return { ok: false, error: 'NETWORK_ERROR' };
  }
}

export default async function VerifyEmailPage({ searchParams }: PageProps) {
  const token = searchParams.token;

  if (!token || token.length < 40) {
    return <ErrorView reason="invalid" />;
  }

  const result = await verifyMagicLink(token);

  if (!result.ok) {
    const reason =
      result.error === 'TOKEN_EXPIRED' ? 'expired' :
      result.error === 'TOKEN_USED'    ? 'already_used' :
      'invalid';
    return <ErrorView reason={reason} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-green-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        </div>

        <h1 className="text-2xl font-extrabold text-gray-900 mb-3">
          Email Verified!
        </h1>
        <p className="text-gray-500 text-sm mb-2">
          Your landlord account is now <strong className="text-green-700">VERIFIED</strong>.
        </p>
        <p className="text-gray-500 text-sm mb-8">
          You can now download Letters of Credit and view full trust score breakdowns.
        </p>

        <div className="bg-blue-50 rounded-2xl p-5 text-left mb-8">
          <p className="text-xs font-bold text-blue-700 uppercase mb-2">What&apos;s unlocked</p>
          {[
            'Download Letter of Credit PDF',
            'Full trust score breakdown (Nova Credit + Plaid)',
            'Maximum rent approval amount',
            'Deposit multiplier recommendation',
          ].map((item) => (
            <div key={item} className="flex items-center gap-2 py-1">
              <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              <span className="text-xs text-blue-700">{item}</span>
            </div>
          ))}
        </div>

        <Link
          href="/verify"
          className="block w-full text-center font-bold py-4 rounded-full text-sm transition-colors mb-4 text-[#001F3F]"
          style={{ background: '#00E6CC' }}
        >
          Go to Verification Portal →
        </Link>

        <Link
          href="/landlord/signup"
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Upgrade to TRUSTED (background check)
        </Link>
      </div>
    </div>
  );
}

function ErrorView({ reason }: { reason: 'expired' | 'already_used' | 'invalid' }) {
  const messages = {
    expired:      { title: 'Link Expired', body: 'This verification link has expired. Links are valid for 1 hour.' },
    already_used: { title: 'Link Already Used', body: 'This verification link has already been used. If you need a new one, sign up again.' },
    invalid:      { title: 'Invalid Link', body: 'This verification link is not valid. Please check the email and try again.' },
  };

  const { title, body } = messages[reason];

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-xl font-extrabold text-gray-900 mb-3">{title}</h1>
        <p className="text-gray-500 text-sm mb-8">{body}</p>
        <Link
          href="/landlord/signup"
          className="block w-full bg-[#001F3F] text-white font-bold py-4 rounded-full text-sm"
        >
          Request a New Link
        </Link>
      </div>
    </div>
  );
}
