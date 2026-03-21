/**
 * app/insurance/page.tsx — Insurance Marketplace
 *
 * Landlords can initiate a Lemonade insurance quote on behalf of
 * their prospective tenant, or view existing policy status.
 *
 * Students reach this page from: Dashboard → Housing → "Get Insurance"
 * Landlords can share the quote link with their tenant applicant.
 *
 * Products shown:
 *   1. Renter's Insurance  — required by most landlords
 *   2. Auto Insurance      — for LESSOR students (fleet vehicle)
 */

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Student Insurance — Vecta',
  description: 'Renters and auto insurance for F-1 international students. No US history required.',
  robots: { index: false, follow: false },
};

// ---------------------------------------------------------------------------
// Coverage card
// ---------------------------------------------------------------------------

interface CoverageItem {
  label: string;
  value: string;
  ok: boolean;
}

function CoverageCard({
  title, icon, price, description, items, ctaLabel, ctaHref, badge,
}: {
  title: string;
  icon: string;
  price: string;
  description: string;
  items: CoverageItem[];
  ctaLabel: string;
  ctaHref: string;
  badge?: string;
}) {
  return (
    <div className="vecta-card p-6 relative">
      {badge && (
        <div className="absolute top-4 right-4 bg-[#001F3F] text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
          {badge}
        </div>
      )}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-2xl">
          {icon}
        </div>
        <div>
          <h3 className="font-bold text-gray-900 text-lg">{title}</h3>
          <p className="text-[#001F3F] font-extrabold text-xl">{price}</p>
        </div>
      </div>

      <p className="text-sm text-gray-500 mb-5 leading-relaxed">{description}</p>

      <ul className="space-y-2 mb-6">
        {items.map(({ label, value, ok }) => (
          <li key={label} className="flex items-start justify-between gap-3 text-sm">
            <div className="flex items-center gap-2">
              <span className={ok ? 'text-green-500' : 'text-gray-300'}>
                {ok ? '✓' : '—'}
              </span>
              <span className="text-gray-600">{label}</span>
            </div>
            <span className="font-semibold text-gray-800 text-right">{value}</span>
          </li>
        ))}
      </ul>

      <a
        href={ctaHref}
        className="block w-full bg-[#001F3F] hover:bg-[#003060] text-white font-bold text-sm text-center py-3 px-6 rounded-full transition-colors"
      >
        {ctaLabel}
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// F-1 coverage notice
// ---------------------------------------------------------------------------

function F1CoverageNotice() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-8">
      <div className="flex items-start gap-3">
        <span className="text-2xl">⚖️</span>
        <div>
          <h4 className="font-bold text-amber-900 mb-1">F-1 Insurance Notes</h4>
          <ul className="text-sm text-amber-800 space-y-1 leading-relaxed">
            <li>• <strong>No US driving history required</strong> — foreign experience accepted with disclosure</li>
            <li>• <strong>No SSN required</strong> — passport + student visa accepted</li>
            <li>• <strong>Nova Credit score</strong> used in place of US credit score</li>
            <li>• For LESSOR vehicles: auto policy covers <em>personal/storage use only</em>, not active ride assignments (Vecta holds the commercial fleet policy)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const RENTERS_ITEMS: CoverageItem[] = [
  { label: 'Personal Property',  value: 'Up to $15,000',  ok: true  },
  { label: 'Liability',          value: 'Up to $100,000', ok: true  },
  { label: 'Loss of Use',        value: 'Up to $3,000',   ok: true  },
  { label: 'Medical Payments',   value: '$1,000',          ok: true  },
  { label: 'US Credit Required', value: 'Not required',   ok: true  },
  { label: 'Co-signer Required', value: 'Not required',   ok: true  },
];

const AUTO_ITEMS: CoverageItem[] = [
  { label: 'Liability',          value: '100/300/100',    ok: true  },
  { label: 'Collision',          value: 'Optional',       ok: true  },
  { label: 'Comprehensive',      value: 'Optional',       ok: true  },
  { label: 'US Driving History', value: 'Not required',   ok: true  },
  { label: 'Rideshare Coverage', value: 'Not included',   ok: false },
  { label: 'SSN Required',       value: 'Not required',   ok: true  },
];

export default function InsurancePage() {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-[#001F3F] text-white py-4 px-6 shadow">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-xl font-extrabold tracking-tight hover:opacity-80">VECTA</Link>
            <span className="text-[#00E6CC]">·</span>
            <span className="text-blue-300 text-xs uppercase tracking-widest font-medium">Insurance</span>
          </div>
          <span className="text-xs text-blue-200">Powered by Lemonade</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4 text-balance">
            Insurance for International Students
          </h1>
          <p className="text-gray-500 text-sm max-w-xl mx-auto leading-relaxed">
            No US history required. No SSN. No co-signer. Powered by Lemonade with
            Vecta's F-1 international student translation layer.
          </p>
        </div>

        {/* F-1 notice */}
        <F1CoverageNotice />

        {/* Product cards */}
        <div className="grid md:grid-cols-2 gap-6 mb-12">
          <CoverageCard
            title="Renter's Insurance"
            icon="🏠"
            price="from $15/mo"
            description="Most landlords require renters insurance. Get covered instantly — no US credit history or SSN needed."
            items={RENTERS_ITEMS}
            ctaLabel="Get Renters Quote"
            ctaHref="https://lemonade.com"
            badge="Most Popular"
          />
          <CoverageCard
            title="Auto Insurance"
            icon="🚗"
            price="from $45/mo"
            description="For LESSOR students enrolling their vehicle in the Vecta fleet. Covers personal and storage use."
            items={AUTO_ITEMS}
            ctaLabel="Get Auto Quote"
            ctaHref="https://lemonade.com"
          />
        </div>

        {/* University health plan checker */}
        <div className="vecta-card p-6 mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-[#F4F4F4] flex items-center justify-center text-2xl">
              🏥
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-lg">University Health Plan Check</h3>
              <p className="text-sm text-gray-500">F-1 compliance analysis via Claude Vision</p>
            </div>
          </div>
          <p className="text-sm text-gray-500 mb-4 leading-relaxed">
            Upload your university's health plan PDF. Our AI will check if it meets F-1 visa requirements
            (deductible ≤ $500, emergency coverage ≥ $100K, pre-existing conditions covered) and recommend
            a supplement if needed.
          </p>

          <div className="bg-blue-50 rounded-xl p-4 mb-4 flex items-start gap-3">
            <span className="text-xl">🤖</span>
            <div className="text-xs text-blue-700">
              <p className="font-semibold mb-1">Powered by Claude Vision (Anthropic)</p>
              <p>PDF analysis typically completes in 10–15 seconds. Results are cached for 24 hours per document.</p>
            </div>
          </div>

          <a
            href="/insurance/health-plan-check"
            className="block w-full bg-[#001F3F] hover:bg-[#003060] text-white font-bold text-sm text-center py-3 px-6 rounded-full transition-colors"
          >
            Analyze My University Health Plan →
          </a>
        </div>

        {/* Trust signals */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { icon: '🏆', label: 'A+ Rated Carrier', sub: 'AM Best' },
            { icon: '⚡', label: 'Instant Quotes', sub: 'No waiting' },
            { icon: '🌐', label: '12,000+ Banks', sub: 'Global coverage' },
            { icon: '🔒', label: 'PII Protected', sub: 'AES-256-GCM' },
          ].map(({ icon, label, sub }) => (
            <div key={label} className="text-center p-4 bg-white rounded-2xl shadow-sm border border-gray-100">
              <div className="text-2xl mb-2">{icon}</div>
              <div className="font-bold text-gray-900 text-sm">{label}</div>
              <div className="text-gray-400 text-xs">{sub}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
