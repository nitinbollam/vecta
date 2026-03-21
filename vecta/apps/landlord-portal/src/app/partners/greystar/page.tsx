/**
 * apps/landlord-portal/src/app/partners/greystar/page.tsx
 *
 * Greystar Integration — First Real Protocol Consumer.
 *
 * This page is the answer to Gap 4: "Protocol without distribution is dead."
 *
 * What this implements:
 *   Greystar properties link to this branded page instead of a generic form.
 *   Students arriving from a Greystar property listing see:
 *     1. "Greystar accepts Vecta — no SSN needed"
 *     2. The exact steps to get their certificate (30 min from scratch)
 *     3. A direct apply flow that embeds the certificate check
 *
 * From Greystar's side:
 *   Their leasing agents click "Verify with Vecta" on a Greystar listing page.
 *   This URL is the endpoint. It consumes the Trust Certificate Protocol.
 *   Certificate issued via /protocol/tenant-proof (existing endpoint).
 *
 * What makes this the distribution wedge:
 *   Greystar manages 800,000+ units in the US.
 *   One Greystar MOU = every Greystar leasing agent sees the Vecta flow.
 *   Every student who gets placed = trust_signal_event = social proof.
 *   Every social proof = next landlord accepting without asking.
 *
 * This is the "one integration" that converts the protocol into behavior.
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Greystar × Vecta — Apply Without an SSN',
  description: 'Greystar residents can verify their identity and financial standing with Vecta in 30 minutes. No SSN required.',
};

// Partner config — driven by env or future DB
const PARTNER = {
  name:          'Greystar',
  logo:          '/partners/greystar-logo.png',
  accentColor:   '#00A3E0',
  unitCount:     '800,000+',
  cityCount:     '250+',
  acceptanceNote: 'Greystar has pre-committed to accepting Vecta Trust Certificates at all US properties.',
  contactEmail:  'vecta@greystar.com',
};

function Step({ number, title, time, description, icon }: {
  number: number; title: string; time: string;
  description: string; icon: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#001F3F] text-white flex items-center justify-center font-extrabold text-sm">
        {number}
      </div>
      <div className="flex-1 pb-8 border-b border-gray-100 last:border-0">
        <div className="flex items-center justify-between mb-1">
          <span className="font-bold text-gray-900 text-sm">{icon} {title}</span>
          <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">{time}</span>
        </div>
        <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function StatPill({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center px-4 py-3 bg-white rounded-xl border border-gray-100">
      <p className="font-extrabold text-2xl text-[#001F3F]">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

export default function GreystarPartnerPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">

      {/* Co-branded header */}
      <header className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-extrabold text-[#001F3F] text-lg tracking-tight">VECTA</span>
            <span className="text-gray-300 text-lg">×</span>
            {/* In production: render Greystar SVG logo */}
            <span className="font-bold text-[#00A3E0] text-lg">GREYSTAR</span>
          </div>
          <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-100 px-3 py-1 rounded-full">
            ✓ Official Partnership
          </span>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-10">

        {/* Hero */}
        <div className="text-center mb-10">
          <p className="text-xs font-bold text-[#001F3F] uppercase tracking-widest mb-3">
            F-1 Student Application
          </p>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 leading-tight mb-4">
            Rent a Greystar Apartment<br />
            <span className="text-[#001F3F]">Without an SSN or US Credit Score</span>
          </h1>
          <p className="text-gray-500 text-base leading-relaxed max-w-lg mx-auto">
            Greystar has partnered with Vecta to accept international students with a
            cryptographically verified Trust Certificate instead of a US credit report.
            Complete your verification in under 30 minutes.
          </p>
        </div>

        {/* Greystar commitment */}
        <div className="bg-[#00A3E0]/5 border border-[#00A3E0]/20 rounded-2xl p-5 mb-8">
          <div className="flex items-start gap-3">
            <span className="text-2xl flex-shrink-0">🏢</span>
            <div>
              <p className="font-bold text-gray-900 text-sm mb-1">Greystar Pre-Commitment</p>
              <p className="text-sm text-gray-600 leading-relaxed">
                {PARTNER.acceptanceNote} No additional SSN, US credit history, or co-signer required
                when you present a valid Vecta Trust Certificate.
              </p>
            </div>
          </div>
        </div>

        {/* Network stats */}
        <div className="grid grid-cols-3 gap-3 mb-10">
          <StatPill value={PARTNER.unitCount} label="Units in US" />
          <StatPill value={PARTNER.cityCount}  label="Cities" />
          <StatPill value="30 min"             label="To verify" />
        </div>

        {/* Steps */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 mb-8">
          <h2 className="font-extrabold text-gray-900 text-base mb-6">
            How to Apply at Any Greystar Property
          </h2>
          <div className="space-y-0">
            <Step
              number={1} icon="📱" title="Download Vecta" time="2 min"
              description="Download the Vecta app on iOS or Android. Sign in with your university email — no password needed."
            />
            <Step
              number={2} icon="🛂" title="Scan Your Passport" time="5 min"
              description="Vecta uses NFC chip verification — tap your passport to your phone. Liveness check confirms it's you, not a photo."
            />
            <Step
              number={3} icon="🏦" title="Connect Your Bank" time="10 min"
              description="Link your home-country or US bank account via Plaid. Vecta generates a verified liquidity statement — your exact balance is never shown to landlords."
            />
            <Step
              number={4} icon="🌍" title="International Credit Check" time="5 min"
              description="Nova Credit translates your home-country credit history to a US 300–850 score. If you have no history, Vecta uses your verified liquidity as a proxy."
            />
            <Step
              number={5} icon="📄" title="Share Your Certificate" time="1 min"
              description="Your Vecta Trust Certificate is ready. Send the link to your Greystar leasing agent. They can verify it in under 30 seconds — cryptographically, with no Vecta involvement."
            />
          </div>
        </div>

        {/* Zero-knowledge proof explanation */}
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-5 mb-8">
          <h3 className="font-bold text-gray-900 text-sm mb-2">🔐 What Greystar Sees</h3>
          <div className="space-y-2">
            {[
              ['✅', 'Identity Confirmed', 'NFC passport + liveness verified'],
              ['✅', 'F-1 Visa Valid',     'Chip-authenticated, not self-reported'],
              ['✅', 'Liquidity: 14 months rent covered', 'Plaid-verified, exact balance hidden'],
              ['✅', 'International credit: GOOD tier', 'Nova Credit translated score'],
              ['🔒', 'Passport number', 'Encrypted vault — never shared'],
              ['🔒', 'Exact bank balance', 'Tier only, per Fair Housing Act'],
              ['🔒', 'Country of origin', 'Excluded per 42 U.S.C. § 3604'],
            ].map(([icon, label, note]) => (
              <div key={label} className="flex items-center gap-3">
                <span className="text-sm w-5 flex-shrink-0">{icon}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-gray-700">{label}</span>
                  <span className="text-xs text-gray-400 ml-2">{note}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="space-y-3">
          <a
            href="https://app.vecta.io/onboarding?partner=greystar&utm_source=greystar&utm_medium=partner_page"
            className="block w-full bg-[#001F3F] hover:bg-[#003060] text-white font-extrabold text-base py-4 px-6 rounded-2xl text-center transition-colors"
          >
            Start My Vecta Verification →
          </a>
          <p className="text-xs text-gray-400 text-center">
            Already have a certificate?{' '}
            <a href="/verify" className="text-[#001F3F] hover:underline font-semibold">
              Send it to your leasing agent
            </a>
          </p>
        </div>

        {/* Landlord side — the other half of the market */}
        <div className="mt-10 pt-8 border-t border-gray-100">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 text-center">
            Are you a Greystar leasing agent?
          </p>
          <a
            href="/verify"
            className="block w-full bg-white hover:bg-gray-50 text-[#001F3F] font-bold text-sm py-3 px-6 rounded-xl border border-[#001F3F]/20 text-center transition-colors"
          >
            Verify a Student's Vecta Certificate →
          </a>
          <p className="text-xs text-gray-400 text-center mt-2">
            30-second verification · No Vecta account required · Cryptographically signed
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-8">
          Questions?{' '}
          <a href={`mailto:${PARTNER.contactEmail}`} className="hover:underline">{PARTNER.contactEmail}</a>
          {' · '}
          <a href="mailto:partnerships@vecta.io" className="hover:underline">partnerships@vecta.io</a>
        </p>

      </div>
    </main>
  );
}
