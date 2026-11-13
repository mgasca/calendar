import { defineConfig } from 'vitest/config';

// The browser-free tests: the flow binding check and the telemetry helpers' unit tests. They run in
// `just frontend test`, so on every pull request (ADR-0061). The flow tests themselves are Playwright's.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // The binding test lists the suite with `playwright test --list`, which takes a few seconds.
    testTimeout: 60_000,
  },
});
