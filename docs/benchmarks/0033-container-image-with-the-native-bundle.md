---
subject: "The Container image job after the native-web Dockerfile stage: cached dependency and CLI layers, and the Buildx cache saved only outside pull requests (issue #1037)"
harness: "tools/ci-timings/ci-timings.ts"
---

# 0033 Container image with the native bundle

- **Date:** 2026-11-21
- **Issue:** [#1037](https://github.com/mgasca/calendar/issues/1037), part of epic [#998](https://github.com/mgasca/calendar/issues/998). #1029 (#1009) added a `native-web` stage that builds the Rune UI's WASM bundle into the image ([ADR-0067](../decisions/0067-second-ui-in-rune-with-a-native-workspace-and-generated-rust-client.md)).
- **Harness:**
  - **Jobs API:** `just tools ci-timings --job "Container image"`, plus the check runs of each commit below. It reads `started_at` to `completed_at` of the job, the quantity the [ADR-0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md) gate compares with the job's threshold in `.github/ci-baseline.json` (record [0030](0030-ci-baseline-nine-jobs.md): check path median 1:23, threshold 2:10, n = 30).
  - **Job logs:** the Buildx `#N DONE` lines for each step's time, and the `actions/cache` restore line.
  - **Cache list:** `gh api repos/mgasca/calendar/actions/caches`.
  - **Runners:** GitHub-hosted `ubuntu-latest`, 4 CPUs.
  - **Local:** a 16-core WSL machine, for the cargo phases with a separate target directory. These numbers are inferred for CI, not measured there.

## Question

Why did Container image go from about 1:23 to 7:06 when the bundle joined the image? How much of that does a pull request pay, and does the job get back under its threshold without a new baseline?

## The change

- **Dockerfile:**
  - `native-bindgen-version` → `native-bindgen` builds `wasm-bindgen-cli` in a stage that receives only the version string read from `native/Cargo.lock`.
  - `native-web` builds the dependencies over stand-in sources first, as the backend's `build` stage does, then the two crates' real sources.
- **`ci.yml`:** the Container image job restores the Buildx cache with `actions/cache/restore`. Only runs that aren't pull requests export it (`--cache-to … mode=max`) and save it (`actions/cache/save`), as the CodeQL caches already do (record [0027](0027-codeql-rust-extractor-cargo-caches.md)).
- **Guard:** `image-cache-main-only` in `tools/delivery-guards` fails when the job caches with `actions/cache`, saves or exports on pull requests, or has no restore or save step.

## Before (measured)

| Commit | Run | Cache | Container image | Control: Frontend |
| --- | --- | --- | --: | --: |
| `1735497493` (#1028, no native stage) | PR | warm | 1:22 | |
| `c78d27d56d` (#1029, first run) | PR | warm except the new stage | **7:06** | 1:05 |
| `f181456409` (#1029, merged head) | PR, two runs | warm, new stage included | 2:05 / 1:56 | 1:11 / 1:13 |
| `6491b411f9` (`main`, push) | push | `main`'s entry had no native layers | **9:11** | |

The cold stage on `c78d27d56d`, from the Buildx log:

| Step | Time |
| --- | --: |
| `rustup toolchain install` | 20.4 s |
| `cargo install wasm-bindgen-cli` | 128.3 s |
| `cargo build --release --target wasm32-unknown-unknown` | 174.3 s |
| Cache export | 52.8 s |

- **Keying:** before the change, the CLI layer followed the whole `native/Cargo.lock`, and the build layer followed every file in `native/`. So every native PR rebuilt the bundle from scratch.
- **Cache size:** each Buildx cache entry was about **1.7 GB**, and every pull request saved one. At 12:11 on 2026-11-21, the repository's caches were five `image-Linux-*` entries, 1,711 to 1,729 MB each, **9.25 GB** of its 10 GB. Every other cache had been evicted. That's why #1038's first run restored nothing (`Cache not found for input keys: … image-Linux-`).

## After (measured)

| Commit | Run | Cache | Container image | Control: Frontend |
| --- | --- | --- | --: | --: |
| `7b376892bc` (#1038, Dockerfile only) | PR | none: evicted | 9:31 | skipped |
| `00ec0967ca` (#1038, + `ci.yml`) | PR, two attempts | this PR's entry, all new layers; no export | **0:52 / 0:44** | 1:09 / 0:57 |
| `0d62b0e9de` (#1045, stacked on #1038) | PR | none (a stacked PR's base isn't `main`); no export | 7:51 | 1:18 |

The cold build on `0d62b0e9de`, from the Buildx log (stages run in parallel):

| Step | Time |
| --- | --: |
| `native-web` dependency layer | 408.8 s, the critical path |
| `build` (backend) dependency layer | 347.6 s |
| `native-bindgen` (`cargo install wasm-bindgen-cli`) | 290.2 s |
| `build` real sources | 57.9 s |
| `native-web` real sources, `wasm-bindgen` and fonts | **10.9 s** |
| `native-toolchain` | 16.9 s |

**Local cargo phases** (inferred for CI): a cold release wasm32 build took 197 s, and a rebuild of the two crates over cached dependencies took 8 s.

## Findings

- **Warm (measured):** with the cache warm and nothing to export, the job takes 0:44 to 0:52, under the 1:23 median it had before the bundle. The export, which pull requests no longer run, was 53 to 96 s of each run.
- **A native source change (inferred):** a PR that changes only native sources rebuilds about 11 s of the stage over the warm cache. Expect about 1:05, under the 2:10 threshold. This is the common case in epic #998. It's measured once `main`'s entry holds the new stages; see below.
- **A native lock or manifest change (measured cold):** the native dependency layer, about 7 minutes on the runner. The gate can fail such a PR. That's the same trade-off a backend lock change makes with the backend's dependency layer, and it's not absorbed into the baseline here.
- **Not a baseline change:** `.github/ci-baseline.json` is unchanged.
- **Method:** the samples are single CI runs, not alternated A/B runs on one machine, so they show orders of magnitude, not small differences. The control job (Frontend) stayed within 0:57 to 1:18 throughout.

## Pending

- **After the merge:** the first push run on `main` (which saves the new stages into `main`'s one entry), the next ten push runs, and the first pull request that changes only native sources. They go in a records-only follow-up on #1037.
- **The cache list** after a day, to confirm the other caches are no longer evicted.

## Reconsideration

Re-measure when:
- a Rune bump moves the native dependency layer above the backend's;
- `.github/ci-baseline.json` is next regenerated;
- the repository's cache use goes back above 8 GB.

A `--mount=type=cache` build, or building the bundle once in the Native job and passing it to the image, would remove the cold dependency layer from lock-changing PRs. Either changes how the image is built for deployment, so it's the maintainer's call.
