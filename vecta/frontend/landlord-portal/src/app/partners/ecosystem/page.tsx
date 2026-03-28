import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Vecta | Credential verification for partners',
  description: 'Verify Vecta W3C Verifiable Credentials for employers, lenders, carriers, and banks.',
};

export default function EcosystemPartnersPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-[#001F3F] text-white py-10 px-6">
        <div className="max-w-3xl mx-auto">
          <p className="text-[#00E6CC] text-xs font-bold uppercase tracking-widest mb-2">Partners</p>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Vecta Credential Verification — For Partners
          </h1>
          <p className="mt-3 text-blue-100 text-sm max-w-2xl leading-relaxed">
            Integrate in minutes or verify with zero code. Vecta issues standards-based credentials
            you can trust without onboarding as a Vecta customer.
          </p>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-12">
        <section className="space-y-4">
          <h2 className="text-lg font-extrabold text-[#001F3F]">What is a Vecta Credential?</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            A Vecta Verifiable Credential is a digitally signed document that proves specific facts
            about an international student — verified by NFC passport chip, bank data, and payment
            history. It follows the{' '}
            <a
              className="text-[#00B8A4] font-semibold underline"
              href="https://www.w3.org/TR/vc-data-model/"
            >
              W3C Verifiable Credentials
            </a>{' '}
            standard used by governments and enterprises worldwide.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-extrabold text-[#001F3F]">What can you verify?</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              {
                title: 'TenantProofCredential',
                body: 'For landlords and property managers — identity, liquidity bands, and rent guarantee signals.',
              },
              {
                title: 'VisaStatusCredential',
                body: 'For employers and banks — visa class and validity window without raw passport data.',
              },
              {
                title: 'CreditPortabilityCredential',
                body: 'For auto lenders and cell carriers — tiered credit and solvency signals.',
              },
              {
                title: 'ReputationScoreCredential',
                body: 'For any partner offering credit terms — portable on-time payment history as a score.',
              },
            ].map((c) => (
              <div
                key={c.title}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <h3 className="font-bold text-[#001F3F] text-sm mb-2">{c.title}</h3>
                <p className="text-xs text-slate-600 leading-relaxed">{c.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-extrabold text-[#001F3F]">How to verify in 30 seconds</h2>
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-bold text-[#00B8A4] uppercase tracking-wide mb-1">Option A</p>
              <h3 className="font-bold text-slate-900">Open link (zero integration)</h3>
              <p className="text-sm text-slate-600 mt-2">
                Ask the student to share their Vecta link. Click it. Done.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-bold text-[#00B8A4] uppercase tracking-wide mb-1">Option B</p>
              <h3 className="font-bold text-slate-900">API integration</h3>
              <p className="text-sm text-slate-600 mt-2 mb-3">
                POST the credential JSON (or <code className="text-xs bg-slate-100 px-1 rounded">vc</code>{' '}
                wrapper) to our verifier:
              </p>
              <pre className="text-xs bg-slate-900 text-green-100 p-4 rounded-xl overflow-x-auto">
                {`POST https://verify.vecta.io/api/v1/certificate/verify-vc
Content-Type: application/json

{
  "vc": { /* Verifiable Credential JSON-LD */ }
}`}
              </pre>
              <p className="text-xs text-slate-500 mt-2">
                Response includes <code className="bg-slate-100 px-1 rounded">valid</code>,{' '}
                <code className="bg-slate-100 px-1 rounded">credentialType</code>, and redacted{' '}
                <code className="bg-slate-100 px-1 rounded">subject</code>.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-bold text-[#00B8A4] uppercase tracking-wide mb-1">Option C</p>
              <h3 className="font-bold text-slate-900">QR code</h3>
              <p className="text-sm text-slate-600 mt-2">
                Student shows QR on phone. Scan it. Instant verification.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-dashed border-[#00B8A4]/40 bg-teal-50/50 p-6">
          <h2 className="text-lg font-extrabold text-[#001F3F]">Become a verified partner</h2>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            Apply for partner access: bulk verification API, webhook notifications, and reduced manual
            checks. Email{' '}
            <a className="text-[#00B8A4] font-semibold" href="mailto:partners@vecta.io">
              partners@vecta.io
            </a>{' '}
            with your company name, use case, and expected volume.
          </p>
        </section>

        <p className="text-center text-xs text-slate-400 pb-8">
          <Link href="/" className="text-[#001F3F] font-semibold hover:underline">
            ← Back to Vecta
          </Link>
        </p>
      </div>
    </main>
  );
}
