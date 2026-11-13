import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { apiProxy, devSignInHostGuard } from './dev/apiProxy.ts';
import { OTLP_PROXY_KEY, otlpProxy } from './dev/otlpProxy.ts';

export default defineConfig({
  // The guard refuses --host and other non-loopback hosts under `just frontend dev-signed-in` (#242).
  plugins: [react(), devSignInHostGuard(process.env)],
  server: {
    proxy: {
      // Adds the API's seed key only under `just frontend dev-signed-in` (story 0021).
      '/api': apiProxy(process.env),
      // The browser's OpenTelemetry export, forwarded to the collector (ADR-0062, #732). `vite preview`
      // inherits `server.proxy`, so the built app in the E2E stack gets the same route.
      [OTLP_PROXY_KEY]: otlpProxy(process.env),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/test/**'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'web',
          include: ['src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/test/setup.ts'],
          css: false,
          // One jsdom per worker instead of one per file (benchmark 0005); the setup file resets the
          // module registry before each file, so app modules are still fresh per file.
          isolate: false,
        },
      },
      {
        // Dev-server code runs in Node, without the browser setup and MSW.
        test: { name: 'dev-server', include: ['dev/**/*.test.ts'], environment: 'node' },
      },
    ],
  },
});
