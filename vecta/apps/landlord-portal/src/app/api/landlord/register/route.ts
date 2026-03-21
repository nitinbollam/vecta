/**
 * apps/landlord-portal/src/app/api/landlord/register/route.ts
 *
 * POST /api/landlord/register
 * Body: { email, fullName, companyName? }
 *
 * → Creates (or fetches) landlord_profiles row
 * → Generates a magic-link token (32-byte random, hashed in DB)
 * → Sends verification email via API gateway
 * → Returns 201 (never reveals whether email already exists — prevents enumeration)
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const API_BASE = process.env.VECTA_INTERNAL_API_URL ?? 'http://api-gateway:4000';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { email?: string; fullName?: string; companyName?: string };

    const email = (body.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return NextResponse.json({ message: 'Valid email required' }, { status: 400 });
    }

    const fullName    = (body.fullName    ?? '').trim().slice(0, 200);
    const companyName = (body.companyName ?? '').trim().slice(0, 200);

    // Forward to API gateway — which handles DB write + email send
    const res = await fetch(`${API_BASE}/api/v1/landlord/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, fullName, companyName }),
    });

    // Always return 201 to prevent email enumeration
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch {
    return NextResponse.json({ ok: true }, { status: 201 }); // Mask errors too
  }
}
