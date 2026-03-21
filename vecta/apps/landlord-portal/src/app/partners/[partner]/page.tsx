/**
 * apps/landlord-portal/src/app/partners/[partner]/page.tsx
 *
 * Dynamic partner page — same structure as Greystar, parameterized.
 *
 * Adding a new partner:
 *   1. Add entry to PARTNERS below
 *   2. Register as corporate partner: addCorporatePartner(name, city)
 *   3. Page live at /partners/{partner-slug}
 *
 * Current partners: greystar, equity-residential, avalonbay, mit-housing
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

interface PartnerConfig {
  name:           string;
  accentColor:    string;
  unitCount:      string;
  cityCount:      string;
  type:           'CORPORATE' | 'UNIVERSITY';
  acceptanceNote: string;
  targetCity?:    string;
  contactEmail:   string;
}

const PARTNERS: Record<string, PartnerConfig> = {
  'greystar': {
    name:           'Greystar',
    accentColor:    '#00A3E0',
    unitCount:      '800,000+',
    cityCount:      '250+',
    type:           'CORPORATE',
    acceptanceNote: 'Greystar has pre-committed to accepting Vecta Trust Certificates at all US properties.',
    contactEmail:   'vecta@greystar.com',
  },
  'equity-residential': {
    name:           'Equity Residential',
    accentColor:    '#E4002B',
    unitCount:      '80,000+',
    cityCount:      '12',
    type:           'CORPORATE',
    acceptanceNote: 'Equity Residential accepts Vecta-verified international students at participating properties.',
    contactEmail:   'partnerships@equityapartments.com',
  },
  'avalonbay': {
    name:           'AvalonBay Communities',
    accentColor:    '#0052CC',
    unitCount:      '90,000+',
    cityCount:      '14',
    type:           'CORPORATE',
    acceptanceNote: 'AvalonBay accepts Vecta Trust Certificates as a substitute for US credit history.',
    contactEmail:   'ir@avalonbay.com',
  },
  'mit-housing': {
    name:           'MIT Off-Campus Housing',
    accentColor:    '#8A1818',
    unitCount:      '500+',
    cityCount:      '1',
    type:           'UNIVERSITY',
    targetCity:     'Cambridge',
    acceptanceNote: 'MIT Housing Office mandates Vecta verification for off-campus listings on the MIT housing portal.',
    contactEmail:   'housing@mit.edu',
  },
  'harvard-housing': {
    name:           'Harvard Off-Campus Housing',
    accentColor:    '#A41034',
    unitCount:      '300+',
    cityCount:      '1',
    type:           'UNIVERSITY',
    targetCity:     'Cambridge',
    acceptanceNote: 'Harvard Off-Campus Housing accepts Vecta certificates for all listed units.',
    contactEmail:   'orl@harvard.edu',
  },
  'bu-housing': {
    name:           'Boston University Housing',
    accentColor:    '#CC0000',
    unitCount:      '200+',
    cityCount:      '1',
    type:           'UNIVERSITY',
    targetCity:     'Boston',
    acceptanceNote: 'BU Off-Campus Housing accepts Vecta certificates through the BU housing portal.',
    contactEmail:   'housing@bu.edu',
  },
};

export async function generateMetadata({ params }: { params: { partner: string } }): Promise<Metadata> {
  const config = PARTNERS[params.partner];
  if (!config) return { title: 'Partner Not Found' };
  return {
    title: `${config.name} × Vecta — Apply Without an SSN`,
    description: `${config.name} residents can verify with Vecta in 30 minutes. No SSN required.`,
  };
}

export default function PartnerPage({ params }: { params: { partner: string } }) {
  const config = PARTNERS[params.partner];
  if (!config) notFound();

  const isUniversity = config.type === 'UNIVERSITY';

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-extrabold text-[#001F3F] text-lg tracking-tight">VECTA</span>
            <span className="text-gray-300 text-lg">×</span>
            <span className="font-bold text-lg" style={{ color: config.accentColor }}>
              {config.name.toUpperCase()}
            </span>
          </div>
          <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-100 px-3 py-1 rounded-full">
            ✓ {isUniversity ? 'University Partner' : 'Official Partnership'}
          </span>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="text-center mb-10">
          <p className="text-xs font-bold text-[#001F3F] uppercase tracking-widest mb-3">
            {isUniversity ? 'University Housing Verification' : 'F-1 Student Application'}
          </p>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 leading-tight mb-4">
            Apply to {config.name}<br />
            <span className="text-[#001F3F]">Without an SSN or US Credit</span>
          </h1>
          <p className="text-gray-500 text-base leading-relaxed max-w-lg mx-auto">
            {config.acceptanceNote}
          </p>
        </div>

        {config.targetCity && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6 text-sm text-blue-800 text-center">
            📍 Available for properties in <strong>{config.targetCity}</strong>
          </div>
        )}

        <div className="space-y-4 mb-8">
          <a
            href={`https://app.vecta.io/onboarding?partner=${params.partner}&utm_source=${params.partner}&utm_medium=partner_page`}
            className="block w-full text-white font-extrabold text-base py-4 px-6 rounded-2xl text-center transition-colors"
            style={{ backgroundColor: '#001F3F' }}
          >
            Start My Vecta Verification →
          </a>
          <a
            href="/verify"
            className="block w-full bg-white text-[#001F3F] font-bold text-sm py-3 px-6 rounded-xl border border-gray-200 text-center"
          >
            {isUniversity ? 'Send certificate to housing office' : 'Send certificate to leasing agent'} →
          </a>
        </div>

        <p className="text-center text-xs text-gray-400">
          Questions?{' '}
          <a href={`mailto:${config.contactEmail}`} className="hover:underline">{config.contactEmail}</a>
          {' · '}
          <a href="mailto:partnerships@vecta.io" className="hover:underline">partnerships@vecta.io</a>
        </p>
      </div>
    </main>
  );
}
