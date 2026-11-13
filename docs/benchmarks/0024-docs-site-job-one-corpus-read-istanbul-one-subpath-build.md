---
subject: "Docs site CI job after one corpus read in the build checks, Istanbul coverage and one subpath build (issue #755)"
harness: "tools/ci-timings/ci-timings.cs"
---

# 0024 Docs site job: one corpus read, Istanbul coverage, one subpath build

- **Date:** 2026-11-13
- **Issue:** [#755](https://github.com/mgasca/calendar/issues/755); related [#752](https://github.com/mgasca/calendar/issues/752) (record 0023 in [#766](https://github.com/mgasca/calendar/pull/766)), [#421](https://github.com/mgasca/calendar/issues/421) (gate review and re-pin), baseline record [0017](0017-ci-baseline-with-changes.md), runner mix record [0021](0021-docs-site-trend-runner-mix.md)
- **Changes:** [#757](https://github.com/mgasca/calendar/pull/757) (A: Istanbul instead of V8 coverage for `@calendar/docs`), [#756](https://github.com/mgasca/calendar/pull/756) (B: `tests/build.test.ts` reads the corpus once), [#758](https://github.com/mgasca/calendar/pull/758) (C: the example subpath build runs only where no publication build does). On `main` as `6e2855629`, `ed7f2c3f7` and `132e31be4`.
- **Harness:** the jobs API (`gh api repos/mgasca/calendar/actions/runs/<id>/attempts/1/jobs`, `started_at` to `completed_at` for the job and each step), the same per-run rows that `just tools ci-timings --job "Docs site"` tabulates. Medians are true medians (the mean of the middle pair for an even count). Runners: GitHub-hosted `ubuntu-latest`.
- **Before:** every successful Docs site job on the publication path (the "Build and verify publication artifact" step ran) in the 60 most recent `ci.yml` runs on 2026-11-13: 44 jobs, push and pull request, started 12:21Z to 15:30Z. All of them contain #718 and #720.
- **After:** every successful Docs site job on the publication path whose run contains all three changes (the subpath step skipped), started 16:27Z to 17:02Z: 8 jobs (1 push, 7 pull request). One more job in the window (run 43463592050, 16:31Z) still ran the subpath step, so its merge commit predates #758; it is excluded.

## Question

The Docs site job kept failing the ADR-0045 run-time gate (181 s on the publication path). Where did its time go, and did the three changes bring it clear of the threshold without dropping a check?

## Job (measured)

| | jobs | median | max | at or over 181 s |
| --- | --: | --: | --: | --: |
| Before | 44 | 159 s | 186 s | 7 |
| After | 8 | 94.5 s | 123 s | 0 |

The job median fell by 64.5 s (41 %). The after sample is small: it holds the first eight jobs that contain all three changes, so it shows the size of the effect, not a pinned baseline.

## Steps (measured, medians)

| Step | before | after | change |
| --- | --: | --: | --- |
| `pnpm --filter @calendar/docs test:coverage` | 39.5 s | 11 s | A |
| Verify docs site at the root path | 10 s | 3 s | B |
| Verify docs site at a project subpath (build + verify) | 24.5 s | skipped | C |
| Build and verify publication artifact (build + verify) | 25 s | 20 s | B |
| **Control:** Build docs site at the root path (no change touches it) | 15.5 s | 18 s | none |
| Test and type-check the narrative decks | 6 s | 6 s | none |

The control step got slower, not faster, so the after window did not run on faster runners than the before window. The savings come from the changes, not from runner mix.

## Mechanisms (measured locally)

WSL, 16 cores, at `c0b09fa93` and on each PR branch. Runs were sequential, two per version, not alternated (A, B, A, B), so these numbers show the direction and size of each change, not exact ratios.

- **A:** `vitest run src` takes 13 s without coverage, 61 s with V8 coverage and 15 s with Istanbul (91.6 % statements reported). V8 block coverage also instruments micromark, which the real-corpus tests in `docs-loader.test.ts` run over about 2.3 MB of Markdown: that file alone takes 57 s under V8 and 13 s without coverage.
- **B:** `verify:build` takes 17–18 s when six tests each call `readDocuments()` (about 2.5 s per full corpus parse) and 4.2–5.0 s with one shared read. The guard test counts `docs/decisions` listings: 6 without the fix, 1 with it.
- **C:** the publication URL is itself a project subpath (`/calendar/`, `/calendar/pr-preview/pr-N/`), so the example subpath build repeated a check the publication build makes. It still runs on fork PRs and dispatches.

## Findings

- **Measured:** the job is 41 % faster on the publication path, and no job in the after window came within 58 s of the threshold.
- **Measured:** every remaining build still re-renders all 217 documents. "Syncing content" takes about 16 s of a 21–25 s local `astro build`, 10.8 s of it in `renderMarkdown`. The loader clears the content store and never compares the digest it sets (proposal F in #755).
- **Correction:** the analysis on #755 gave the before median as 166 s (2:46) and some step medians as the upper of the two middle values. The true medians are the ones in this record (159 s for the job).

## Decision

Keep the three changes. Proposal D (the extra corpus pass in the docs unit tests) continues on #752. E (one build per job), F (honouring the content-layer digest with a cache across runs) and G (splitting the job in two) are not pursued now: the job has about 86 s of headroom on its median, and E and G would change what or where CI checks.

## Reconsider when

- the Docs site job's publication-path median comes back within 30 s of its threshold, or
- #421 re-pins the publication baseline: take the new baseline from push runs that contain all three changes, and drop this record's after sample in favour of that larger one.
