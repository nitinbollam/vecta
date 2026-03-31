import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const base = process.env.VECTA_INTERNAL_API_URL ?? 'http://localhost:4000';
  const token = process.env.VECTA_OPS_JWT;
  if (!token) {
    return NextResponse.json({ error: 'VECTA_OPS_JWT not configured' }, { status: 501 });
  }
  const { driverId, reason } = (await req.json()) as { driverId: string; reason?: string };
  const res = await fetch(
    `${base.replace(/\/$/, '')}/api/v1/mobility/driver/${encodeURIComponent(driverId)}/reject`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: reason ?? 'Rejected by ops' }),
    },
  );
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
