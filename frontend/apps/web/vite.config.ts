import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { apiProxy, devSignInHostGuard } from './dev/apiProxy.ts';

export default defineConfig({
  // The guard refuses --host and other non-loopback hosts under `just frontend dev-signed-in` (#242).
  plugins: [react(), devSignInHostGuard(process.env)],
  server: {
    proxy: {
      // Adds the API's seed key only under `just frontend dev-signed-in` (story 0021).
      '/api': apiProxy(process.env),
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
        },
      },
      {
        // Dev-server code runs in Node, without the browser setup and MSW.
        test: { name: 'dev-server', include: ['dev/**/*.test.ts'], environment: 'node' },
      },
    ],
  },
});
