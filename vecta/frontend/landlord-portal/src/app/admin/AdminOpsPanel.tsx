'use client';

import React, { useCallback, useEffect, useState } from 'react';

type RevenuePayload = {
  events?: Array<{ event_type: string; count: number; total_cents: number; day: string }>;
  platformBalance?: string;
  error?: string;
};

type TicketRow = {
  id: string;
  ticket_number: string;
  category: string;
  priority: string;
  student_name?: string | null;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  description: string;
  created_at: string;
};

export function AdminOpsPanel() {
  const [revenue, setRevenue] = useState<RevenuePayload | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [applications, setApplications] = useState<Record<string, unknown>[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [r, t, a] = await Promise.all([
        fetch('/api/ops/revenue', { cache: 'no-store' }),
        fetch('/api/ops/tickets', { cache: 'no-store' }),
        fetch('/api/ops/driver-applications', { cache: 'no-store' }),
      ]);
      const rj = (await r.json()) as RevenuePayload;
      const tj = (await t.json()) as { tickets?: TicketRow[]; error?: string };
      const aj = (await a.json()) as { applications?: Record<string, unknown>[]; error?: string };
      if (rj.error && r.status === 501) setErr('Set VECTA_OPS_JWT on the server to load ops data.');
      setRevenue(rj);
      setTickets(tj.tickets ?? []);
      setApplications(aj.applications ?? []);
    } catch {
      setErr('Failed to load admin data');
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30000);
    return () => clearInterval(id);
  }, [load]);

  const priorityClass = (p: string) => {
    if (p === 'URGENT') return 'text-red-400';
    if (p === 'HIGH') return 'text-orange-300';
    return 'text-gray-400';
  };

  const todayRevenue =
    revenue?.events?.filter((e) => {
      const d = new Date(e.day).toDateString();
      return d === new Date().toDateString();
    }).reduce((s, e) => s + (e.total_cents ?? 0), 0) ?? 0;

  return (
    <div className="space-y-8">
      {err ? (
        <div className="rounded-xl border border-amber-800 bg-amber-950/40 p-4 text-amber-200 text-sm">{err}</div>
      ) : null}

      <section>
        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Revenue overview</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-gray-500 text-xs uppercase">Platform ledger balance (cents)</p>
            <p className="text-2xl font-extrabold text-[#00E6CC] mt-1">{revenue?.platformBalance ?? '—'}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-gray-500 text-xs uppercase">Revenue today (cents, from events)</p>
            <p className="text-2xl font-extrabold text-white mt-1">{todayRevenue}</p>
          </div>
        </div>
        <div className="mt-4 bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500">
                <th className="p-3">Day</th>
                <th className="p-3">Type</th>
                <th className="p-3">Count</th>
                <th className="p-3">Total ¢</th>
              </tr>
            </thead>
            <tbody>
              {(revenue?.events ?? []).slice(0, 40).map((e, i) => (
                <tr key={`${e.day}-${e.event_type}-${i}`} className="border-b border-gray-800/50">
                  <td className="p-3 text-gray-400 font-mono">{String(e.day).slice(0, 10)}</td>
                  <td className="p-3 text-gray-200">{e.event_type}</td>
                  <td className="p-3">{e.count}</td>
                  <td className="p-3 text-[#00E6CC]">{e.total_cents}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Open tickets</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500 text-left">
                <th className="p-3">#</th>
                <th className="p-3">Category</th>
                <th className="p-3">Priority</th>
                <th className="p-3">Student</th>
                <th className="p-3">Ride</th>
                <th className="p-3">Filed</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((tk) => (
                <React.Fragment key={tk.id}>
                  <tr
                    className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer"
                    onClick={() => setExpanded((x) => (x === tk.id ? null : tk.id))}
                  >
                    <td className="p-3 font-mono text-gray-300">{tk.ticket_number}</td>
                    <td className="p-3 text-gray-200">{tk.category}</td>
                    <td className={`p-3 font-bold ${priorityClass(tk.priority)}`}>{tk.priority}</td>
                    <td className="p-3 text-gray-400">{tk.student_name ?? '—'}</td>
                    <td className="p-3 text-gray-500 max-w-[140px] truncate">
                      {tk.pickup_address ? `${tk.pickup_address} → ${tk.dropoff_address ?? ''}` : '—'}
                    </td>
                    <td className="p-3 text-gray-500">{new Date(tk.created_at).toLocaleString()}</td>
                    <td className="p-3">
                      {tk.category === 'RIDE_DISPUTE' ? (
                        <button
                          type="button"
                          className="text-[#00E6CC] font-semibold"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            const amt = window.prompt('Refund amount (cents)', '500');
                            const reason = window.prompt('Reason', 'Ride dispute refund');
                            if (amt && reason) {
                              void fetch('/api/ops/refund', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  ticketId: tk.id,
                                  amountCents: Number.parseInt(amt, 10),
                                  reason,
                                }),
                              }).then(() => void load());
                            }
                          }}
                        >
                          Refund
                        </button>
                      ) : null}{' '}
                      <button
                        type="button"
                        className="text-gray-400 ml-2"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          const flagType = window.prompt('Flag type (WARNING|SUSPENDED|BANNED|...)', 'WARNING');
                          const reason = window.prompt('Reason', 'Ops review');
                          if (flagType && reason) {
                            void fetch('/api/ops/flag', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ flagType, reason }),
                            }).then(() => void load());
                          }
                        }}
                      >
                        Flag
                      </button>
                    </td>
                  </tr>
                  {expanded === tk.id ? (
                    <tr className="bg-gray-950/80">
                      <td colSpan={7} className="p-4 text-gray-300 text-sm whitespace-pre-wrap">
                        {tk.description}
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Driver applications (pending)</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500">
                <th className="p-3">Name</th>
                <th className="p-3">Email</th>
                <th className="p-3">University</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((row) => (
                <tr key={String(row.id)} className="border-b border-gray-800/50">
                  <td className="p-3 text-gray-200">{String(row.full_name ?? '—')}</td>
                  <td className="p-3 text-gray-400">{String(row.email ?? '—')}</td>
                  <td className="p-3 text-gray-500 max-w-[160px] truncate">{String(row.university_name ?? '—')}</td>
                  <td className="p-3 space-x-2">
                    <button
                      type="button"
                      className="text-green-400 font-semibold"
                      onClick={() =>
                        void fetch('/api/ops/approve-driver', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ driverId: row.id }),
                        }).then(() => void load())
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="text-red-400 font-semibold"
                      onClick={() =>
                        void fetch('/api/ops/reject-driver', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ driverId: row.id }),
                        }).then(() => void load())
                      }
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Quick stats</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <p className="text-gray-500 text-[10px] uppercase">Open tickets</p>
            <p className="text-xl font-bold text-white">{tickets.length}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <p className="text-gray-500 text-[10px] uppercase">Pending drivers</p>
            <p className="text-xl font-bold text-white">{applications.length}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <p className="text-gray-500 text-[10px] uppercase">Rev rows (30d)</p>
            <p className="text-xl font-bold text-[#00E6CC]">{revenue?.events?.length ?? 0}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <p className="text-gray-500 text-[10px] uppercase">Platform ¢</p>
            <p className="text-xl font-bold text-white font-mono text-sm">{revenue?.platformBalance ?? '—'}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
