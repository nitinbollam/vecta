/**
 * app/layout.tsx — Landlord Portal root layout
 * Brand: Vecta — Financial Embassy & Life-as-a-Service
 * Colors: #001F3F · #001A33 · #00E6CC
 */

import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    template: '%s — Vecta',
    default:  'Vecta — Financial Embassy & Life-as-a-Service',
  },
  description:
    'Verify international F-1 student applicants. NFC-verified identity, financial guarantee, cryptographic trust certificate. No SSN required.',
  robots: { index: false, follow: false },
  icons: {
    icon:  '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    siteName:    'Vecta',
    type:        'website',
    locale:      'en_US',
  },
};

export const viewport: Viewport = {
  width:        'device-width',
  initialScale: 1,
  themeColor:   '#001F3F',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body style={{
        fontFamily: '"DM Sans", system-ui, -apple-system, sans-serif',
        background: '#F4F4F4',
        color:      '#001F3F',
      }}>
        <a href="#main-content" className="skip-link">Skip to content</a>
        <div id="main-content">
          {children}
        </div>
      </body>
    </html>
  );
}
