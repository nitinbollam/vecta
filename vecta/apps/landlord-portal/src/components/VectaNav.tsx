'use client';

/**
 * apps/landlord-portal/src/components/VectaNav.tsx
 *
 * Shared navigation header — used across every portal page.
 * Inline SVG mark so there are no image load dependencies.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

interface VectaNavProps {
  subtitle?:   string;
  rightSlot?:  ReactNode;
  transparent?: boolean;
}

function InlineMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 1.08)} viewBox="0 0 120 130" fill="none">
      <defs>
        <linearGradient id="nav-teal" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#00E6CC"/><stop offset="1" stopColor="#009E8F"/>
        </linearGradient>
        <linearGradient id="nav-navy" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#001A33"/><stop offset="1" stopColor="#001225"/>
        </linearGradient>
      </defs>
      {/* Wings */}
      <polygon points="0,0 58,0 30,65"            fill="url(#nav-navy)"/>
      <polygon points="0,0 30,65 0,90"             fill="#001225" opacity=".85"/>
      <polygon points="30,65 0,90 18,115 60,130"   fill="#001225" opacity=".65"/>
      <polygon points="62,0 120,0 90,65"           fill="url(#nav-navy)"/>
      <polygon points="120,0 90,65 120,90"          fill="#001225" opacity=".85"/>
      <polygon points="90,65 120,90 102,115 60,130" fill="#001225" opacity=".65"/>
      {/* V notch */}
      <polygon points="30,10 90,10 60,72"           fill="#0A3A5C"/>
      {/* Teal facets */}
      <polygon points="72,0 120,0 100,28"           fill="url(#nav-teal)"/>
      <polygon points="100,28 120,0 120,55"          fill="#00E6CC" opacity=".7"/>
      <polygon points="80,0 100,28 90,10"            fill="#00E6CC" opacity=".45"/>
      {/* Keyhole */}
      <circle cx="60" cy="55" r="6"  fill="#00E6CC"/>
      <rect   x="56"  y="59" width="8" height="11" rx="2" fill="#00E6CC"/>
      {/* Arrow */}
      <line x1="76" y1="30" x2="100" y2="6" stroke="#00E6CC" strokeWidth="4" strokeLinecap="round"/>
      <polygon points="100,6 88,6 100,18" fill="#00E6CC"/>
    </svg>
  );
}

export function VectaNav({ subtitle, rightSlot, transparent }: VectaNavProps) {
  return (
    <header style={{
      background:   transparent ? 'transparent' : '#001F3F',
      borderBottom: transparent ? 'none' : '1px solid rgba(0,230,204,0.12)',
      position:     'sticky',
      top:          0,
      zIndex:       50,
    }}>
      <div style={{
        maxWidth: '1100px', margin: '0 auto', padding: '0 1.5rem',
        height: '60px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        {/* Logo */}
        <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <InlineMark size={30} />
          <div>
            <div style={{
              fontFamily:    '"Bebas Neue","Impact","Arial Narrow",sans-serif',
              fontSize:      '1.35rem',
              letterSpacing: '0.08em',
              color:         '#FFFFFF',
              lineHeight:    1,
            }}>
              VECTA
            </div>
            {subtitle && (
              <div style={{
                fontSize:      '0.5rem',
                letterSpacing: '0.15em',
                color:         'rgba(255,255,255,0.4)',
                textTransform: 'uppercase' as const,
                lineHeight:    1,
              }}>
                {subtitle}
              </div>
            )}
          </div>
        </Link>

        {/* Right slot */}
        {rightSlot && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {rightSlot}
          </div>
        )}
      </div>
    </header>
  );
}

/** Slim teal divider line used between sections */
export function TealDivider() {
  return (
    <div style={{
      height:     '1px',
      background: 'linear-gradient(90deg, transparent, rgba(0,230,204,0.45) 30%, rgba(0,230,204,0.6) 50%, rgba(0,230,204,0.45) 70%, transparent)',
      margin:     '0',
    }} />
  );
}

/** Teal badge / chip */
export function VectaBadgeChip({ label, dot }: { label: string; dot?: boolean }) {
  return (
    <span style={{
      display:       'inline-flex',
      alignItems:    'center',
      gap:           '0.4rem',
      background:    'rgba(0,230,204,0.12)',
      border:        '1px solid rgba(0,230,204,0.25)',
      borderRadius:  '9999px',
      padding:       '0.3rem 0.85rem',
      fontSize:      '0.7rem',
      fontWeight:    700,
      color:         '#00E6CC',
      letterSpacing: '0.08em',
      textTransform: 'uppercase' as const,
    }}>
      {dot && (
        <span style={{
          width: '5px', height: '5px', borderRadius: '50%',
          background: '#00E6CC',
          boxShadow:  '0 0 5px rgba(0,230,204,0.8)',
          display:    'inline-block',
        }} />
      )}
      {label}
    </span>
  );
}
