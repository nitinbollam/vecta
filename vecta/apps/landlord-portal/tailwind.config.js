/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        vecta: {
          /* Brand identity palette */
          'navy-deep':  '#001F3F',
          'navy':       '#001A33',
          'teal':       '#00E6CC',
          'teal-dim':   '#00B8A4',
          'light':      '#F4F4F4',
          /* Semantic */
          'success':    '#00C896',
          'warning':    '#F59E0B',
          'error':      '#EF4444',
          /* Text */
          'text':       '#001F3F',
          'text-sec':   '#3D5A6B',
          'text-muted': '#7A9BAD',
          /* Surfaces */
          'border':     '#D6E4EC',
          'surface':    '#FFFFFF',
          'glass':      'rgba(0,31,63,0.45)',
        },
      },
      fontFamily: {
        display: ['"Bebas Neue"', '"Impact"', '"Arial Narrow"', 'sans-serif'],
        sans:    ['"DM Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono:    ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      backgroundImage: {
        'vecta-hero':      'linear-gradient(135deg, #001F3F 0%, #003060 50%, #001A33 100%)',
        'vecta-card-dark': 'linear-gradient(135deg, #001A33 0%, #002244 100%)',
        'teal-glow':       'radial-gradient(ellipse at center, rgba(0,230,204,0.2) 0%, transparent 70%)',
      },
      boxShadow: {
        'vecta':     '0 4px 24px -4px rgba(0,31,63,0.16)',
        'vecta-lg':  '0 16px 48px -8px rgba(0,31,63,0.28)',
        'teal':      '0 0 32px -4px rgba(0,230,204,0.25)',
        'teal-lg':   '0 0 48px -4px rgba(0,230,204,0.35)',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      letterSpacing: {
        display: '0.08em',
        tagline: '0.18em',
        wide2:   '0.12em',
      },
      animation: {
        'fade-up':    'fade-up 0.5s ease forwards',
        'teal-pulse': 'teal-pulse 2s ease-in-out infinite',
        'shimmer':    'shimmer 2.5s linear infinite',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'teal-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(0,230,204,0.4)' },
          '50%':       { boxShadow: '0 0 0 8px rgba(0,230,204,0)' },
        },
        'shimmer': {
          '0%':   { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition: '200% center' },
        },
      },
    },
  },
  plugins: [],
};

module.exports = config;
