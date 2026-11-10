---
subject: "Docs site CI job slower than its pinned baseline on main: runner mix and corpus growth, no code change (issue #639)"
harness: "tools/ci-timings/ci-timings.cs"
---

# 0021 Docs site trend on main: runner mix and corpus growth

- **Date:** 2026-11-10
- **Issue:** [#639](https://github.com/mgasca/calendar/issues/639), opened by the trend check of [ADR-0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md); story [0034](../stories/0034-gate-ci-job-run-times-against-a-pinned-baseline.md); baseline record [0017](0017-ci-baseline-with-changes.md)
- **Harness:** `just tools ci-timings --branch main --job "Docs site" --runs 200 --created <window>` for the job and step tables. The jobs API (`gh api repos/mgasca/calendar/actions/runs/<id>/jobs`, `started_at` to `completed_at`) gave one row per run for the series.
- **Baseline window:** the publication path of `.github/ci-baseline.json`, 2026-11-07 14:17Z to 2026-11-08 00:12Z, `bcc655fe` to `2118e1c7`, 48 push runs.
- **Recent window:** the trend check's window, 2026-11-09 16:33Z to 22:16Z, `f6276e30` to `172426f5`, 20 push runs.
- **Series:** all 107 successful push runs of `ci.yml` on `main` from 2026-11-07 14:00Z to 2026-11-09 23:00Z. Runners: GitHub-hosted `ubuntu-latest`.

## Question

On 2026-11-10 the trend check reported Docs site on the publication path as slower: median 1:37 to 2:02, Hodges–Lehmann shift +18 s (≈95 % interval +11 to +27 s), p < 0.0001. Did a commit make the job slower, and does it need a fix or a re-pin?

## Steps (measured, medians)

| Step | baseline | recent | Δ |
| --- | --: | --: | --: |
| `pnpm --filter @calendar/docs test:coverage` | 17 s | 25 s | +8 |
| Build ADR site at the root path | 11 s | 14 s | +3 |
| Verify ADR site at the root path | 7 s | 9 s | +2 |
| Verify ADR site at a project subpath | 16 s | 22 s | +6 |
| Build and verify publication artifact | 14 s | 23 s | +9 (the baseline median includes runs that took 0 s on this step) |
| Read the dashboard data branch (added by #609) | – | 1 s | +1 |
| Setup, install, lint, CALM check, type-check, upload (sum of medians) | 22 s | 22 s | 0 |

No single step jumped. Every step that reads the corpus or runs the docs tests is slower by a similar fraction.

## Runner mix (measured)

Docs site durations are bimodal. A run with `test:coverage` at 17 s or less is counted as a fast runner, and any other run as a slow one.

| Window | runs | fast | job median, fast | job median, slow | `test:coverage`, slow | subpath verify, slow |
| --- | --: | --: | --: | --: | --: | --: |
| baseline | 48 | 25 (52 %) | 86 s | 109 s | 22 s | 20 s |
| recent | 20 | 4 (20 %) | 85.5 s | 123.5 s | 26 s | 23 s |

Job durations of the slow runs, by period:

| Period | slow runs | job durations, s |
| --- | --: | --- |
| 2026-11-07 before 19:00Z | 8 | 104–109 |
| 2026-11-07 19:00Z to 00:12Z | 16 | 93–122, most 106–117 |
| 2026-11-08 | 20 | 89–126, two clusters: about 100–105 and 118–126 |
| 2026-11-09 before the dashboard (16:16Z) | 11 | 98–125, two clusters as on 2026-11-08 |
| 2026-11-09 from the dashboard on | 17 | 104–135, most 122–132 |

## Findings

- **Runner mix (inferred effect, measured shares):** the share of fast runs fell from 52 % to 20 %. With the baseline's own per-mode medians, that change alone moves the overall median by about 20 s. The repository does not choose the runner. Issue [#421](https://github.com/mgasca/calendar/issues/421) is already weighing this effect, under the name slow-runner rule.
- **Corpus growth (inferred cause, measured growth):** the slow mode got about 14 s slower (109 to 123.5 s). Most of that was already there on 2026-11-08, before the delivery dashboard merged. Over the same time the Markdown documents under `docs/` grew from 117 (`bcc655fe`) to 152 (`172426f5`), 30 % more. The steps that read the corpus or test it all grew by similar fractions, which fits that cause. No harness isolated it.
- **Delivery dashboard (inferred):** #609 to #620 added about 3 to 5 s to the slow mode, comparing slow runs on 2026-11-09 before and after 16:16Z. That includes the new 1 s data-branch step.
- **Gate:** not at risk. The Docs site threshold on the publication path is 181 s, and the slowest recent run took 135 s.

## Decision

Leave the code unchanged. Nothing here is a regression from one commit. The runner mix is outside the repository. The corpus growth is the docs site doing its job on more documents.

Do not re-pin in this record. #421 owns the next re-pin, or a slow-runner rule, once its review window ends on 2026-11-14 13:52Z. A re-pin now would be replaced within days. That re-pin also covers record 0017's rule that a changed job, here the Docs site step added by #609, needs a new baseline.

The job builds the site three times: at the root path, at a project subpath and as the publication artifact. That is about 59 s of the 123.5 s slow-mode median. Whether two of those builds can share one is a separate question for its own `performance` issue. The saving is inferred, not measured.

## Reconsider when

- The Docs site slow-mode median on the publication path passes 150 s, or the trend check flags Docs site again after #421's re-pin.
- The Markdown corpus under `docs/` doubles from 152 documents.
- A gated pull request run of Docs site fails its threshold with no change to the docs app or the corpus.
