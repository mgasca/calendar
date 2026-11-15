---
status: implemented
date: 2026-11-15
issue: https://github.com/mgasca/calendar/issues/795
pr:
  - https://github.com/mgasca/calendar/pull/954
adrs: ["0008"]
---

# 0067 A stalled web-test wait reports its own failure

## Story

> As a maintainer, I need a web test whose `findBy` or `waitFor` never passes to fail with that wait's own message, line and DOM, so that I can see which wait stalled from the CI log, without rerunning the test locally to find it.

Tracked in issue #795.

## Background

`frontend/apps/web/src/test/setup.ts` sets Testing Library's `asyncUtilTimeout` to 5,000 ms. That is also Vitest's default test timeout, and the web project does not set its own. The test timer starts first, so it always fires first. A `findBy*` or `waitFor` that never passes is reported only as `Error: Test timed out in 5000ms` at the test's `it(...)` line. The report has no failing assertion, no line for the stalled wait and no DOM.

The 5 s value was chosen in story [0002](0002-week-view.md), because Testing Library's default of 1 s was too tight for a file's first render while `just check` runs the backend build and every test file in parallel. Nobody compared it with the test timeout at the time.

Flaky test #698 shows the cost. Its CI failures said only that the move-to-tomorrow test ran for 5,003 ms. The cause was focus chosen on a frame before React had rendered the refetched list (story [0044](0044-edit-a-task-from-the-today-view.md), fixed in #788). Finding it needed a local probe that shortened one wait by hand. The change was agreed on #788 as a separate piece of work: the maintainer took the recommendation in [question 2](https://github.com/mgasca/calendar/pull/788#issuecomment-6861709149). On #795 the maintainer chose to record it on its own card.

The repo's test helper `eventually` (`src/test/render.tsx`) polls with Vitest's `vi.waitFor` and also defaults to 5,000 ms, so it has the same flaw.

### Agreed scope

* **A wait times out before its test does**: the web project's wait timeout (`asyncUtilTimeout`, and the default of `eventually`) is set clearly below its test timeout. A stalled wait then fails with Testing Library's or Vitest's own error: the assertion, the line of the wait and, for Testing Library queries, the printed DOM.
* **The value is measured, not guessed**: before the value is chosen, measure how long the first `findBy` of each test file's first test takes, under two kinds of load. One is `just check` (the backend build plus every test file in parallel). The other is the CI command `pnpm -r --filter '!@calendar/docs' --filter '!@calendar/slides' test:coverage`. Use enough runs to give a p95 and a maximum for each.
* **Margin over the slowest first render**: the chosen wait timeout leaves a margin over that maximum and stays under the test timeout. If no value fits, raise the web project's test timeout in `vite.config.ts`, with a comment saying why, rather than cut the margin.
* **One source for the value**: the wait timeout is defined once and used by both `setup.ts` and `eventually`, with a comment linking it to the test timeout, so the two cannot drift back to equal values.
* **The evidence is recorded**: the measurements go on issue #795 and in this card's implementation notes, each marked measured or inferred.

### Not in this story

* **Making tests faster**: the suite's run time and its worker layout (benchmark [0005](../benchmarks/0005-web-test-suite.md)) are unchanged. This story changes only which timer fires first.
* **Other packages**: the docs site, the slides and the `dev-server` Vitest project have no Testing Library waits of this kind and keep their defaults.
* **Fixing slow or flaky tests**: a test that the new limit turns red is a finding for its own issue, not something to work around by raising the limit for that test.
* **`settle`**: it waits on `vi.waitFor` with Vitest's 1 s default, which is already well below the test timeout and reports its own failure.
* **End-to-end tests**: Playwright ([ADR-0061](../decisions/0061-end-to-end-ui-tests-with-playwright-test-bound-to-the-architecture-flows.md)) has its own timeouts.

### Acceptance criteria

1. **Given** a web test whose `findBy*` query never matches, **when** the suite runs, **then** the test fails with Testing Library's "Unable to find" error, which names the wait's line and prints the DOM, and not with `Test timed out`. Tested in [timeouts.test.tsx](../../frontend/apps/web/src/test/timeouts.test.tsx): `report a stalled findBy with its query, its line and the DOM` checks the message, the DOM print and the stack's file, with a short explicit timeout. `time out a findBy or waitFor before the test does` checks that the default fires before the test timer. With the default timeout and a real stall, this was checked by hand: details under "Lessons learned".
2. **Given** a web test whose `waitFor` or `eventually` assertion never passes, **when** the suite runs, **then** the test fails with that assertion's error and the line of the wait, and not with `Test timed out`. Tested in [timeouts.test.tsx](../../frontend/apps/web/src/test/timeouts.test.tsx): `report a stalled eventually with its assertion and its line`, and `time out an eventually before the test does`, which checks the default limit that `eventually` passes to `vi.waitFor`. `waitFor` shares `asyncUtilTimeout` with `findBy*`, which criterion 1's guard covers.
3. **Given** the web Vitest configuration, **when** a test reads the wait timeout and the test timeout, **then** the wait timeout is lower by at least the chosen margin. A change that makes them equal again fails this test. Tested by the two `time out … before the test does` tests, which compare the wait timeout with the running test's own `task.timeout`. With the old value of 5,000 ms, both fail with `expected 5000 to be less than or equal to 4000`.
4. **Given** the measurements of the first `findBy` under `just check` and under the CI command, **when** the value is chosen, **then** the card and issue #795 record the runs, p95 and maximum for each, marked measured, and the wait timeout is above that maximum with a margin. Recorded under "Measurements" below and on #795.
5. **Given** the change is complete, **when** I run `just check`, **then** it passes, and the CI `Frontend` job passes on the delivery PR. Local `just check` and CI results are reported on the delivery PR.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0008](../decisions/0008-frontend-testing-stack.md) | Vitest, Testing Library and MSW for frontend tests | The two timers belong to these tools; the story tunes them and adds no new tool |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **4,000 ms wait, 5,000 ms test** (proposed in question 2 on #954): the wait timeout is at least 1.5 times the slowest measured wait (2.6 times the 1,517 ms maximum), and 1 s below the test timeout, so Testing Library has time to print the DOM. The test timeout stays at Vitest's default, because the value fits without raising it. It is now stated in `vite.config.ts`, because the wait timeout depends on it.
* **The guard reads the running test's timeout**: the configuration test compares the wait timeout with `task.timeout`, the limit Vitest actually applies, rather than with a second copy of 5,000. Raising or lowering `testTimeout` without the wait timeout therefore fails the guard.
* **Measure every wait, report the first**: the probe timed every wait, not only the first. Under both commands, the slowest wait in every run was a file's first wait, as expected: a first render pays for module loading and jsdom warm-up.
* **Include `eventually`** (proposed in question 1 on #954): it was written to behave like `waitFor` on Vitest's timers, and its 5,000 ms default had the same flaw.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| The wait timeout and the margin (`WAIT_TIMEOUT_MS`, `WAIT_TIMEOUT_MARGIN_MS`) | `frontend/apps/web/src/test/timeouts.ts` |
| Testing Library configuration (`asyncUtilTimeout`) | `frontend/apps/web/src/test/setup.ts` |
| `eventually` helper (its default `timeout`) | `frontend/apps/web/src/test/render.tsx` |
| Web Vitest project (`testTimeout`, now stated) | `frontend/apps/web/vite.config.ts`, project `web` |
| Tests | `frontend/apps/web/src/test/timeouts.test.tsx` |
| Guidance for contributors | `frontend/AGENTS.md`, "Running checks" |

### API

No changes.

### Testing

* Four tests in `timeouts.test.tsx`, all fast (under 0.1 s each). The two guard tests check that the defaults are below the running test's timeout. The two shape tests use a 50 ms timeout to check what a stalled `findBy` and a stalled `eventually` report.
* Negative control: with `WAIT_TIMEOUT_MS` set back to 5,000, both guard tests fail. A throwaway test with a real stalled `findBy` at the default timeout then reports only `Test timed out in 5000ms` at its `it(...)` line.
* An earlier version tested `eventually` by letting it run out on fake timers. It took 4 s, because `vi.waitFor` measures its timeout on real timers. The test now spies on `vi.waitFor` and checks the limit it receives.

### Measurements

All measured on 2026-11-15 with a probe that was not committed: Testing Library's `asyncWrapper` and `eventually`, wrapped to log the duration of every wait with its file and test. The machine was a 16-core WSL2 Linux host, at the story's base revision (`main` at 490542c2e, with the card). Every run passed, except the stress runs noted below.

| Load | Runs | Files with a wait, per run | First wait per file: p50 / p95 / max | Any wait: p99 / max |
| --- | --- | --- | --- | --- |
| CI command, `pnpm -r --filter '!@calendar/docs' --filter '!@calendar/slides' test:coverage` | 20 | 17 | 238 / 570 / 1,018 ms | 308 / 1,018 ms |
| `just frontend test` (the frontend step of `just check`) | 20 | 17 | 308 / 900 / 1,517 ms | 378 / 1,517 ms |
| Stress: `just frontend test` 20 s into a cold `cargo build --workspace --all-targets` | 10 | 17 | 600 / 1,891 / 3,791 ms | 785 / 5,026 ms |

* **CI on GitHub** (measured from logs, as an upper bound): across the `Frontend` jobs of 20 recent successful CI runs on `main`, the slowest web test took 518 ms in total, so no single wait took longer. Vitest prints only the tests slower than 300 ms, which is enough for an upper bound.
* **After the change** (measured): 10 more runs of the CI command on the 4,000 ms value, and all 10 passed (526 web tests each). `just check` passed once on the delivery commit, in 368 s.

### Lessons learned, known issues and follow-ups

* **`just check` no longer runs the web tests beside the backend build.** The old comment in `setup.ts` said it did. Today `check` runs `lint` and then `test`, and `test` runs the backend tests before the frontend tests (both are plain dependencies, not `[parallel]`). The three `just check` runs made with the probe stopped at ESLint, which rejected the probe itself. So the `just check` load was measured on the step it runs, `just frontend test`.
* **Under a cold backend build, the test timeout, not the wait, is the limit.** In 1 of the 10 stress runs, three web tests failed, two with `Test timed out in 5000ms`. No wait in them reached 5 s: the test as a whole ran out of time. Only one wait in all the stress runs went past 4,000 ms, and it timed out at 5,000 ms in that same failing run. So the new value turns no passing stress run red. Making the suite robust to a parallel cold build is not part of this story (see "Not in this story"); it is proposed as a follow-up on #795.
* **A stalled wait, checked by hand** with a throwaway test (`render(<p>waiting</p>)`, then `await screen.findByText('done')` with the default timeout):
  * Old configuration: `Error: Test timed out in 5000ms.`, pointing at the `it(...)` line.
  * New configuration: after 4,030 ms, `TestingLibraryElementError: Unable to find an element with the text: done …`, followed by the printed `<body>` with the `<p>` and the wait's own line, `zz-stalled.test.tsx:5:16`.

## User guide

### When a web test fails on a wait

* A wait that never passes now fails on its own line. The message is the query that found nothing (for example "Unable to find an element with the text: …") or the assertion that never held, followed by the page as the test saw it. Start from that line, not from the test's name.
* `Test timed out` now means that the test spent its time somewhere other than one wait, for example in many waits in a row or in a step that never yields. Look at what the test does between its waits.
