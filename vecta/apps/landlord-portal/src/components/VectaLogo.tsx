/**
 * apps/landlord-portal/src/components/VectaLogo.tsx
 *
 * Vecta brand logo — extracted from brand identity sheet.
 * Colors: #001F3F (deep navy) · #001A33 (dark navy) · #00E6CC (teal)
 * Mark: geometric V-shield with keyhole + upward arrow
 */

import type { CSSProperties } from 'react';

interface VectaLogoProps {
  variant?: 'full' | 'mark-only' | 'wordmark-only';
  theme?:   'dark-bg' | 'light-bg' | 'mono-white' | 'mono-dark';
  height?:  number;
  className?: string;
  style?: CSSProperties;
}

/** The geometric V-shield mark — keyhole + upward arrow */
function VectaMark({ theme = 'dark-bg' }: { theme?: VectaLogoProps['theme'] }) {
  const teal = theme === 'mono-white' ? '#FFFFFF' : theme === 'mono-dark' ? '#001F3F' : '#00E6CC';
  const navy = theme === 'mono-white' ? 'rgba(255,255,255,0.5)' : theme === 'mono-dark' ? '#001A33' : '#001A33';
  const mid  = theme === 'mono-white' ? 'rgba(255,255,255,0.7)' : '#0A3A5C';

  return (
    <svg viewBox="0 0 120 130" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="vmark-grad-teal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor={teal} stopOpacity="1" />
          <stop offset="100%" stopColor="#009E8F" stopOpacity="1" />
        </linearGradient>
        <linearGradient id="vmark-grad-navy" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor={navy} stopOpacity="1" />
          <stop offset="100%" stopColor="#001225" stopOpacity="1" />
        </linearGradient>
        <linearGradient id="vmark-grad-mid" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%"   stopColor={mid} stopOpacity="1" />
          <stop offset="100%" stopColor="#0D4A6E" stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* ── Outer V-shield frame ── */}
      {/* Left wing — dark navy facets */}
      <polygon points="0,0 58,0 30,65"    fill="url(#vmark-grad-navy)"  />
      <polygon points="0,0 30,65 0,90"    fill={navy}                   opacity="0.85" />
      <polygon points="30,65 0,90 18,115 60,130" fill={navy}           opacity="0.7"  />

      {/* Right wing — navy facets */}
      <polygon points="62,0 120,0 90,65"  fill="url(#vmark-grad-navy)"  />
      <polygon points="120,0 90,65 120,90" fill={navy}                  opacity="0.85" />
      <polygon points="90,65 120,90 102,115 60,130" fill={navy}         opacity="0.7"  />

      {/* ── V-notch centre ── */}
      <polygon points="30,10 90,10 60,72" fill="url(#vmark-grad-mid)"   />

      {/* ── Teal geometric accent facets (top-right region) ── */}
      <polygon points="72,0 120,0 100,28" fill="url(#vmark-grad-teal)"  />
      <polygon points="100,28 120,0 120,55" fill={teal}                 opacity="0.75" />
      <polygon points="80,0 100,28 90,10" fill={teal}                   opacity="0.55" />

      {/* ── Keyhole mark (centre of shield) ── */}
      <circle cx="60" cy="55" r="10" fill="rgba(255,255,255,0.15)" />
      <circle cx="60" cy="55" r="6"  fill={teal}                   />
      <rect   x="56"  y="59" width="8" height="11" rx="2"
              fill={teal} />

      {/* ── Upward-right arrow (top-right breakout) ── */}
      <g transform="translate(76, 2)">
        {/* Arrow shaft */}
        <line x1="0" y1="28" x2="24" y2="4"
              stroke={teal} strokeWidth="4" strokeLinecap="round" />
        {/* Arrowhead */}
        <polygon points="24,4 12,4 24,16" fill={teal} />
      </g>
    </svg>
  );
}

/** Full brand mark with wordmark */
export function VectaLogo({
  variant   = 'full',
  theme     = 'dark-bg',
  height    = 40,
  className = '',
  style,
}: VectaLogoProps) {
  const wordmarkColor = theme === 'light-bg' ? '#001F3F' : '#FFFFFF';
  const taglineColor  = theme === 'light-bg' ? '#4A7A8A' : 'rgba(255,255,255,0.55)';
  const markH = height;
  const wordmarkH = height;

  if (variant === 'mark-only') {
    return (
      <div className={className} style={{ height: markH, width: markH * 0.92, ...style }}>
        <VectaMark theme={theme} />
      </div>
    );
  }

  if (variant === 'wordmark-only') {
    return (
      <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 2, ...style }}>
        <span style={{
          fontFamily:    '"Bebas Neue", "Impact", "Arial Narrow", sans-serif',
          fontSize:      wordmarkH,
          fontWeight:    900,
          letterSpacing: '0.08em',
          color:         wordmarkColor,
          lineHeight:    1,
        }}>
          VECTA
        </span>
        <span style={{
          fontSize:      wordmarkH * 0.22,
          letterSpacing: '0.18em',
          color:         taglineColor,
          lineHeight:    1,
          textTransform: 'uppercase' as const,
          fontWeight:    400,
        }}>
          Financial Embassy &amp; Life-as-a-Service
        </span>
      </div>
    );
  }

  // Full: mark + wordmark side-by-side
  return (
    <div className={className}
      style={{ display: 'flex', alignItems: 'center', gap: markH * 0.35, ...style }}>
      <div style={{ height: markH, width: markH * 0.92, flexShrink: 0 }}>
        <VectaMark theme={theme} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{
          fontFamily:    '"Bebas Neue", "Impact", "Arial Narrow", sans-serif',
          fontSize:      wordmarkH * 0.85,
          fontWeight:    900,
          letterSpacing: '0.08em',
          color:         wordmarkColor,
          lineHeight:    1,
        }}>
          VECTA
        </span>
        <span style={{
          fontSize:      wordmarkH * 0.19,
          letterSpacing: '0.15em',
          color:         taglineColor,
          lineHeight:    1,
          textTransform: 'uppercase' as const,
        }}>
          Financial Embassy &amp; Life-as-a-Service
        </span>
      </div>
    </div>
  );
}

/** Compact icon variant for favicons, app icons */
export function VectaIcon({ size = 32, theme = 'dark-bg' }: {
  size?: number; theme?: VectaLogoProps['theme'];
}) {
  return (
    <div style={{
      width:           size,
      height:          size,
      borderRadius:    size * 0.2,
      background:      theme === 'light-bg' ? '#F4F4F4' : '#001F3F',
      display:         'flex',
      alignItems:      'center',
      justifyContent:  'center',
      padding:         size * 0.1,
      overflow:        'hidden',
    }}>
      <VectaMark theme={theme === 'light-bg' ? 'dark-bg' : theme} />
    </div>
  );
}
