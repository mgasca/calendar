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
