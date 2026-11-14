---
subject: "CodeQL Rust extractor LoadManifest phase with a cached cargo registry and a cached persistent target directory (issue #883)"
harness: "tools/ci-timings/ci-timings.ts"
---

# 0027 CodeQL Rust extractor with cached cargo registry and target directory

- **Date:** 2026-11-14
- **Issue:** [#883](https://github.com/mgasca/calendar/issues/883), epic [#881](https://github.com/mgasca/calendar/issues/881)
- **Harness:** each `Analyze (rust)` job's log (`gh run view --job <id> --log`):
  - the extractor's `total duration (…)` lines;
  - `number of inputs`, and `relations: … MiB` from `Finished writing database`;
  - the `actions/cache` restore and save lines;
  - the report step's counts.

  Plus the jobs API for job and step durations, and `GET /code-scanning/analyses` for the alert count. Runners: GitHub-hosted `ubuntu-latest`, 4 CPUs.
- **Before:** the epic's sample. LoadManifest 25–50 s across 14 Rust jobs on 2026-11-13; extraction 90–150 s; `Analyze (rust)` median 6:04 (n = 40).
- **After:** five `workflow_dispatch` runs on the delivery branch, dispatched one at a time and listed by head commit below, plus the debug diagnosis run. Every run analysed the same `backend/Cargo.lock` (hash `0a9b90b5…`).

## Question

The Rust extractor's LoadManifest phase takes 25–50 s on every run. What does it spend that time on, and does caching it make it shorter?

## Diagnosis

- **Debug verbosity** (run 43583957174, job 132414383440, on a throwaway branch): LoadManifest took 38.6 s, but the extractor logs nothing between its toolchain line and the end of the phase. Its configuration shows `cargo_target_dir: None`.
- **Locally, downloading looked like the cause** (inferred, and wrong for CI): `cargo metadata --locked` with an empty `CARGO_HOME` took 34.5 s and downloaded 396 crates. Warm, it took 0.73 s.
- **On CI the registry was not the cause** (measured, runs 1 and 2 below): restoring all 327 crates the extractor needs left LoadManifest at 28.8 s, against 24.5 s cold.
- **Build scripts and proc macros were the cause** (measured, run 3): with `CODEQL_EXTRACTOR_RUST_OPTION_CARGO_TARGET_DIR` set, the extractor left a 533 MB target directory with 56 build-script output directories and 23 proc-macro libraries. Restoring that directory (run 4) cut LoadManifest to 1.3 s.

## Runs (measured)

| Run | Job | Head | Registry | Target dir | LoadManifest | ExtractLibrary | Extraction | Job | Inputs | Relations | Rust alerts |
| --- | --- | --- | --- | --- | --: | --: | --: | --: | --: | --: | --: |
| debug 43583957174 | 132414383440 | `c2597a1d1` | none | none | 38.6 s | 48.3 s | 2:19.7 (debug logging) | 7:04 | 119 | 209.22 MiB | 0 |
| 1 43585546341 | 132419160972 | `51ea56871` | miss, saved 37.7 MiB | none | 24.5 s | 30.0 s | 1:34.6 | 5:13 | 119 | 208.43 MiB | 0 |
| 2 43586859052 | 132423128685 | `51ea56871` | hit, 327 crates, 0 s | none | 28.8 s | 33.8 s | 1:45.2 | 5:40 | 119 | 209.74 MiB | 0 |
| 3 43587372998 | 132424656446 | `b3194ee3a` | hit, 2 s | miss, saved 124 MiB | 35.7 s | 42.0 s | 2:07.1 | 7:01 | 119 | 209.61 MiB | 0 |
| 4 43587930830 | 132426338307 | `b3194ee3a` | hit, 2 s | **hit, 4 s** | **1.3 s** | 30.9 s | **1:12.8** | **4:56** | 119 | 209.04 MiB | 0 |
| 5 43588497392 | 132428009169 | `735629131` (final) | hit, 1 s | miss (new key with rustc 1.99.1), saved in 5 s | 31.5 s | 42.8 s | 2:05.4 | 6:41 | 119 | 209.72 MiB | 0 |

- **Configurations:** runs 3 and 4 ran the experiment commit. Run 5 ran the delivered configuration: the same caches, with the target key also carrying the runner's `rustc` version, so the experiment's entry did not match.
- **Report step:** it prints the crate count, the build-script directory count and the target size on every rust job. In runs 2–5 it printed 327 crates, then 56 build-script directories and 533–534 MB in runs 3–5.
- **Warm runs on the final key:** further runs are listed under "After merge" below. Pull request runs cannot read caches that a feature branch saved, so they start cold until `main` has saved its copy.

## Findings

- **LoadManifest** (measured): 24.5–35.7 s on the four cold-target runs, and 1.3 s with the target directory restored. That is 23–34 s less per run, at a restore cost of 4 s.
- **Extraction total** (measured): 1:34.6–2:07.1 cold, against 1:12.8 warm. Most of the difference is LoadManifest. ExtractLibrary (30.9 s warm, 30.0–42.8 s cold) does not depend on the cache; it varies with the runner, as the epic's two runner groups showed.
- **Registry cache** (measured): it restores 327 crates in 0–2 s from a 37.7 MiB entry. On its own it did not shorten LoadManifest. It is kept because the extractor needs the crate sources even when the target directory is warm, and because it removes the dependency on crates.io from the analysis (inferred benefit; not separately measured).
- **No coverage loss** (measured): every run had 119 inputs and 0 Rust alerts over 28 rules. The finalized database ranged from 208.43 to 209.74 MiB with no pattern by cache state; the debug run without any cache was 209.22 MiB.
- **New cost** (measured): restore 1–2 s (registry) plus 4 s (target dir); a save of 5 s on a run that is not a pull request and misses the exact key. Two Actions cache entries: 37.7 MiB and 124.6 MiB per lock file and runner `rustc`.

## After merge

To be completed from the first successful `Analyze (rust)` push runs on `main` after the merge: the first saves both caches, and the following ones restore them. Run IDs and the same columns go on #883 and in the combined record 0029.

## Decision and reconsideration

Keep both caches; the target directory carries the saving. Reconsider when:
- a warm LoadManifest on `main` exceeds 10 s;
- the target entry grows past about 250 MiB, because the restore-key carries older builds across lock-file changes (measure, then key on the lock file alone without a fallback);
- the CodeQL action starts caching the extractor's dependencies itself.
