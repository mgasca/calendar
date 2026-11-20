---
subject: "CodeQL Rust analysis of the native/ workspace as its own entry, and the backend entry scoped to backend/ (issue #1019)"
harness: "tools/ci-timings/ci-timings.ts"
---

# 0032 CodeQL Rust analysis of the native workspace

- **Date:** 2026-11-20
- **Issue:** [#1019](https://github.com/mgasca/calendar/issues/1019), part of epic [#998](https://github.com/mgasca/calendar/issues/998). The Rune UI's workspace ([ADR-0067](../decisions/0067-second-ui-in-rune-with-a-native-workspace-and-generated-rust-client.md)) gets a CodeQL Rust analysis of its own, before the native sign-in code of #1008 lands.
- **Harness:**
  - **Jobs API:** `just tools ci-timings --workflow codeql.yml --job "Analyze (rust)" --job "Analyze (rust-native)" --branch main`. It reads `started_at` to `completed_at` of each job and its steps, the quantity of records [0026](0026-codeql-rust-analysis-on-pull-requests-without-rust-input.md), [0027](0027-codeql-rust-extractor-cargo-caches.md) and [0029](0029-codeql-rust-after-epic-881.md).
  - **Job logs:** `gh run view --job <id> --log`, for the extractor's LoadManifest `total duration (…)` and the reuse step's message.
  - **Runners:** GitHub-hosted `ubuntu-latest`, 4 CPUs.

## Question

What does the native entry cost, on pull requests with and without native input and on `main`? Does scoping the backend entry to `backend/` leave the backend analysis unchanged?

## The change

- **Entries:** the Analyze matrix has one Rust entry per Cargo workspace. `rust` analyses `backend/` (`config: {"paths":["backend"]}`, from #1020, category `/language:rust`, job name and cache keys unchanged). `rust-native` analyses `native/` (`{"paths":["native"]}`, category `/language:rust-native`). A `source-root` does not scope the Rust extractor: with one, it still loaded every workspace (#1020, run 44727071875).
- **Gate:** `.github/codeql-languages.jq` answers `{rust, native}` from CI's Backend and Native sets.
- **Reuse:** a pull request that changes neither set reuses main's result in that entry's category, with the reuse step of record 0026, parameterised by the entry.
- **Caches:** each entry has its own registry and target-directory entries, keyed on its own `Cargo.lock`.
- **Toolchain:** the analyze step sets `RUSTUP_TOOLCHAIN=stable`, so the extractor keeps the runner's stable rustc instead of the `rust-toolchain.toml` of the workspace cargo runs in (native/'s pins Rune's 1.99.1). That rustc keys the target cache.
- **Build libraries:** the native entry installs `libxkbcommon-dev` and `libwayland-dev` for Rune's pkg-config build scripts.

Unscoped, the one Rust entry loads every Cargo workspace in the checkout. On #1020's runs (measured by S2), LoadManifest of `Analyze (rust)` took 28.7 s with `native/` loaded, 18.6 s with `source-root: backend` (which still loaded it), and 2.7 s with the `paths` config (run 44728211078), which loaded only `backend/Cargo.toml`.

## Before (measured)

The 10 latest successful `codeql.yml` push runs on `main`, 2026-11-16 14:47Z to 2026-11-20 10:45Z, before `native/` reached `main`:

| Job | n | min | median | p90 | max |
| --- | --: | --: | --: | --: | --: |
| Analyze (rust) | 10 | 4:07 | 6:48 | 7:18 | 7:20 |
| Analyze (javascript-typescript) | 10 | 1:05 | 1:17 | 1:31 | 1:32 |
| Analyze (actions) | 10 | 0:38 | 0:45 | 0:47 | 0:50 |
| CodeQL languages | 10 | 0:03 | 0:05 | 0:06 | 0:12 |

In `Analyze (rust)`, `github/codeql-action/analyze` took a median of 387 s (231–415 s). Restoring the registry and the target directory took a median of 1 s and 2 s.

## After

Pending: the pull request's runs (cold native caches, then a run without native input that reuses main's result) and the first 10 push runs on `main` after the merge. They're added to this record before it merges, or in a records-only follow-up if the post-merge sample isn't ready in time, as stated on #1019.

## Reconsideration

Re-measure when Rune or the native lock file changes the native entry's LoadManifest by more than its cached median, or when the CodeQL action starts caching the extractor's dependencies itself.
