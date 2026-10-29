import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

const devPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' ws://localhost:* http://localhost:*",
  "img-src 'self' data:",
  "font-src 'self'",
].join('; ');

const productionPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'kataribe-content-security-policy',
    transformIndexHtml(html, context) {
      const policy = context.server ? devPolicy : productionPolicy;
      return html.replace('__CSP__', policy);
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [react(), contentSecurityPolicy()],
  },
});
