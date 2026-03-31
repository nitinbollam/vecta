import { NextResponse } from 'next/server';

export async function GET() {
  const base = process.env.VECTA_INTERNAL_API_URL ?? 'http://localhost:4000';
  const token = process.env.VECTA_OPS_JWT;
  if (!token) {
    return NextResponse.json({ error: 'VECTA_OPS_JWT not configured' }, { status: 501 });
  }
  const res = await fetch(`${base.replace(/\/$/, '')}/api/v1/admin/revenue`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
