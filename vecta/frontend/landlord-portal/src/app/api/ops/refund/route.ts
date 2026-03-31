import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const base = process.env.VECTA_INTERNAL_API_URL ?? 'http://localhost:4000';
  const token = process.env.VECTA_OPS_JWT;
  if (!token) {
    return NextResponse.json({ error: 'VECTA_OPS_JWT not configured' }, { status: 501 });
  }
  const body = (await req.json()) as { ticketId: string; amountCents: number; reason: string };
  const res = await fetch(
    `${base.replace(/\/$/, '')}/api/v1/admin/tickets/${encodeURIComponent(body.ticketId)}/refund`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amountCents: body.amountCents, reason: body.reason }),
    },
  );
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
