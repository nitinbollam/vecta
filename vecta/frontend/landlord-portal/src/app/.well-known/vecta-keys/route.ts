/**
 * apps/landlord-portal/src/app/.well-known/vecta-keys/route.ts
 *
 * Public JWKS endpoint — Gap 1 fix (publicly verifiable key registry).
 *
 * Accessible at: https://verify.vecta.io/.well-known/vecta-keys.json
 *
 * This makes the Trust Certificate protocol genuinely portable:
 *   - A bank, employer, or insurance company can download this JWKS
 *   - Cache it (24h TTL)
 *   - Verify any Vecta certificate offline without contacting Vecta's API
 *
 * Format mirrors OIDC JWKS (RFC 7517) — familiar to security engineers.
 * The `_metadata.active_kid` tells verifiers which key is currently in use.
 *
 * Rotation:
 *   When a key is retired, it stays in this endpoint until all certificates
 *   signed with it have expired (30 days max). Then it is removed.
 *   The `notAfter` field signals retirement date to automated verifiers.
 *
 * Cache-Control: 24h max-age, 1h stale-while-revalidate.
 * Third parties SHOULD cache — Vecta rate-limits this endpoint.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const dynamic    = 'force-dynamic';
export const revalidate = 86400; // 24h

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    // Fetch from API gateway (which has access to the key registry)
    const base = process.env.VECTA_INTERNAL_API_URL ?? 'https://vecta-elaf.onrender.com';
    const res  = await fetch(`${base}/api/v1/keys/jwks`, {
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Keys unavailable' }, { status: 503 });
    }

    const jwks = await res.json();

    return NextResponse.json(jwks, {
      headers: {
        'Cache-Control':               'public, max-age=86400, stale-while-revalidate=3600',
        'Access-Control-Allow-Origin': '*',        // public endpoint — CORS open
        'Content-Type':                'application/json',
        'X-Vecta-Protocol-Version':    '1.0',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Key registry unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
