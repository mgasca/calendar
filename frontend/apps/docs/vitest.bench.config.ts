import { defineConfig } from 'vitest/config';

// Benchmarks are run by hand (`make bench-docs`), never by `make test` or CI: timings are only
// comparable on one machine. See docs/benchmarks/README.md.
export default defineConfig({
  test: { include: ['benchmarks/**/*.bench.ts'], testTimeout: 600_000 },
});
