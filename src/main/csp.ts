const REUSE_CONNECT_SOURCES = 'kataribe-temp: kataribe-model:';

/**
 * Renderer の CSP を組み立てる。開発時だけ Vite のサーバーへの接続を許可する。
 */
export function contentSecurityPolicy(dev: boolean): string {
  const connectSources = dev
    ? `'self' ws://localhost:* http://localhost:* ${REUSE_CONNECT_SOURCES}`
    : `'self' ${REUSE_CONNECT_SOURCES}`;
  return [
    "default-src 'self'",
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connectSources}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "media-src 'self' kataribe-audio:",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
}
