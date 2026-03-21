/**
 * apps/landlord-portal/src/app/landlord/signup/page.tsx
 * Landlord registration — full brand treatment
 */
'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { VectaNav } from '@/components/VectaNav';

type Step = 'form' | 'check_email' | 'verified' | 'background_check';

const input = (extra: Record<string,string> = {}) => ({
  width: '100%', borderRadius: '0.75rem',
  border: '1.5px solid #D6E4EC',
  padding: '0.8rem 1rem',
  fontSize: '0.9rem', color: '#001F3F',
  outline: 'none', boxSizing: 'border-box' as const,
  background: '#FAFCFD', fontFamily: 'inherit',
  transition: 'border-color 0.15s',
  ...extra,
});

export default function LandlordSignupPage() {
  const [step,        setStep]        = useState<Step>('form');
  const [email,       setEmail]       = useState('');
  const [fullName,    setFullName]    = useState('');
  const [companyName, setCompanyName] = useState('');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) { setError('Please enter a valid email.'); return; }
    setError(''); setLoading(true);
    try {
      const res = await fetch('/api/v1/landlord/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), fullName: fullName.trim(), companyName: companyName.trim() }),
      });
      if (!res.ok) throw new Error('Registration failed');
      setStep('check_email');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally { setLoading(false); }
  }, [email, fullName, companyName]);

  const tierBadge = (label: string, active: boolean) => (
    <span style={{
      display: 'inline-block', padding: '0.25rem 0.75rem', borderRadius: '9999px',
      fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const,
      background: active ? '#001F3F' : 'rgba(0,31,63,0.06)',
      color: active ? '#00E6CC' : '#7A9BAD',
      border: active ? '1px solid rgba(0,230,204,0.3)' : '1px solid transparent',
    }}>
      {label}
    </span>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#F4F4F4', display: 'flex', flexDirection: 'column' }}>
      <VectaNav subtitle="Landlord Portal" rightSlot={
        <Link href="/verify" style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>
          Have a verification link? →
        </Link>
      } />

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem 1rem' }}>
        <div style={{ width: '100%', maxWidth: '460px' }}>

          {step === 'form' && <>
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '64px', height: '64px', borderRadius: '50%',
                background: '#001F3F', marginBottom: '1rem',
                boxShadow: '0 0 28px -4px rgba(0,230,204,0.3)',
              }}>
                <svg width="28" height="28" fill="none" stroke="#00E6CC" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
                </svg>
              </div>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#001F3F', marginBottom: '0.5rem' }}>
                Create Your Landlord Account
              </h1>
              <p style={{ fontSize: '0.875rem', color: '#3D5A6B', lineHeight: 1.6 }}>
                Start verifying international student applicants — no SSN required.
              </p>
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                {tierBadge('Verified', true)}
                {tierBadge('Trusted', false)}
                {tierBadge('Partner', false)}
              </div>
            </div>

            {/* Form */}
            <div style={{
              background: '#FFFFFF', borderRadius: '1.5rem',
              border: '1px solid #D6E4EC',
              boxShadow: '0 4px 24px -4px rgba(0,31,63,0.10)',
              padding: '2rem',
            }}>
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#001F3F', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                    Full Name
                  </label>
                  <input type="text" placeholder="Alex Johnson" value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    style={input()} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#001F3F', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                    Email Address *
                  </label>
                  <input type="email" placeholder="alex@yourcompany.com" value={email} required
                    onChange={(e) => setEmail(e.target.value)}
                    style={input()} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#001F3F', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                    Company / Property Name
                  </label>
                  <input type="text" placeholder="Sunrise Properties LLC" value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    style={input()} />
                </div>
                {error && (
                  <p style={{ fontSize: '0.8rem', color: '#EF4444', background: '#FEF2F2', borderRadius: '0.5rem', padding: '0.6rem 0.8rem' }}>
                    {error}
                  </p>
                )}
                <button type="submit" disabled={loading} style={{
                  background: loading ? '#7A9BAD' : '#001F3F',
                  color: '#00E6CC', fontWeight: 800, fontSize: '0.9rem',
                  padding: '0.9rem', borderRadius: '9999px', border: 'none',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  letterSpacing: '0.03em', marginTop: '0.5rem',
                  transition: 'background 0.15s',
                }}>
                  {loading ? 'Sending…' : 'Send Sign-In Link →'}
                </button>
              </form>
              <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.75rem', color: '#7A9BAD', lineHeight: 1.6 }}>
                We'll email you a magic link. No password needed. By registering you agree to{' '}
                <a href="https://vecta.io/terms" style={{ color: '#001F3F' }}>Terms of Service</a>.
              </p>
            </div>

            <p style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.8rem', color: '#7A9BAD' }}>
              Already have an account?{' '}
              <Link href="/verify" style={{ color: '#001F3F', fontWeight: 700, textDecoration: 'none' }}>Open a verification link</Link>
            </p>
          </>}

          {step === 'check_email' && (
            <div style={{ background: '#FFFFFF', borderRadius: '1.5rem', border: '1px solid #D6E4EC', boxShadow: '0 4px 24px -4px rgba(0,31,63,0.10)', padding: '2.5rem', textAlign: 'center' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1.25rem' }}>📧</div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#001F3F', marginBottom: '0.75rem' }}>
                Check Your Email
              </h2>
              <p style={{ fontSize: '0.875rem', color: '#3D5A6B', lineHeight: 1.7, marginBottom: '1.5rem' }}>
                We sent a sign-in link to{' '}
                <strong style={{ color: '#001F3F' }}>{email}</strong>.
                Click it to verify your email and unlock the <span style={{ color: '#00E6CC', fontWeight: 700 }}>VERIFIED</span> tier.
              </p>
              <div style={{ background: 'rgba(0,230,204,0.06)', border: '1px solid rgba(0,230,204,0.2)', borderRadius: '0.75rem', padding: '1rem', marginBottom: '1.5rem', textAlign: 'left' }}>
                <p style={{ fontSize: '0.78rem', fontWeight: 700, color: '#001F3F', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>What happens next</p>
                {['Click the email link → email verified', 'Access the verification portal', 'Optional: complete background check → TRUSTED tier'].map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.35rem', fontSize: '0.8rem', color: '#3D5A6B' }}>
                    <span style={{ color: '#00E6CC', fontWeight: 700 }}>✓</span>{s}
                  </div>
                ))}
              </div>
              <button onClick={() => setStep('form')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', color: '#7A9BAD' }}>
                Use a different email
              </button>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
