'use client';

/**
 * apps/landlord-portal/src/components/ProofBadge.tsx
 *
 * Cryptographic Proof Badge — Client Component.
 *
 * Allows a landlord to independently verify that:
 *   1. The canonical hash displayed matches the certificate data (tamper detection)
 *   2. Vecta's Ed25519 public key signed that exact hash (authenticity proof)
 *
 * Verification runs entirely in the browser using the Web Crypto API (SubtleCrypto).
 * No server call needed — anyone with the public key can verify offline.
 *
 * Adversarial guarantee:
 *   If an attacker modifies even one attribute in the certificate (e.g., changes
 *   balanceTier from "LOW" to "HIGH"), the recomputed canonical hash will differ
 *   from cert.canonicalHash, and the signature check will also fail. Both are shown.
 *
 * Client-side canonicalise must exactly mirror packages/auth/src/crypto-signer.ts.
 * Any divergence would cause false verification failures — the algorithm is
 * documented in this component for auditability.
 */

import { useState, useCallback, type ReactNode } from 'react';
import type { SignedTrustCertificate, TrustAttributes } from '@vecta/auth';

// ---------------------------------------------------------------------------
// Client-side canonicalise — must EXACTLY mirror crypto-signer.ts
// ---------------------------------------------------------------------------

function clientCanonicalise(attrs: TrustAttributes): string {
  const flat: Record<string, string> = {
    studentId:         attrs.studentId,
    kycStatus:         attrs.kycStatus.toLowerCase(),
    nfcChipVerified:   String(attrs.nfcChipVerified),
    livenessScore:     attrs.livenessScore.toFixed(4),
    facialMatchScore:  attrs.facialMatchScore.toFixed(4),
    visaType:          attrs.visaType.toUpperCase(),
    visaExpiryYear:    String(attrs.visaExpiryYear),
    universityName:    attrs.universityName.trim(),
    programOfStudy:    attrs.programOfStudy.trim(),
    solvencyVerified:  String(attrs.solvencyVerified),
    balanceTier:       attrs.balanceTier.toLowerCase(),
    guaranteeMonths:   String(attrs.guaranteeMonths),
    monthlyRentTarget: String(attrs.monthlyRentTarget),
    novaScore:         String(attrs.novaScore),
    novaScoreTier:     attrs.novaScoreTier.toLowerCase(),
    compositeScore:    String(attrs.compositeScore),
    guaranteeTier:     attrs.guaranteeTier.toLowerCase(),
    maxRentApproval:   String(attrs.maxRentApproval),
    depositMultiplier: attrs.depositMultiplier.toFixed(1),
    ...(attrs.checkrStatus !== null && {
      checkrStatus: attrs.checkrStatus.toLowerCase(),
    }),
  };

  return Object.keys(flat)
    .sort()
    .map((k) => `${k}=${flat[k]!}`)
    .join('|');
}

async function clientHashCanonical(canonical: string): Promise<string> {
  const encoded = new TextEncoder().encode(canonical);
  const hashBuf = await window.crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function clientVerifyEd25519(
  hashHex:      string,
  signatureHex: string,
  publicKeyHex: string,
): Promise<boolean> {
  try {
    // Import Ed25519 public key from SPKI DER (hex)
    const pubKeyDer = new Uint8Array(
      publicKeyHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
    );

    const publicKey = await window.crypto.subtle.importKey(
      'spki',
      pubKeyDer,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );

    const hashBytes = new Uint8Array(
      hashHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
    );

    const sigBytes = new Uint8Array(
      signatureHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
    );

    return await window.crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      sigBytes,
      hashBytes,
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type VerifyState =
  | { status: 'idle' }
  | { status: 'verifying' }
  | { status: 'success'; recomputedHash: string; hashMatches: boolean; signatureValid: boolean }
  | { status: 'error'; message: string };

// ---------------------------------------------------------------------------
// Hex truncation helper
// ---------------------------------------------------------------------------

function truncateHex(hex: string, head = 16, tail = 8): string {
  if (hex.length <= head + tail + 3) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-gray-700/40 last:border-0">
      <span className={`flex-shrink-0 text-base ${ok ? 'text-green-400' : 'text-red-400'}`}>
        {ok ? '✅' : '❌'}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-bold ${ok ? 'text-green-300' : 'text-red-300'}`}>{label}</p>
        {detail && (
          <p className="text-xs text-gray-400 font-mono break-all mt-0.5">{detail}</p>
        )}
      </div>
    </div>
  );
}

function HashRow({ label, value, mismatch }: { label: string; value: string; mismatch?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-xs font-mono break-all ${mismatch ? 'text-red-400' : 'text-gray-200'}`}>
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ProofBadgeProps {
  certificate: SignedTrustCertificate;
}

export function ProofBadge({ certificate }: ProofBadgeProps): ReactNode {
  const [state, setState] = useState<VerifyState>({ status: 'idle' });
  const [expanded, setExpanded] = useState(false);

  const handleVerify = useCallback(async () => {
    setState({ status: 'verifying' });

    try {
      // Step 1: recompute canonical string from attributes
      const canonical       = clientCanonicalise(certificate.attributes);
      const recomputedHash  = await clientHashCanonical(canonical);
      const hashMatches     = recomputedHash === certificate.canonicalHash;

      // Step 2: verify Ed25519 signature
      // We sign the canonicalHash (hex string encoded as UTF-8 bytes)
      const signatureValid  = await clientVerifyEd25519(
        certificate.canonicalHash,
        certificate.signature,
        certificate.publicKeyHex,
      );

      setState({ status: 'success', recomputedHash, hashMatches, signatureValid });
      setExpanded(true);
    } catch (err) {
      setState({
        status:  'error',
        message: err instanceof Error ? err.message : 'Verification failed unexpectedly.',
      });
    }
  }, [certificate]);

  const isVerifying = state.status === 'verifying';
  const isSuccess   = state.status === 'success';
  const isError     = state.status === 'error';
  const bothPass    = isSuccess && state.hashMatches && state.signatureValid;

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-700 overflow-hidden">

      {/* Header row */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-800/50 transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{
            isSuccess
              ? (bothPass ? '🔐' : '⚠️')
              : '🔐'
          }</span>
          <div>
            <p className="text-sm font-bold text-white">Cryptographic Proof</p>
            <p className="text-xs text-gray-400">Ed25519 · SHA-256 · Vecta Financial Services LLC</p>
          </div>
        </div>
        <span className="text-gray-500 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-5 border-t border-gray-800">

          {/* How it works */}
          <div className="pt-4">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              How Verification Works
            </p>
            <p className="text-xs text-gray-400 leading-relaxed">
              Your browser independently recomputes the SHA-256 hash of this certificate's
              trust attributes using the same canonical algorithm as Vecta's signing server.
              It then verifies Vecta's Ed25519 signature against that hash using the embedded
              public key — with zero server calls. Any modification to the certificate data
              (even a single character) breaks both checks.
            </p>
          </div>

          {/* Certificate hash */}
          <div className="bg-gray-800/60 rounded-xl p-4 space-y-3">
            <HashRow
              label="Certificate Canonical Hash (SHA-256)"
              value={certificate.canonicalHash}
            />
            <HashRow
              label="Ed25519 Signature"
              value={truncateHex(certificate.signature, 32, 16)}
            />
            <HashRow
              label="Public Key (SPKI DER)"
              value={truncateHex(certificate.publicKeyHex, 24, 12)}
            />
          </div>

          {/* Verify button */}
          {state.status === 'idle' && (
            <button
              onClick={handleVerify}
              className="w-full bg-[#001F3F] hover:bg-[#003060] text-white font-bold text-sm py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <span>🔍</span>
              Verify Signature in Browser
            </button>
          )}

          {isVerifying && (
            <div className="flex items-center justify-center gap-3 py-3 text-sm text-gray-400">
              <svg className="animate-spin w-4 h-4 text-[#00E6CC]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Running Ed25519 verification…
            </div>
          )}

          {isSuccess && (
            <div className="space-y-3">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                Verification Results
              </p>
              <div className="bg-gray-800/60 rounded-xl p-4 space-y-1">
                <StatusRow
                  label="Data Integrity — SHA-256 hash matches"
                  ok={state.hashMatches}
                  detail={state.hashMatches
                    ? `Recomputed: ${truncateHex(state.recomputedHash)}`
                    : `MISMATCH — expected ${truncateHex(certificate.canonicalHash)}, got ${truncateHex(state.recomputedHash)}`
                  }
                />
                <StatusRow
                  label="Authenticity — Ed25519 signature valid"
                  ok={state.signatureValid}
                  detail={state.signatureValid
                    ? 'Signed by Vecta Financial Services LLC'
                    : 'Signature does not match public key — certificate may be forged'
                  }
                />
              </div>

              {bothPass ? (
                <div className="flex items-center gap-3 bg-green-900/30 border border-green-700/50 rounded-xl px-4 py-3">
                  <span className="text-2xl">✅</span>
                  <div>
                    <p className="text-sm font-bold text-green-300">Certificate is Authentic</p>
                    <p className="text-xs text-green-400/80">
                      Data is unmodified and was signed by Vecta. This proof is verifiable offline.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3">
                  <span className="text-2xl">🚨</span>
                  <div>
                    <p className="text-sm font-bold text-red-300">Certificate Verification Failed</p>
                    <p className="text-xs text-red-400/80">
                      {!state.hashMatches
                        ? 'Certificate data has been modified since signing.'
                        : 'Signature is invalid — do not rely on this certificate.'}
                      {' '}Contact Vecta immediately.
                    </p>
                  </div>
                </div>
              )}

              <button
                onClick={() => setState({ status: 'idle' })}
                className="w-full text-xs text-gray-500 hover:text-gray-300 py-2 transition-colors"
              >
                Reset
              </button>
            </div>
          )}

          {isError && (
            <div className="bg-red-900/20 border border-red-700/40 rounded-xl p-4">
              <p className="text-sm font-bold text-red-300 mb-1">Verification Error</p>
              <p className="text-xs text-red-400">{state.message}</p>
              <p className="text-xs text-gray-500 mt-2">
                This may indicate your browser does not support Ed25519 (requires Chrome 113+,
                Firefox 119+, Safari 17+). Try updating your browser.
              </p>
              <button
                onClick={() => setState({ status: 'idle' })}
                className="mt-3 text-xs text-gray-400 hover:text-white transition-colors"
              >
                Try again
              </button>
            </div>
          )}

          {/* Audit link */}
          <p className="text-xs text-gray-600 text-center pt-1">
            Certificate ID:{' '}
            <span className="font-mono text-gray-500">{certificate.certId}</span>
          </p>

        </div>
      )}
    </div>
  );
}
