import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const base = process.env.VECTA_INTERNAL_API_URL ?? 'http://localhost:4000';
  const token = process.env.VECTA_OPS_JWT;
  if (!token) {
    return NextResponse.json({ error: 'VECTA_OPS_JWT not configured' }, { status: 501 });
  }
  const { driverId } = (await req.json()) as { driverId: string };
  const res = await fetch(
    `${base.replace(/\/$/, '')}/api/v1/mobility/driver/${encodeURIComponent(driverId)}/approve`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
