/**
 * app/verify/page.tsx — Token entry page (fully branded)
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { VectaNav } from '@/components/VectaNav';

export default function VerifyEntryPage() {
  const router = useRouter();
  const [input,  setInput]  = useState('');
  const [error,  setError]  = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = input.trim();
    if (!trimmed) { setError('Please paste a verification link or token.'); return; }

    let token = trimmed;
    try {
      const url   = new URL(trimmed);
      const parts = url.pathname.split('/').filter(Boolean);
      const idx   = parts.indexOf('verify');
      if (idx !== -1 && parts[idx + 1]) token = parts[idx + 1]!;
    } catch { /* bare token */ }

    if (token.length < 20) { setError('This does not look like a valid Vecta token.'); return; }
    router.push(`/verify/${token}`);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#F4F4F4', display: 'flex', flexDirection: 'column' }}>
      <VectaNav subtitle="Identity Verification" />

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem 1rem' }}>
        <div style={{ width: '100%', maxWidth: '480px' }}>

          {/* Icon */}
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '72px', height: '72px', borderRadius: '50%',
              background: '#001F3F',
              boxShadow: '0 0 32px -4px rgba(0,230,204,0.3)',
              marginBottom: '1.25rem',
            }}>
              <svg width="32" height="32" fill="none" stroke="#00E6CC" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
              </svg>
            </div>
            <h1 style={{ fontWeight: 800, fontSize: '1.75rem', color: '#001F3F', marginBottom: '0.5rem' }}>
              Verify a Student
            </h1>
            <p style={{ fontSize: '0.9rem', color: '#3D5A6B', lineHeight: 1.6 }}>
              Paste the Vecta ID link your applicant shared with you.
            </p>
          </div>

          {/* Form card */}
          <div style={{
            background: '#FFFFFF', borderRadius: '1.5rem',
            border: '1px solid #D6E4EC',
            boxShadow: '0 4px 24px -4px rgba(0,31,63,0.10)',
            padding: '2rem',
          }}>
            <form onSubmit={handleSubmit}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#001F3F', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.6rem' }}>
                Verification Link or Token
              </label>
              <textarea
                id="token-input"
                value={input}
                onChange={(e) => { setInput(e.target.value); setError(''); }}
                placeholder="https://verify.vecta.io/verify/eyJhbG… or paste the token directly"
                rows={3}
                style={{
                  width: '100%', borderRadius: '0.75rem',
                  border: `1.5px solid ${error ? '#EF4444' : '#D6E4EC'}`,
                  padding: '0.85rem 1rem',
                  fontSize: '0.8rem', color: '#001F3F',
                  fontFamily: '"JetBrains Mono","Fira Code",monospace',
                  resize: 'none', outline: 'none',
                  background: '#F4F4F4',
                  lineHeight: 1.5,
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                }}
                onFocus={(e) => { if (!error) e.currentTarget.style.borderColor = '#00E6CC'; }}
                onBlur={(e)  => { if (!error) e.currentTarget.style.borderColor = '#D6E4EC'; }}
              />
              {error && (
                <p style={{ fontSize: '0.8rem', color: '#EF4444', marginTop: '0.4rem' }}>{error}</p>
              )}

              <button type="submit" style={{
                width: '100%', marginTop: '1rem',
                background: '#001F3F', color: '#00E6CC',
                fontWeight: 800, fontSize: '0.9rem',
                padding: '0.9rem 1.5rem', borderRadius: '9999px',
                border: 'none', cursor: 'pointer',
                letterSpacing: '0.03em',
                boxShadow: '0 4px 20px -4px rgba(0,31,63,0.2)',
                transition: 'background 0.15s',
              }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#003060'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#001F3F'; }}
              >
                Verify Applicant →
              </button>
            </form>

            {/* Divider */}
            <div style={{ margin: '1.5rem 0', height: '1px', background: 'linear-gradient(90deg, transparent, rgba(0,230,204,0.3) 50%, transparent)' }} />

            {/* How-to */}
            <div style={{ background: '#F4F4F4', borderRadius: '0.75rem', padding: '1rem' }}>
              <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#001F3F', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.6rem' }}>
                How to get a verification link
              </p>
              {[
                'Student opens the Vecta app',
                'Taps "Share Vecta ID" on their profile',
                'Sends you the generated link',
                'Link is single-use and expires in 30 days',
              ].map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', marginBottom: '0.4rem' }}>
                  <span style={{ width: '18px', height: '18px', borderRadius: '50%', background: '#00E6CC', color: '#001F3F', fontSize: '0.65rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '1px' }}>
                    {i + 1}
                  </span>
                  <span style={{ fontSize: '0.8rem', color: '#3D5A6B' }}>{s}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Footer links */}
          <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.78rem', color: '#7A9BAD' }}>
            <a href="/" style={{ color: '#001F3F', fontWeight: 600, textDecoration: 'none' }}>← Back to home</a>
            {'  ·  '}
            <a href="mailto:landlords@vecta.io" style={{ color: '#7A9BAD', textDecoration: 'none' }}>landlords@vecta.io</a>
          </p>
        </div>
      </main>
    </div>
  );
}
