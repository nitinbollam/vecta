import { VectaNav } from './VectaNav';
/**
 * VerificationLayout.tsx — Landlord portal page chrome.
 *
 * Wraps all verify/[token] content with:
 *   - Vecta branded header (never shows student PII in the header)
 *   - Privacy vault notice banner
 *   - Trust indicator footer with cryptographic provenance
 *   - Responsive sidebar layout on desktop
 */

import React from 'react';

// ---------------------------------------------------------------------------
// Layout root
// ---------------------------------------------------------------------------

interface VerificationLayoutProps {
  children: React.ReactNode;
  tokenId?: string;
  issuedAt?: string;
  expiresAt?: string;
}

export function VerificationLayout({
  children,
  tokenId,
  issuedAt,
  expiresAt,
}: VerificationLayoutProps) {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* ----------------------------------------------------------------- */}
      {/* Header                                                             */}
      {/* ----------------------------------------------------------------- */}
      <header className="bg-[#001F3F] text-white shadow-lg">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Vecta wordmark */}
              <div className="flex items-center gap-1">
                <span className="text-2xl font-extrabold tracking-tight">VECTA</span>
                <span className="text-[#00E6CC] text-2xl font-light">·</span>
                <span className="text-sm font-medium text-blue-200 uppercase tracking-widest mt-1">
                  Identity Verification
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-blue-200">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
              <span>Secure · Encrypted · Fair Housing Compliant</span>
            </div>
          </div>
        </div>
      </header>

      {/* ----------------------------------------------------------------- */}
      {/* Fair Housing Act banner                                            */}
      {/* ----------------------------------------------------------------- */}
      <div className="bg-amber-50 border-b border-amber-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
          <div className="flex items-start gap-2 text-xs text-amber-800">
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <p>
              <strong>Fair Housing Act Notice:</strong> This verification portal complies with 42 U.S.C. § 3604.
              Country of origin, passport details, and national identification numbers are strictly vaulted.
              Rental decisions must not be based on national origin or immigration status beyond lawful work authorization.
            </p>
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Main content                                                       */}
      {/* ----------------------------------------------------------------- */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>

      {/* ----------------------------------------------------------------- */}
      {/* Footer                                                             */}
      {/* ----------------------------------------------------------------- */}
      <footer className="bg-white border-t border-gray-100 mt-12">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            {/* Cryptographic provenance */}
            <div className="text-xs text-gray-400 space-y-1">
              {tokenId && (
                <p className="font-mono">Token ID: {tokenId.slice(0, 16)}…</p>
              )}
              {issuedAt && <p>Issued: {new Date(issuedAt).toLocaleString()}</p>}
              {expiresAt && (
                <p className={new Date(expiresAt) < new Date() ? 'text-red-500 font-semibold' : ''}>
                  Expires: {new Date(expiresAt).toLocaleString()}
                </p>
              )}
            </div>

            {/* Security badges */}
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'RS256 JWT', icon: '🔐' },
                { label: 'AES-256-GCM', icon: '🛡️' },
                { label: 'NFC Verified', icon: '📡' },
                { label: 'pgvector AI', icon: '🤖' },
              ].map(({ label, icon }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1 text-xs bg-gray-50 text-gray-600 border border-gray-200 rounded-full px-3 py-1"
                >
                  <span>{icon}</span>
                  <span>{label}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-50 text-xs text-gray-400 text-center">
            © {new Date().getFullYear()} Vecta Financial Services LLC · Privacy Policy ·
            For verification support:{' '}
            <a href="mailto:verify@vecta.io" className="hover:underline" style={{ color: '#001F3F' }}>
              verify@vecta.io
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TokenErrorPage — shown for invalid/expired/not-found tokens
// ---------------------------------------------------------------------------

export type TokenErrorReason = 'expired' | 'invalid' | 'revoked' | 'not_found';

const ERROR_CONFIG: Record<TokenErrorReason, { title: string; description: string; action: string }> = {
  expired: {
    title: 'Verification Link Expired',
    description: 'This verification link has expired. Vecta ID tokens are valid for 30 days for security reasons.',
    action: 'Ask the student to generate a new verification link from their Vecta app.',
  },
  invalid: {
    title: 'Invalid Verification Link',
    description: 'This link does not correspond to a valid Vecta verification token.',
    action: 'Ensure you copied the complete link from the student\'s app. Contact verify@vecta.io if the issue persists.',
  },
  revoked: {
    title: 'Token Revoked',
    description: 'This verification token has been revoked by the student or Vecta\'s compliance system.',
    action: 'Please request a new verification link from the student.',
  },
  not_found: {
    title: 'Student Not Found',
    description: 'No verified student profile exists for this token.',
    action: 'The student may need to complete their identity verification in the Vecta app first.',
  },
};

interface TokenErrorPageProps {
  reason: TokenErrorReason;
}

export function TokenErrorPage({ reason }: TokenErrorPageProps) {
  const config = ERROR_CONFIG[reason];

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center mb-6">
        <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-3">{config.title}</h1>
      <p className="text-gray-500 max-w-sm mb-6 text-sm leading-relaxed">{config.description}</p>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 max-w-sm text-left">
        <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">
          Next Step
        </p>
        <p className="text-sm text-blue-600">{config.action}</p>
      </div>

      <p className="mt-8 text-xs text-gray-400">
        Questions? Contact{' '}
        <a href="mailto:verify@vecta.io" className="hover:underline" style={{ color: '#001F3F' }}>
          verify@vecta.io
        </a>
      </p>
    </div>
  );
}
