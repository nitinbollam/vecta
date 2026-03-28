/**
 * apps/student-app/src/constants/theme.ts
 *
 * Vecta Design System v2 — brand identity: #001F3F · #001A33 · #00E6CC
 * Financial Embassy & Life-as-a-Service
 */

// ---------------------------------------------------------------------------
// Colour tokens — exact palette from brand identity sheet
// ---------------------------------------------------------------------------

export const VectaColors = {
  // ── Core brand ─────────────────────────────────────
  primary:        '#001F3F',   // Deep navy — backgrounds, headers, primary text
  primaryMid:     '#001A33',   // Dark navy — card backs, footers
  primaryLight:   '#003060',   // Mid navy — hover states
  accent:         '#00E6CC',   // Teal — CTAs, badges, active indicators
  accentDim:      '#00B8A4',   // Muted teal — hover / pressed
  accentGlow:     'rgba(0,230,204,0.18)',

  // ── Semantic ────────────────────────────────────────
  success:        '#00C896',
  successBg:      '#E6FBF7',
  warning:        '#F59E0B',
  warningBg:      '#FFFBEB',
  error:          '#EF4444',
  errorBg:        '#FEF2F2',
  info:           '#00E6CC',
  infoBg:         'rgba(0,230,204,0.08)',

  // ── Neutrals ────────────────────────────────────────
  text:           '#001F3F',   // Primary text on light backgrounds
  textSecondary:  '#3D5A6B',   // Labels, captions
  textMuted:      '#7A9BAD',   // Placeholders, disabled
  border:         '#D6E4EC',   // Card borders, dividers
  borderDark:     '#B0C8D5',

  // ── Surfaces ────────────────────────────────────────
  surfaceBase:    '#FFFFFF',
  surface1:       '#F4F4F4',   // Screen backgrounds (brand "light")
  surface2:       '#EAEEF2',   // Input backgrounds
  surfaceDark:    '#001A33',   // Dark card backgrounds

  // ── Module-specific (keeping some contrast for tab sections) ─
  banking:        '#5B4AE8',   // Purple — Unit.co banking
  bankingBg:      '#F0EDFF',
  housing:        '#00C896',   // Teal-green (harmonises with brand teal)
  housingBg:      '#E6FBF7',
  mobility:       '#FF6B35',   // Orange — fleet earnings
  mobilityBg:     '#FFF2EE',
  connectivity:   '#00E6CC',   // Brand teal — eSIM
  connectivityBg: 'rgba(0,230,204,0.08)',
  insurance:      '#001F3F',
  insuranceBg:    '#F3EEFF',

  // ── Status badge colours ─────────────────────────────
  badgeVerified:  '#00C896',
  badgePending:   '#F59E0B',
  badgeRejected:  '#EF4444',
  badgeLocked:    '#7A9BAD',

  // ── Misc ─────────────────────────────────────────────
  black:          '#000D1A',
  white:          '#FFFFFF',
  backdrop:       'rgba(0,13,26,0.65)',
  // Legacy gradient aliases
  gradientStart:  '#001F3F',
  gradientEnd:    '#001A33',
  background:     '#F4F4F4',
  cardBg:         '#FFFFFF',
} as const;

export type VectaColor = keyof typeof VectaColors;

// ---------------------------------------------------------------------------
// Dark mode colour tokens
// ---------------------------------------------------------------------------

export const VectaDarkColors = {
  // Backgrounds
  background:      '#0A0F1E',
  surface1:        '#0F1628',
  surface2:        '#141D35',
  surfaceBase:     '#141D35',
  surfaceElevated: '#1A2540',

  // Brand
  primary:         '#001F3F',
  primaryMid:      '#001A33',
  primaryLight:    '#003060',
  accent:          '#00E6CC',
  accentDim:       '#00B8A4',
  accentGlow:      'rgba(0,230,204,0.18)',

  // Text
  text:            '#FFFFFF',
  textSecondary:   '#A8B8C8',
  textMuted:       '#5A7080',

  // Borders
  border:          '#1E2D45',
  borderLight:     '#243550',
  borderDark:      '#1A2540',

  // Status (same as light but darker bg)
  success:         '#00C896',
  successBg:       'rgba(0,200,150,0.15)',
  warning:         '#F59E0B',
  warningBg:       'rgba(245,158,11,0.15)',
  error:           '#EF4444',
  errorBg:         'rgba(239,68,68,0.15)',
  info:            '#00E6CC',
  infoBg:          'rgba(0,230,204,0.12)',

  // Status badges
  badgeVerified:   '#00C896',
  badgePending:    '#F59E0B',
  badgeRejected:   '#EF4444',
  badgeLocked:     '#5A7080',

  // Gradients (same as light — already dark)
  gradientStart:   '#0F1628',
  gradientEnd:     '#0A0F1E',
  cardBg:          '#141D35',

  // Module colours (same hue, darker bg versions)
  banking:         '#5B4AE8',
  bankingBg:       'rgba(91,74,232,0.2)',
  housing:         '#00C896',
  housingBg:       'rgba(0,200,150,0.15)',
  mobility:        '#FF6B35',
  mobilityBg:      'rgba(255,107,53,0.15)',
  connectivity:    '#00E6CC',
  connectivityBg:  'rgba(0,230,204,0.12)',
  insurance:       '#001F3F',
  insuranceBg:     'rgba(91,74,232,0.12)',

  // Misc
  black:           '#000D1A',
  white:           '#FFFFFF',
  backdrop:        'rgba(0,0,0,0.75)',
  background_rn:   '#0A0F1E',
} as const;

// ---------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------

export const VectaGradients = {
  hero:      ['#001F3F', '#003060', '#001A33'] as const,
  teal:      ['#00E6CC', '#00B8A4'] as const,
  banking:   ['#001F3F', '#1E0A6B', '#2B1EA8'] as const,   // navy → purple
  housing:   ['#001F3F', '#003D35', '#001A33'] as const,
  mobility:  ['#001F3F', '#3D1500', '#001A33'] as const,
  dark:      ['#001A33', '#001225'] as const,
  card:      ['#001A33', '#002244'] as const,
} as const;

// ---------------------------------------------------------------------------
// Typography — DM Sans (body) + Bebas Neue (display)
// ---------------------------------------------------------------------------

export const VectaFonts = {
  // React Native font families (loaded via expo-font)
  display:    'BebasNeue_400Regular',   // for wordmark, hero headings
  regular:    'DMSans_400Regular',
  medium:     'DMSans_500Medium',
  semiBold:   'DMSans_600SemiBold',
  bold:       'DMSans_700Bold',
  extraBold:  'DMSans_800ExtraBold',
  mono:       'JetBrainsMono_400Regular',

  // Size scale (1.25 modular)
  '2xs':  10,
  xs:     11,
  sm:     13,
  md:     15,   // base
  lg:     17,
  xl:     20,
  '2xl':  24,
  '3xl':  30,
  '4xl':  36,
  '5xl':  48,

  // Letter spacing
  letterSpacing: {
    tight:   -0.02,
    normal:   0,
    wide:     0.03,
    wider:    0.08,
    widest:   0.18,   // tagline
    display:  0.06,   // Bebas Neue headings
  },
} as const;

// ---------------------------------------------------------------------------
// Spacing (4-pt grid)
// ---------------------------------------------------------------------------

export const VectaSpacing = {
  '0.5': 2,
  '1':   4,
  '1.5': 6,
  '2':   8,
  '2.5': 10,
  '3':   12,
  '3.5': 14,
  '4':   16,
  '5':   20,
  '6':   24,
  '7':   28,
  '8':   32,
  '9':   36,
  '10':  40,
  '12':  48,
  '14':  56,
  '16':  64,
} as const;

// ---------------------------------------------------------------------------
// Border radii
// ---------------------------------------------------------------------------

export const VectaRadius = {
  none:  0,
  sm:    6,
  md:    10,
  lg:    14,
  xl:    18,
  '2xl': 24,
  '3xl': 32,
  full:  9999,
} as const;

// ---------------------------------------------------------------------------
// Shadows
// ---------------------------------------------------------------------------

export const VectaShadows = {
  sm: {
    shadowColor:   '#001F3F',
    shadowOffset:  { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius:  6,
    elevation:     2,
  },
  md: {
    shadowColor:   '#001F3F',
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius:  12,
    elevation:     4,
  },
  lg: {
    shadowColor:   '#001F3F',
    shadowOffset:  { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius:  24,
    elevation:     8,
  },
  teal: {
    shadowColor:   '#00E6CC',
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius:  20,
    elevation:     6,
  },
} as const;
