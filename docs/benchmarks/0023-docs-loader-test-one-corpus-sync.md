---
subject: "Docs site test:coverage: the docs-loader tests share one sync of the real corpus instead of two, with a guard on the corpus reads of the test file (issue #752)"
harness: "frontend/apps/docs/src/lib/docs-loader.test.ts"
---

# 0023 Docs loader tests: one corpus sync

- **Date:** 2026-11-13
- **Issue:** [#752](https://github.com/mgasca/calendar/issues/752), proposal D of [#755](https://github.com/mgasca/calendar/issues/755). Gate: [ADR-0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md), baseline record [0017](0017-ci-baseline-with-changes.md), earlier trend record [0021](0021-docs-site-trend-runner-mix.md).
- **Harness:** `vitest run src --coverage --reporter=json` in `frontend/apps/docs` (the Docs site job's `test:coverage`, which uses Istanbul since #757). The per-file times come from the JSON report, which gives each file's `startTime` and `endTime`.
- **Before:** `origin/main` at `132e31be4`, which includes #756, #757 and #758. **After:** the same commit with this change to `src/lib/docs-loader.test.ts`.
- **Machine:** WSL2 (kernel 6.18), 16 cores, Node 24.22.2, Vitest 5.1.0. Six runs, alternating before and after (A, B, A, B, A, B), with each version in its own worktree. All 333 tests passed in every run.

## Question

The Docs site job started failing the run-time gate on unrelated pull requests after 2026-11-13 12:12Z. Which merge moved it, and what does the fix for that step save?

## CI history (measured)

These numbers are on #752. The jobs API was read for every successful Docs site job on the publication path in `ci.yml` runs from 2026-11-10 16:24Z to 2026-11-13 14:48Z. The runs are split at the merge of #718.

| Docs site, publication path | runs | job median | `test:coverage` | subpath verify (control) | narrative decks |
| --- | --: | --: | --: | --: | --: |
| before #718 | 101 | 2:09 | 24 s | 23 s | – |
| after #720 | 34 | 2:32 | 36 s | 23 s | 6 s |

- **The control did not move.** The subpath build and verify step stayed at 23 s, so a change in runner mix does not explain the jump.
- **`test:coverage` grew** with the first runs that contain #718.
- **#720's deck step adds about 6 s.** That cost is intended (ADR-0060).

## Mechanism (counted)

Every read of the real corpus starts with one listing of `docs/decisions` and then parses every document under `docs/`.

| Version of `docs-loader.test.ts` | Corpus reads per run of the file |
| --- | --: |
| before #718 | 3: one full sync, plus the two route-map computations of the counting test |
| after #718 | 4: #718's narratives test ran a second full `docsLoader().load()` |
| this change | 3: one sync, shared through `syncCorpus()` |

The test file now counts its corpus reads in a hoisted counter that is never cleared. An `afterAll` fails the file when there are more than three.

**Negative control:** I put the narratives test's own `docsLoader().load()` back in a scratch worktree. The file then fails with `expected 4 to be less than or equal to 3`. With the change, it passes. A first version of the guard counted `readdir` mock calls across tests, and it did not fail that control: Vitest clears a mock's calls between tests, so the tally stayed at 0.

## Results (measured locally)

Median of three runs each, with the range of the three runs:

| Quantity | before | after | change |
| --- | --: | --: | --: |
| Whole `vitest run src --coverage` | 23.4 s (23.1–23.4) | 15.5 s (13.3–16.0) | −7.9 s (−34 %) |
| `src/lib/docs-loader.test.ts` | 22.1 s (21.3–22.6) | 13.9 s (12.6–14.9) | −8.2 s |
| `src/lib/architecture.test.ts` (control) | 1.3 s (1.3–1.6) | 1.1 s (1.1–1.3) | about 0 |

## CI effect (inferred)

#755 measured local times at roughly 1.5× those of a CI runner. On that basis, the inferred saving in CI is about 5 s per Docs site run, on the critical path whenever Docs site is the run's longest job.

The after-quantity on the same basis as #752 is the `test:coverage` step and the Docs site job time on the publication path. It comes from this PR's CI run (n = 1) and from push runs on `main` after the merge, and it is posted on #752 before the issue closes.

## Decision

Merge the change. It removes the read that #718 added, without changing what the tests assert. The guard stops a later test from adding another full pass unnoticed: a new test that needs the real entries calls `syncCorpus()`.

This record does not re-pin the baseline. Re-pinning needs push runs on `main` with #755's changes and this one. The check path also needs dispatched runs, which the maintainer approves. [#421](https://github.com/mgasca/calendar/issues/421) owns the next re-pin. That re-pin should cover two things: the deck step (intended cost), and the "Format and lint the docs site" step. The lint step runs only on docs-only pull requests, about 8 s that the push-run baseline never sees.

## Reconsider when

- A new test needs the real corpus in a way `syncCorpus()` cannot serve. Raise the budget in the same PR, with its cost.
- `test:coverage` on the publication path passes 30 s again on `main`. #755's first push runs measured 8–14 s (n = 1 each).
