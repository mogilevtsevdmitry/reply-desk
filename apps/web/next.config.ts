import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * NEXT_PUBLIC_API_URL фиксируется на этапе `next build` (BUG-003):
 * в Docker передаётся как build-arg (docker/web.Dockerfile), при смене URL API
 * образ web нужно пересобрать — см. docs/devops/DEPLOY.md.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const apiOrigin = new URL(API_URL).origin;
const isDev = process.env.NODE_ENV !== 'production';

/**
 * CSP на веб-фронтенде (AUDIT-001, ADR-029). Решение: заголовки в next.config,
 * а не на Traefik — политика версионируется вместе с кодом и действует в любом
 * окружении (dev/compose/Dokploy), а не только за прокси.
 * - script-src 'unsafe-inline' обязателен для inline-скриптов App Router (без nonce-мидлвари в MVP);
 *   'unsafe-eval' — только в dev (React Refresh).
 * - Google Fonts (ADR-006): style-src fonts.googleapis.com, font-src fonts.gstatic.com.
 * - connect-src ограничен origin'ом API (SSE/fetch).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data:",
  "font-src 'self' https://fonts.gstatic.com",
  `connect-src 'self' ${apiOrigin}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Минимальный самодостаточный сервер для Docker (docker/web.Dockerfile, 05-DEVOPS)
  output: 'standalone',
  // Монорепо: трассировка файлов от корня, чтобы standalone собрал workspace-зависимости
  outputFileTracingRoot: path.join(__dirname, '../..'),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
};

export default nextConfig;
