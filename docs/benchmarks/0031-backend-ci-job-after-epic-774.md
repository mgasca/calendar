---
subject: "The Backend CI job after epic 774 (Rust): before and after on main, and the measured effect of each of its four changes"
harness: "tools/ci-timings/ci-timings.ts"
---

# 0031 The Backend CI job after epic #774

- **Date:** 2026-11-16
- **Issue:** [#779](https://github.com/mgasca/calendar/issues/779), the last child of epic [#774](https://github.com/mgasca/calendar/issues/774).
- **Baseline:** the run-time baseline that gates Backend again, on both paths, is record [0030](0030-ci-baseline-nine-jobs.md) (#973, for #421). This record does not change `.github/ci-baseline.json`.
- **Harness:** `tools/ci-timings/ci-timings.ts`, run through the recipe:

  ```bash
  just tools ci-timings --job Backend --branch main --created ">=2026-11-13T21:06:00Z" --runs 120
  ```

  The run was on 2026-11-16, and the window reached 2026-11-16 10:07Z.
- **Window:** every successful run of `ci.yml` on `main` from 404df0a23 (#786, 2026-11-13 21:06Z, the last of the four changes) to 69dc54a23 (2026-11-16 10:07Z). That is 102 runs: 72 pushes and 30 `workflow_dispatch` runs, whose Backend steps are the same.
- **Machine:** GitHub-hosted `ubuntu-latest` runners, as for every CI record.

## Question

#674 moved the backend from .NET to Rust, and the Backend job's median rose from 85 s to 225 s. After the four changes of epic #774, how long does the job take on `main`, and how much does each change account for?

## Before

All numbers in this section are measured and come from #774: successful Backend jobs, start to end, from the jobs API.

| Sample | n | p25 | median | p75 | max |
| --- | --: | --: | --: | --: | --: |
| .NET, push and PR runs, 2026-11-06 to 2026-11-11 | 169 | 78 s | 85 s | 90 s | 131 s |
| Rust, push and PR runs, 2026-11-11 15:24Z to 2026-11-13 17:20Z | 55 | 211 s | 225 s | 236 s | 287 s |

Step medians of the 55 Rust jobs:

| Step | median | p75 |
| --- | --: | --: |
| Test with coverage (`cargo llvm-cov`) | 147 s | 156 s |
| `actions/cache` restore (1.8 to 2.2 GB) | 49 s | 53 s |
| OpenAPI contract check (a separate build) | 9 s | 9 s |
| Toolchain install | 9 s | 9 s |
| Clippy | 6 s | 7 s |
| fetch, llvm-cov install, fmt, checkout, upload | ≈ 10 s | |

## After (measured)

| | n | min | median | p90 | max |
| --- | --: | --: | --: | --: | --: |
| Backend job, all runs on `main` | 102 | 1:31 | **1:59** | 2:12 | 4:31 |
| Backend job, the 72 pushes | 72 | | **2:00** | 2:13 | 4:31 |

Step medians over the 102 runs:

| Step | median | p90 | max | Before (median) |
| --- | --: | --: | --: | --: |
| Test with coverage | **76 s** | 89 s | 160 s | 147 s |
| Restore the dependency cache | **15 s** | 17 s | 20 s | 49 s |
| OpenAPI contract check | removed | | | 9 s |
| Install the pinned Rust toolchain | 9 s | 10 s | 12 s | 9 s |
| Clippy | 6 s | 7 s | 78 s | 6 s |
| cargo fetch, cargo-llvm-cov install, fmt, checkout, set-up, upload | 10 s in total | | | ≈ 10 s |
| Start pulling / Wait for the PostgreSQL image | 0 s / 0 s | 0 s / 0 s | 1 s / 1 s | — |
| Keep only the dependencies / Save the cache | 0 s / 0 s | 0 s / 0 s | 1 s / 8 s | — |

- **Job: 225 s → 120 s, −105 s (−47 %), measured on the pushes.** The job is still 35 s above the .NET median of 85 s.
- **Per step, measured:** the test step lost 71 s, the cache restore 34 s and the contract step 9 s. Step medians do not add up exactly to a job median.
- **The slowest run, measured.** That is 4:31, run [43710817437](https://github.com/mgasca/calendar/actions/runs/43710817437), the push of the Rust 1.100.0 bump (#789). The new key missed, so the restore took 1 s, Clippy 78 s, the test step 160 s and the save 8 s. This is the one cold run per toolchain change that the cache key accepts (see "The cache key").

## Effect of each change

| Change | Delivered by | Effect | Basis |
| --- | --- | --- | --- |
| A: one integration-test binary per crate (#775) | #781, 23d11aadd | The test step took 104 s and 69 s on the PR's two runs, against 147 s; the stacked #783 saw 94 s and 102 s. On `main`, A accounts for most of the test step's drop to 76 s: about 45 to 50 s once B's and C's shares are taken out. | The PR runs are measured, n = 2. The share on `main` is inferred by subtraction. |
| D: contract check inside the test run (#778) | #783, c60cff70c | The step and its third, uninstrumented build are gone: 9 s at #774's median, 5 to 10 s on #781's runs. The check is the unit test `the_committed_contract_is_the_generated_document`, which already ran inside the test step. | Attributed by step removal: the step's time is measured. The cost added to the test step is inferred to be none, because the test already ran there. |
| B: line-tables-only debug info and a dependencies-only cache (#776) | #785, 1da72ee1b | The cache went from 1.8–2.2 GB to 684–718 MB. The restore went from 49 s to 11 s warm on the PR (one sample), and to a **15 s median over 102 runs on `main`**. The instrumented build inside the test step went from 48 s to 27.7 s (one log each). | Cache size and the restore are measured. The build time is measured on one log each. That it comes from linking smaller objects is inferred. |
| C: pull the PostgreSQL image while the cache restores (#777) | #786, 404df0a23 | The first database test binary got **3 to 4 s faster** in both PR pairs (cold 10.8 → 6.9 s, warm 14.0 → 11.1 s). **#774 estimated ≈ 11 s.** The wait step is 0 s at the median and the maximum, so the pull never makes the job wait. | Measured on one pair per cache state. #774's 11 s was inferred from the first binary's delta; the rest of that binary's time is the container start and its tests. |

C's PR also saw its warm test step 19 s faster than B's. Following #786, this record credits C only with the 3 to 4 s measured on the first binary and treats the rest as runner variance.

## The cache key

The key is `backend-<os>-rust-<channel>-deps-debug-<CARGO_PROFILE_DEV_DEBUG>-llvmcov-<LLVM_COV_VERSION>-<hash of the backend Cargo.toml files and Cargo.lock>`. The restore fallback drops only the hash.

- **The first proposal.** #776 proposed a key on the toolchain and `Cargo.lock` alone.
- **Why it changed.** The review on #785 found that changing a build setting without a lock change would get an exact hit on stale dependencies. Every run would then rebuild them and never save the result.
- **The decision.** The maintainer chose to key on the settings and manifests as well, recorded on #776 on 2026-11-13.
- **What it costs.** One cold run per change of toolchain, setting or manifest. The Rust 1.100.0 bump above is one such run, measured at 4:31 (271 s).

## The baseline

#674 dropped Backend from `.github/ci-baseline.json`, so the run-time gate stopped watching the job. Record [0030](0030-ci-baseline-nine-jobs.md) (#973) re-pinned nine jobs on both paths from runs after #889. Its Backend entries:

| Path | n | median | threshold |
| --- | --: | --: | --: |
| publication | 31 | 1:52 | 3:16 |
| check | 30 | 1:57 | 2:22 |

#779 planned its own pin of the publication path from the window above. For that, #890 added `ci-timings --baseline --path`: it rebuilds one path, carries the others unchanged, and names their source record in a `carried` field. The pin was run, but #973 merged first, from a later window and with both paths. #779's pin was therefore superseded and not committed. The `--path` option stays in the tool.

## Reconsideration

- **Revisit the Backend job** if its median on `main` moves above 2:15 (the p95 of the pushes above) without a cause in the job.
- #774's other options are still unplanned: cargo-nextest with a shared database server, and coverage only on `main`.
- A toolchain bump's cold run (about 4:30, measured once on `main`) would exceed both Backend thresholds on that bump's own pull request (inferred: its cache scope misses the new key too). If the gate fails there, re-run all jobs once the cache is warm.
