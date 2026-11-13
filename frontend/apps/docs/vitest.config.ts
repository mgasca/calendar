import { defineConfig } from 'vitest/config';

// Istanbul instruments only this package's own files. V8 coverage instruments everything that runs,
// micromark included, which made the real-corpus tests about four times slower (13 s to 57 s for
// docs-loader.test.ts locally) and kept the Docs site job near its run-time gate (#755).
export default defineConfig({
  test: { coverage: { provider: 'istanbul' } },
});
