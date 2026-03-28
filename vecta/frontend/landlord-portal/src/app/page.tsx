/**
 * app/page.tsx — Vecta Landlord Portal homepage
 * Brand: #001F3F · #001A33 · #00E6CC · Financial Embassy & Life-as-a-Service
 */

import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vecta — Verify International Student Applicants Without an SSN',
  description:
    'Cryptographically signed identity + financial guarantee for F-1 international students. No SSN. No co-signer. Fair Housing compliant.',
};

/* ── Inline SVG logo mark ───────────────────────────── */
function LogoMark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size * 1.08} viewBox="0 0 120 130" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g-teal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#00E6CC" />
          <stop offset="100%" stopColor="#009E8F" />
        </linearGradient>
        <linearGradient id="g-navy" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#001A33" />
          <stop offset="100%" stopColor="#001225" />
        </linearGradient>
        <linearGradient id="g-mid" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#0A3A5C" />
          <stop offset="100%" stopColor="#0D4A6E" />
        </linearGradient>
      </defs>
      {/* Left wing */}
      <polygon points="0,0 58,0 30,65"         fill="url(#g-navy)" />
      <polygon points="0,0 30,65 0,90"          fill="#001A33" opacity="0.85" />
      <polygon points="30,65 0,90 18,115 60,130" fill="#001225" opacity="0.7" />
      {/* Right wing */}
      <polygon points="62,0 120,0 90,65"         fill="url(#g-navy)" />
      <polygon points="120,0 90,65 120,90"        fill="#001A33" opacity="0.85" />
      <polygon points="90,65 120,90 102,115 60,130" fill="#001225" opacity="0.7" />
      {/* V-notch centre */}
      <polygon points="30,10 90,10 60,72"         fill="url(#g-mid)" />
      {/* Teal facets top-right */}
      <polygon points="72,0 120,0 100,28"         fill="url(#g-teal)" />
      <polygon points="100,28 120,0 120,55"        fill="#00E6CC" opacity="0.75" />
      <polygon points="80,0 100,28 90,10"          fill="#00E6CC" opacity="0.5" />
      {/* Keyhole */}
      <circle cx="60" cy="55" r="10" fill="rgba(255,255,255,0.12)" />
      <circle cx="60" cy="55" r="6"  fill="#00E6CC" />
      <rect   x="56" y="59" width="8" height="11" rx="2" fill="#00E6CC" />
      {/* Arrow */}
      <line x1="76" y1="30" x2="100" y2="6" stroke="#00E6CC" strokeWidth="4" strokeLinecap="round" />
      <polygon points="100,6 88,6 100,18" fill="#00E6CC" />
    </svg>
  );
}

/* ── Stat chip ─────────────────────────────────────── */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div style={{
        fontFamily:    '"Bebas Neue", "Impact", sans-serif',
        fontSize:      '2.4rem',
        color:         '#00E6CC',
        letterSpacing: '0.04em',
        lineHeight:    1,
      }}>
        {value}
      </div>
      <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '4px' }}>
        {label}
      </div>
    </div>
  );
}

/* ── Feature card ──────────────────────────────────── */
function FeatureCard({ icon, title, body, teal }: {
  icon: string; title: string; body: string; teal?: boolean;
}) {
  return (
    <div style={{
      background:   teal ? 'linear-gradient(135deg, rgba(0,230,204,0.1) 0%, rgba(0,230,204,0.04) 100%)' : '#FFFFFF',
      borderRadius: '1.25rem',
      border:       teal ? '1px solid rgba(0,230,204,0.3)' : '1px solid #D6E4EC',
      padding:      '1.75rem',
      boxShadow:    '0 4px 24px -4px rgba(0,31,63,0.10)',
    }}>
      <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>{icon}</div>
      <h3 style={{ fontWeight: 700, fontSize: '1rem', color: teal ? '#001F3F' : '#001F3F', marginBottom: '0.5rem' }}>
        {title}
      </h3>
      <p style={{ fontSize: '0.875rem', color: '#3D5A6B', lineHeight: 1.6 }}>{body}</p>
    </div>
  );
}

/* ── Vault pill ────────────────────────────────────── */
function VaultPill({ label }: { label: string }) {
  return (
    <span style={{
      display:        'inline-flex',
      alignItems:     'center',
      gap:            '0.35rem',
      background:     '#FFFFFF',
      border:         '1px solid #D6E4EC',
      borderRadius:   '9999px',
      padding:        '0.35rem 0.85rem',
      fontSize:       '0.78rem',
      fontWeight:     600,
      color:          '#3D5A6B',
    }}>
      <svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
      </svg>
      {label}
    </span>
  );
}

/* ── Process step ──────────────────────────────────── */
function Step({ n, title, sub }: { n: number; title: string; sub: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
      <div style={{
        width: '2rem', height: '2rem', flexShrink: 0,
        background: '#00E6CC',
        borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, fontSize: '0.875rem', color: '#001F3F',
        marginTop: '2px',
      }}>
        {n}
      </div>
      <div>
        <div style={{ fontWeight: 700, color: '#001F3F', fontSize: '0.95rem' }}>{title}</div>
        <div style={{ fontSize: '0.825rem', color: '#3D5A6B', marginTop: '2px', lineHeight: 1.5 }}>{sub}</div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div style={{ minHeight: '100vh', background: '#F4F4F4' }}>

      {/* ── NAV ─────────────────────────────────────────── */}
      <nav style={{
        background: '#001F3F',
        borderBottom: '1px solid rgba(0,230,204,0.12)',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{
          maxWidth: '1100px', margin: '0 auto', padding: '0 1.5rem',
          height: '64px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <LogoMark size={36} />
            <div>
              <div style={{
                fontFamily:    '"Bebas Neue", "Impact", sans-serif',
                fontSize:      '1.5rem',
                letterSpacing: '0.08em',
                color:         '#FFFFFF',
                lineHeight:    1,
              }}>
                VECTA
              </div>
              <div style={{
                fontSize:      '0.55rem',
                letterSpacing: '0.18em',
                color:         'rgba(255,255,255,0.45)',
                textTransform: 'uppercase',
              }}>
                Financial Embassy &amp; Life-as-a-Service
              </div>
            </div>
          </div>

          {/* Nav links */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <a href="mailto:landlords@vecta.io"
              style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.65)', textDecoration: 'none' }}>
              Contact
            </a>
            <Link href="/landlord/signup"
              style={{
                background: '#00E6CC', color: '#001F3F',
                fontWeight: 700, fontSize: '0.825rem',
                padding: '0.5rem 1.25rem', borderRadius: '9999px',
                textDecoration: 'none', letterSpacing: '0.02em',
              }}>
              Get Access
            </Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ────────────────────────────────────────── */}
      <section style={{
        background: 'linear-gradient(135deg, #001F3F 0%, #003060 55%, #001A33 100%)',
        position: 'relative',
        overflow: 'hidden',
        padding: '5rem 1.5rem 6rem',
      }}>
        {/* Mesh overlay */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: `
            linear-gradient(60deg, rgba(0,230,204,0.04) 1px, transparent 1px),
            linear-gradient(-60deg, rgba(0,230,204,0.04) 1px, transparent 1px)
          `,
          backgroundSize: '80px 80px',
        }} />
        {/* Teal glow blob */}
        <div style={{
          position: 'absolute', top: '-80px', right: '-80px',
          width: '500px', height: '500px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,230,204,0.12) 0%, transparent 65%)',
          pointerEvents: 'none',
        }} />

        <div style={{ maxWidth: '860px', margin: '0 auto', textAlign: 'center', position: 'relative' }}>
          {/* Status badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            background: 'rgba(0,230,204,0.12)',
            border: '1px solid rgba(0,230,204,0.25)',
            borderRadius: '9999px', padding: '0.4rem 1rem',
            fontSize: '0.75rem', color: '#00E6CC',
            letterSpacing: '0.06em', marginBottom: '2rem',
            fontWeight: 600,
          }}>
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: '#00E6CC', display: 'inline-block',
              boxShadow: '0 0 6px rgba(0,230,204,0.8)',
              animation: 'teal-pulse 2s ease-in-out infinite',
            }} />
            NFC-VERIFIED IDENTITY · NO SSN REQUIRED · FAIR HOUSING COMPLIANT
          </div>

          {/* Hero headline */}
          <h1 style={{
            fontFamily:    '"Bebas Neue", "Impact", sans-serif',
            fontSize:      'clamp(3rem, 8vw, 5.5rem)',
            letterSpacing: '0.04em',
            color:         '#FFFFFF',
            lineHeight:    0.95,
            marginBottom:  '1.5rem',
          }}>
            VERIFY INTERNATIONAL<br />
            <span style={{ color: '#00E6CC' }}>STUDENTS IN 30 SECONDS</span>
          </h1>

          <p style={{
            fontSize: '1.125rem', color: 'rgba(255,255,255,0.65)',
            maxWidth: '640px', margin: '0 auto 2.5rem',
            lineHeight: 1.7,
          }}>
            Vecta gives you a cryptographically signed Trust Certificate — identity verified via
            NFC passport chip, financial standing confirmed via Plaid, international credit
            translated by Nova Credit. Zero SSN. Zero co-signer.
          </p>

          {/* CTAs */}
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/verify" style={{
              background: '#00E6CC', color: '#001F3F',
              fontWeight: 800, fontSize: '0.95rem',
              padding: '0.9rem 2.25rem', borderRadius: '9999px',
              textDecoration: 'none', letterSpacing: '0.03em',
              boxShadow: '0 0 32px -4px rgba(0,230,204,0.4)',
              display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            }}>
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Open Verification Link
            </Link>
            <Link href="/landlord/signup" style={{
              background: 'transparent', color: '#00E6CC',
              fontWeight: 700, fontSize: '0.875rem',
              padding: '0.85rem 2rem', borderRadius: '9999px',
              textDecoration: 'none',
              border: '1.5px solid rgba(0,230,204,0.35)',
              display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            }}>
              Create Landlord Account →
            </Link>
          </div>
        </div>

        {/* Stats bar */}
        <div style={{
          maxWidth: '700px', margin: '4rem auto 0',
          display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: '2rem',
          borderTop: '1px solid rgba(0,230,204,0.15)',
          paddingTop: '2.5rem',
        }}>
          <Stat value="30s"  label="Verification time" />
          <Stat value="100%" label="Zero-knowledge proof" />
          <Stat value="Ed25519" label="Cryptographic signing" />
          <Stat value="4-Layer" label="F-1 Compliance" />
        </div>
      </section>

      {/* ── HOW IT WORKS ────────────────────────────────── */}
      <section style={{ background: '#FFFFFF', padding: '5rem 1.5rem' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
            <p style={{ fontSize: '0.75rem', letterSpacing: '0.15em', color: '#00B8A4', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.75rem' }}>
              The Process
            </p>
            <h2 style={{ fontSize: '2.25rem', fontWeight: 800, color: '#001F3F' }}>
              How Vecta Works
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2.5rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
              <Step n={1} title="Student completes verification"
                sub="NFC passport scan + liveness check + bank connection in the Vecta mobile app. Takes 20 minutes." />
              <Step n={2} title="Vecta signs the certificate"
                sub="Ed25519 cryptographic signature on a deterministic hash of the trust attributes. Tamper-evident." />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
              <Step n={3} title="Student shares a link"
                sub="One-time link sent to you — the URL is the certificate. No app download needed on your side." />
              <Step n={4} title="You verify in your browser"
                sub="Open the link. Facts displayed in under 5 seconds. Accept tenant with one click. Done." />
            </div>
          </div>
        </div>
      </section>

      {/* ── WHAT'S VERIFIED ─────────────────────────────── */}
      <section style={{ background: '#F4F4F4', padding: '5rem 1.5rem' }}>
        <div style={{ maxWidth: '1060px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <p style={{ fontSize: '0.75rem', letterSpacing: '0.15em', color: '#00B8A4', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.75rem' }}>
              Trust Signals
            </p>
            <h2 style={{ fontSize: '2.25rem', fontWeight: 800, color: '#001F3F' }}>
              What Vecta Verifies For You
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.25rem' }}>
            <FeatureCard teal icon="🛂" title="NFC Chip Passport"
              body="Biometric chip authentication — not a photo scan. Includes liveness check (≥92%) and facial match (≥90%). Signed by the issuing government." />
            <FeatureCard icon="🏦" title="Financial Solvency (Plaid)"
              body="Multi-institution asset report. We confirm a rent guarantee amount — your applicant's exact balance is never disclosed." />
            <FeatureCard icon="🌐" title="International Credit (Nova Credit)"
              body="Home-country credit history translated to a 300–850 US-equivalent score via Nova Credit's global bureau network." />
            <FeatureCard icon="🎓" title="F-1 Visa & Enrollment"
              body="Visa expiry year and university enrollment verified against NFC passport data. Not self-reported." />
            <FeatureCard icon="🔐" title="Ed25519 Cryptographic Proof"
              body="Every certificate is signed with an Ed25519 key. You can verify the signature in your browser — no Vecta server call required." />
            <FeatureCard icon="⚖️" title="Fair Housing Compliant"
              body="Country of origin, passport number, and national ID are cryptographically vaulted and excluded from every landlord report. 42 U.S.C. § 3604." />
          </div>
        </div>
      </section>

      {/* ── PRIVACY VAULT ────────────────────────────────── */}
      <section style={{
        background: 'linear-gradient(135deg, #001F3F 0%, #001A33 100%)',
        padding: '5rem 1.5rem',
      }}>
        <div style={{ maxWidth: '840px', margin: '0 auto', textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '56px', height: '56px', borderRadius: '50%',
            background: 'rgba(0,230,204,0.12)',
            border: '1px solid rgba(0,230,204,0.25)',
            marginBottom: '1.5rem', fontSize: '1.5rem',
          }}>
            🔒
          </div>
          <h2 style={{ fontSize: '2.25rem', fontWeight: 800, color: '#FFFFFF', marginBottom: '1rem' }}>
            What Vecta Protects
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.55)', maxWidth: '600px', margin: '0 auto 2.5rem', lineHeight: 1.7 }}>
            Fair Housing law prohibits discrimination based on national origin. Vecta enforces
            this at the cryptographic layer — these fields are AES-256-GCM encrypted and
            never included in any landlord-facing report.
          </p>

          {/* Teal divider */}
          <div style={{
            height: '1px',
            background: 'linear-gradient(90deg, transparent, rgba(0,230,204,0.5) 40%, rgba(0,230,204,0.5) 60%, transparent)',
            marginBottom: '2.5rem',
          }} />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', justifyContent: 'center' }}>
            {[
              'Country of Origin',
              'Passport Number',
              'National ID Number',
              'Exact Bank Balance',
              'Bank Account Numbers',
              'IMEI / Phone Hardware',
              'Home-Country Address',
              'Tax ID / ITN',
              'Date of Birth',
              'Home-Country Employer',
            ].map((f) => (
              <span key={f} style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '9999px',
                padding: '0.35rem 0.9rem',
                fontSize: '0.78rem', fontWeight: 600,
                color: 'rgba(255,255,255,0.65)',
              }}>
                <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" style={{ color: '#00E6CC' }}>
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                {f}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── PARTNERS ─────────────────────────────────────── */}
      <section style={{ background: '#FFFFFF', padding: '4rem 1.5rem' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto', textAlign: 'center' }}>
          <p style={{ fontSize: '0.75rem', letterSpacing: '0.15em', color: '#7A9BAD', fontWeight: 600, textTransform: 'uppercase', marginBottom: '2rem' }}>
            Trusted integration partners
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'center', alignItems: 'center' }}>
            {['Unit.co', 'Plaid', 'Didit', 'Nova Credit', 'Checkr', 'Lemonade', 'eSIM Go'].map((p) => (
              <span key={p} style={{
                padding: '0.5rem 1.25rem',
                background: '#F4F4F4',
                border: '1px solid #D6E4EC',
                borderRadius: '9999px',
                fontSize: '0.825rem', fontWeight: 600,
                color: '#3D5A6B',
              }}>
                {p}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ────────────────────────────────────── */}
      <section style={{
        background: '#F4F4F4',
        padding: '5rem 1.5rem',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '2.5rem', fontWeight: 800, color: '#001F3F', marginBottom: '1rem' }}>
            Ready to verify?
          </h2>
          <p style={{ color: '#3D5A6B', marginBottom: '2rem', lineHeight: 1.7 }}>
            Have a verification link from a student? Open it below.
            Creating an account lets you request verifications directly.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/verify" style={{
              background: '#001F3F', color: '#00E6CC',
              fontWeight: 800, fontSize: '0.95rem',
              padding: '0.9rem 2.25rem', borderRadius: '9999px',
              textDecoration: 'none', letterSpacing: '0.03em',
              boxShadow: '0 4px 24px -4px rgba(0,31,63,0.2)',
              display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            }}>
              Open Verification Link →
            </Link>
            <Link href="/landlord/signup" style={{
              background: 'transparent', color: '#001F3F',
              fontWeight: 700, fontSize: '0.875rem',
              padding: '0.85rem 2rem', borderRadius: '9999px',
              textDecoration: 'none',
              border: '1.5px solid #D6E4EC',
            }}>
              Create Account
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────── */}
      <footer style={{
        background: '#001F3F',
        borderTop: '1px solid rgba(0,230,204,0.12)',
        padding: '2.5rem 1.5rem',
      }}>
        <div style={{
          maxWidth: '1100px', margin: '0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: '1rem',
        }}>
          {/* Footer logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <LogoMark size={28} />
            <div>
              <div style={{
                fontFamily: '"Bebas Neue", "Impact", sans-serif',
                fontSize: '1.1rem', letterSpacing: '0.08em', color: '#FFFFFF', lineHeight: 1,
              }}>VECTA</div>
              <div style={{ fontSize: '0.5rem', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>
                Financial Embassy &amp; Life-as-a-Service
              </div>
            </div>
          </div>

          {/* Footer links */}
          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
            {[
              ['Contact', 'mailto:landlords@vecta.io'],
              ['Privacy', 'https://vecta.io/privacy'],
              ['Terms', 'https://vecta.io/terms'],
              ['Docs', '/.well-known/vecta-keys.json'],
            ].map(([label, href]) => (
              <a key={label} href={href} style={{
                fontSize: '0.8rem', color: 'rgba(255,255,255,0.45)',
                textDecoration: 'none',
              }}>
                {label}
              </a>
            ))}
          </div>

          <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)' }}>
            © {new Date().getFullYear()} Vecta Financial Services LLC
          </p>
        </div>
      </footer>

    </div>
  );
}
