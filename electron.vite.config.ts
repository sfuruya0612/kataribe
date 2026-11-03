import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { contentSecurityPolicy } from './src/main/csp';

function contentSecurityPolicyPlugin(): Plugin {
  return {
    name: 'kataribe-content-security-policy',
    transformIndexHtml(html, context) {
      return html.replace(
        '__CSP__',
        contentSecurityPolicy(context.server !== undefined),
      );
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
    plugins: [react(), contentSecurityPolicyPlugin()],
  },
});
