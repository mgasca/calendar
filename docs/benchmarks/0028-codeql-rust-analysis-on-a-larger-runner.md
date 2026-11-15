---
subject: "Whether the CodeQL rust analysis can run on an 8-core larger runner in this repository, and at what cost (issue #884)"
harness: "tools/ci-timings/ci-timings.ts"
---

# 0028 CodeQL rust analysis on a larger runner

- **Date:** 2026-11-15 (probe run on 2026-11-14)
- **Issue:** [#884](https://github.com/mgasca/calendar/issues/884), epic [#881](https://github.com/mgasca/calendar/issues/881); [ADR-0012](../decisions/0012-ci-and-dependency-updates.md) (unchanged)
- **Harness:**
  - **Baseline:** `just tools ci-timings --workflow CodeQL --job "Analyze (rust)" --runs 40`, and the epic's log timestamps for the phases.
  - **Probe:** the run's job status, polled every 30 s with `gh run view <id> --json status,jobs`.
  - **Account:** `gh api users/mgasca` for the account type.
  - **Docs:** GitHub's [larger runners](https://docs.github.com/en/actions/concepts/runners/larger-runners) and [Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing) pages, read on 2026-11-14.
- **Budget:** 1 of the 6 approved dispatches used; the other 5, and the 3 after-sample runs, were not needed.

## Question

The Rust job's extraction, finalize and query evaluation are CPU-bound on the standard 4-core runner. Would an 8-core larger runner shorten every phase, and what would it cost?

## Baseline (measured, from epic #881)

| Quantity | Value |
| --- | --: |
| `Analyze (rust)` job | median 6:04, p90 7:11 (n = 40, 2026-11-13) |
| `analyze` step | median 347 s |
| Extraction, finalize, queries | about 115 s, 34 s and 174 s (medians, 14 jobs) |

Every runner in that sample had 4 CPUs. The durations fell into two groups, about 264–350 s and about 400–433 s, and every phase scaled by about 1.5× between them. That suggests the work is CPU-bound (inferred).

## Probe (measured)

- **Setup:** run 43586922868, a `workflow_dispatch` on a throwaway branch (`probe/884-larger-runner`, since deleted). The matrix held rust only, with `runs-on: ubuntu-latest-8-cores`.
- **Result:** `Analyze (rust)` stayed `queued`, with no runner assigned, from 10:47:20Z to 10:57:27Z on 2026-11-14. I then cancelled it (conclusion `cancelled`).
- **Control:** standard `ubuntu-latest` rust jobs started within about 10 s of being queued that morning, for example in runs 43585546341 and 43586859052 (record 0027).

## Why (from GitHub's documentation, read on 2026-11-14)

- **Who can use them:** larger runners are available only to organizations and enterprises on the GitHub Team or GitHub Enterprise Cloud plans. `mgasca/calendar` is owned by a personal account (`type: User`).
- **Billing:** larger runners are billed even for public repositories. The standard runners this repository uses are free for public repositories.
- **Price:** Linux x64 8-core is listed at $0.022 per minute, and Linux arm64 8-core at $0.014 per minute.

## Cost if adopted (inferred, not measured)

- **Per run:** a 30–45 % shorter job (the epic's prediction) would take about 3:20–4:15. At $0.022 per minute, that is about $0.07–0.09 per rust analysis.
- **Account:** the repository would first have to move into an organization on a paid plan. That changes its owner and its Pages URL, and it must stay public for the security features of [ADR-0013](../decisions/0013-public-repository-for-github-security-features.md).

## Decision and reconsideration

**Closed on evidence.** The maintainer decided on 2026-11-15, on #884: no `runs-on` change and no ADR-0012 amendment. The 3 + 3 comparison could not run, so no per-phase result on 8 cores exists; the predicted saving stays inferred. Meanwhile #882 takes the rust analysis off the path for pull requests that change no Rust input (record 0026), and #883 cuts LoadManifest by about 25 s on warm runs (record 0027).

Reconsider when:
- the repository moves into an organization on GitHub Team or Enterprise Cloud;
- GitHub offers larger runners to personal accounts;
- the rust analysis on backend pull requests becomes the merge bottleneck again, measured on the basis of record 0029.
