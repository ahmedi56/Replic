import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Content Security Policy for pages. Next.js injects small inline scripts to hydrate, so
 * script-src needs 'unsafe-inline' (a nonce-based policy would make every page dynamic);
 * everything else is locked to this origin. API routes are excluded below: they return
 * JSON or user documents and set their own, stricter policy.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isProd ? '' : ' ws: wss:'}`,
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pin the tracing root to this project: a stray lockfile in a parent directory would
  // otherwise be picked as the workspace root.
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  // Native / Node-only packages stay out of the webpack bundle and are loaded by Node.
  serverExternalPackages: ['pg', '@electric-sql/pglite', '@aws-sdk/client-s3', 'bcryptjs'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
      {
        source: '/((?!api/).*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
