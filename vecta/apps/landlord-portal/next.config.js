/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV === 'development';

const nextConfig = {
  reactStrictMode: true,

  // Server-side env vars (never exposed to the browser)
  serverRuntimeConfig: {
    VECTA_INTERNAL_API_URL: process.env.VECTA_INTERNAL_API_URL ?? 'http://api-gateway:4000',
    VECTA_JWT_PUBLIC_KEY:   process.env.VECTA_JWT_PUBLIC_KEY ?? '',
  },

  // Public env vars (safe to expose to browser)
  publicRuntimeConfig: {
    APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  },

  // Security headers for landlord portal
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',        value: 'DENY' },
          { key: 'X-Content-Type-Options',  value: 'nosniff' },
          { key: 'Referrer-Policy',         value: 'strict-origin-when-cross-origin' },
          { key: 'X-XSS-Protection',        value: '1; mode=block' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Dev: React / Next need 'unsafe-eval' for Fast Refresh and stack reconstruction (not used in prod).
              `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https://vecta.io",
              "connect-src 'self'",
              "frame-src 'none'",
              "object-src 'none'",
            ].join('; '),
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
      // Verify routes — never indexed
      {
        source: '/verify/(.*)',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
        ],
      },
    ];
  },

  // No static export — all verify pages are SSR-only
  output: 'standalone',

  // Proxy browser /api/v1/* to Render (or any) gateway when API_GATEWAY_URL is set (e.g. Vercel + Render).
  async rewrites() {
    const gateway = process.env.API_GATEWAY_URL;
    if (!gateway?.trim()) return [];
    const base = gateway.replace(/\/$/, '');
    return [
      { source: '/api/v1/:path*', destination: `${base}/api/v1/:path*` },
    ];
  },

  images: {
    domains: [],   // No external image sources — selfies are served via signed S3 URLs
    dangerouslyAllowSVG: false,
  },

  // Bundle analysis
  ...(process.env.ANALYZE === 'true' && {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ...(require('@next/bundle-analyzer')({ enabled: true })),
  }),
};

module.exports = nextConfig;
