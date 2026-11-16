import { vi } from 'vitest';

/**
 * How long one wait may take: Testing Library's `findBy*` and `waitFor` (configured in setup.ts)
 * and `eventually` (render.tsx).
 *
 * It must stay well below the test timeout (`testTimeout` of the `web` project in vite.config.ts),
 * or the test timer fires first and a stalled wait is reported only as "Test timed out", with no
 * assertion, no line and no DOM (#795). timeouts.test.ts keeps at least `WAIT_TIMEOUT_MARGIN_MS`
 * between them.
 *
 * The value is measured (story 0067). The slowest first wait of a file was 1.5 s under
 * `just frontend test`, as `just check` runs it, and 1.0 s under the CI command, over 20 local runs
 * each. No web test in 20 CI runs took more than 0.5 s. The default of 1 s was too tight for that.
 */
export const WAIT_TIMEOUT_MS = 4000;

/** The least time between a wait timing out and its test timing out. */
export const WAIT_TIMEOUT_MARGIN_MS = 1000;

/**
 * The test timeout of a file whose first rendering test is slow, set by `allowSlowFirstRender`.
 *
 * The first test of a file that renders a dialog pays a warm-up the later ones don't: run alone, a
 * test took 445 ms when first and 160 ms when second. The cost is spread over several waits, so no
 * wait times out, but the test can still pass 5 s beside a cold backend build (#957). There, over
 * 20 runs of the whole suite, the first test of `EditEvent`, `EditTaskFromDay` and `EditTask` took
 * up to 4.1 s (p95 2.7 to 3.7 s), and 5.5 s in the run that failed; no other test passed 3 s.
 * Waits still time out at `WAIT_TIMEOUT_MS`, so a stalled wait reports itself as before.
 */
export const SLOW_FIRST_RENDER_TEST_TIMEOUT_MS = 10_000;

/**
 * Gives every test in the calling file `SLOW_FIRST_RENDER_TEST_TIMEOUT_MS`. Call it at the top of
 * the file, not in one test, because whichever test renders first pays the warm-up. Vitest resets
 * the setting after the file.
 */
export function allowSlowFirstRender() {
  vi.setConfig({ testTimeout: SLOW_FIRST_RENDER_TEST_TIMEOUT_MS });
}
