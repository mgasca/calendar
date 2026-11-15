---
status: planned
date: 2026-11-15
issue: https://github.com/mgasca/calendar/issues/795
pr: []
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

1. **Given** a web test whose `findBy*` query never matches, **when** the suite runs, **then** the test fails with Testing Library's "Unable to find" error, which names the wait's line and prints the DOM, and not with `Test timed out`.
2. **Given** a web test whose `waitFor` or `eventually` assertion never passes, **when** the suite runs, **then** the test fails with that assertion's error and the line of the wait, and not with `Test timed out`.
3. **Given** the web Vitest configuration, **when** a test reads the wait timeout and the test timeout, **then** the wait timeout is lower by at least the chosen margin. A change that makes them equal again fails this test.
4. **Given** the measurements of the first `findBy` under `just check` and under the CI command, **when** the value is chosen, **then** the card and issue #795 record the runs, p95 and maximum for each, marked measured, and the wait timeout is above that maximum with a margin.
5. **Given** the change is complete, **when** I run `just check`, **then** it passes, and the CI `Frontend` job passes on the delivery PR.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0008](../decisions/0008-frontend-testing-stack.md) | Vitest, Testing Library and MSW for frontend tests | The two timers belong to these tools; the story tunes them and adds no new tool |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **A margin, not a split by default** (proposed): the issue's example, a 4,000 ms wait against a 5,000 ms test, is a starting point only. The measurements decide the value, and a lower test timeout is never the fix.
* **Measure the first `findBy` only**: a file's first render pays for module loading and jsdom warm-up under load, which is why 1 s was too tight. Later waits in the same file are faster, so the first one bounds the rest.
* **Include `eventually`** (proposed): it was written to behave like `waitFor` on Vitest's timers, and its 5,000 ms default has the same flaw. Leaving it out would keep half of the waits reporting only the test timeout.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| Testing Library configuration | `frontend/apps/web/src/test/setup.ts` |
| `eventually` helper | `frontend/apps/web/src/test/render.tsx` |
| Web Vitest project (test timeout) | `frontend/apps/web/vite.config.ts`, project `web` |
| CI command | `.github/workflows/ci.yml`, job `Frontend` |

### API

No changes.

### Testing

* A test that a stalled `findBy` reports "Unable to find" with the DOM. Shown to fail with `Test timed out` on today's configuration.
* A test that a stalled `eventually` reports its assertion. Shown to fail with `Test timed out` on today's configuration.
* A configuration test that the wait timeout stays below the test timeout by the margin.
* A measurement of the first `findBy` per file, repeated under `just check` and under the CI command. The method and raw numbers go on the issue, so the measurement can be repeated.

### Lessons learned, known issues and follow-ups

* To be filled on delivery.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### When a web test fails on a wait

* A wait that never passes now fails on its own line. The message is the query that found nothing (for example "Unable to find an element with the text: …") or the assertion that never held, followed by the page as the test saw it. Start from that line, not from the test's name.
* `Test timed out` now means that the test spent its time somewhere other than one wait, for example in many waits in a row or in a step that never yields. Look at what the test does between its waits.
