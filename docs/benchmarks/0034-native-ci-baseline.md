---
subject: "The check-path run-time baseline re-pinned with the four Native jobs and the Container image job that builds the WASM bundle, replacing the threshold #1061 set by hand on that path (ADR-0045)"
harness: "tools/ci-timings/ci-timings.ts"
---

# 0034 The check-path CI baseline with the Native jobs

- **Date:** 2026-11-28
- **Issue:** [#1065](https://github.com/mgasca/calendar/issues/1065), the follow-up of epic [#998](https://github.com/mgasca/calendar/issues/998). The method is in [ADR-0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md). This record follows record [0030](0030-ci-baseline-nine-jobs.md) and doesn't edit it.
- **Harness:** `tools/ci-timings/ci-timings.ts`, run as the `tools` recipe runs it:

  ```bash
  just tools ci-timings --baseline --path check --created "2026-11-25T11:14:00Z..2026-11-27T16:58:09Z" --holdout "2026-11-25T11:14:00Z..2026-11-27T16:58:09Z" --record docs/benchmarks/0034-native-ci-baseline.md
  ```

  - **What it writes:** `.github/ci-baseline.json`, plus the tables below. `--path check` rebuilds only the check path and copies the publication path from record 0030 unchanged. The file records that copy under `carried`.
  - **The hold-out window:** as in record 0030, it equals the baseline window.
- **Window:** every successful run of `ci.yml` on `main` on the check path, from `38cb5f482e` (#1062, 2026-11-25 11:14Z) to 2026-11-27 16:58Z.
  - **Why it starts at #1062:** #1062 fixed #1059. Before it, every Native job failed on the `week` goldens from 2026-11-23, so no earlier run counts.
  - **What it holds:** 33 runs (30 dispatches and 3 nightly scheduled runs) over 3 commits (`38cb5f482e`, `c82ab4f6a7`, `1d5660aea9`).
- **Machine:** GitHub-hosted `ubuntu-24.04`, `macos-latest` and `windows-latest` runners, as each job's `runs-on` names.
- **Constants:** unchanged from record 0030 (`α = 0.1 %`, floor 15 s, margin 10 %). On the check path `J = 13`, because the four Native jobs join the nine gated jobs, so `z` is 3.785. The publication path keeps `J = 9` and `z` 3.692.

## Question

The Rune UI added four Native jobs (Linux, WASM, macOS and Windows), and Container image now builds the WASM bundle too (#1029, cached since #1038). What do these jobs take on the check path? What threshold does ADR-0045's formula give them?

On 2026-11-25 #1061 raised Container image's thresholds by hand to 4:00 on both paths, as a temporary departure from ADR-0045. What replaces that?

## Method

- **Quantity, paths and threshold:** as in records 0014, 0017 and 0030. The quantity is each job's `started_at` to `completed_at` from the jobs API, for successful jobs only.
  - **Paths:** a run is on the publication path when the Docs site step "Build and verify publication artifact" succeeded, and on the check path otherwise.
  - **Threshold:** `ceil(max(exp(m + z·1.4826·MAD), M + max(15 s, 10 % · M)))`.
- **Gated jobs on the check path:** ADR conventions, Backend, Changes, Container image, Docs site, Flow binding, Frontend, Narratives, Tooling, and the four Native jobs. The tool rebuilds every check-path job from the window, so the nine older jobs are re-measured too.
- **Check-path sample:** 30 `workflow_dispatch` runs on `main`, approved for #1009 and continued on #1065. They ran one at a time, each waiting until no CI run on `main` was in progress, from 2026-11-25 11:25Z to 2026-11-27 16:34Z. All 30 counted runs succeeded.
- **Spacing:** not constant. The dispatches were meant to start 45 minutes apart, but the machine that started them slept or restarted between some of them.
  - **Gaps between dispatches, in minutes, in order:** 154, 47, 70, 188, 850, 1370, then fifteen of about 15, then 37, 66, and nine of 22–25.
  - **Why so uneven:** the 850- and 1370-minute gaps are a night's sleep and a machine restart.
  - **The change at dispatch 8:** the maintainer shortened the spacing to 15 minutes on 2026-11-27.
  - **What the gaps leave out:** every run started between 08Z and 17Z except one at 19Z, so the sample has no runs between 20Z and 08Z.

### Runs left out

| Run | When | Why |
| --- | --- | --- |
| 3 dispatches on `85081864e3`, `7f19bb050d`, `f521e84be3` | 11-22 | Before #1062, so not counted, as agreed on #1009 |
| [45157782510](https://github.com/mgasca/calendar/actions/runs/45157782510) | 11-23 10:37Z | Failed on #1059: the `week` scene read the system clock |
| [45611174568](https://github.com/mgasca/calendar/actions/runs/45611174568) | 11-25 12:10Z | Runner fault: the WASM job's apt sources had no Ubuntu archive |
| [45987698329](https://github.com/mgasca/calendar/actions/runs/45987698329) | 11-27 11:06Z | GitHub API fault: `extractions/setup-just` got `403` in Container image, after the build |

The baseline takes only successful runs, so the tool drops the last three on its own. The list is here to account for the gaps.

## Results

### Window

| Path | status | runs | events | from | to | span | commits |
| --- | --- | --: | --- | --- | --- | --: | --- |
| check | pinned | 33 | schedule, workflow_dispatch | 2026-11-25 11:25Z | 2026-11-27 16:34Z | 53.2 h | 3 |
| publication | pinned (carried from 0030) | 31 | push | 2026-11-15 10:20Z | 2026-11-16 09:53Z | 23.6 h | 31 |

### Check-path baseline and thresholds

| Job | n | median | log-MAD | p90 | p95 | max | old threshold | new threshold |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| ADR conventions | 33 | 0:08 | 0.134 | 0:15 | 0:16 | 0:16 | 0:23 | 0:23 |
| Backend | 33 | 2:05 | 0.033 | 2:11 | 2:16 | 4:40 | 2:22 | 2:31 |
| Changes | 33 | 0:05 | 0.223 | 0:09 | 0:09 | 0:12 | 0:20 | 0:20 |
| Container image | 33 | 2:01 | 0.072 | 2:18 | 2:22 | 3:20 | 4:00 (#1061, by hand) | **3:01** |
| Docs site | 33 | 1:26 | 0.100 | 1:44 | 1:47 | 1:49 | 2:34 | 2:31 |
| Flow binding | 33 | 0:18 | 0.182 | 0:25 | 0:28 | 0:32 | 0:35 | 0:51 |
| Frontend | 33 | 1:06 | 0.128 | 1:18 | 1:21 | 1:25 | 1:35 | 2:16 |
| Narratives | 33 | 0:08 | 0.134 | 0:11 | 0:11 | 0:12 | 0:23 | 0:23 |
| Native (Linux, ubuntu-24.04, desktop) | 33 | 1:50 | 0.053 | 2:03 | 2:33 | 3:43 | none | **2:29** |
| Native (WASM, ubuntu-24.04, wasm) | 33 | 1:05 | 0.156 | 1:24 | 1:26 | 3:48 | none | **2:37** |
| Native (Windows, windows-latest, desktop) | 33 | 3:04 | 0.073 | 3:31 | 3:40 | 7:42 | none | **4:38** |
| Native (macOS, macos-latest, desktop) | 33 | 1:59 | 0.198 | 2:33 | 3:20 | 7:21 | none | **6:01** |
| Tooling | 33 | 0:38 | 0.082 | 0:43 | 0:44 | 0:46 | 0:53 | 1:01 |

The publication path is unchanged from record 0030, and so is #1061's hand-set 4:00 for Container image on it. The Native jobs have no publication-path entry, so on that path they warn and don't fail.

### In-sample runs above the new thresholds

Seven of the 429 job runs in the sample (13 jobs × 33 runs) exceed the new thresholds:
- **Five are from dispatch 1** ([45604237620](https://github.com/mgasca/calendar/actions/runs/45604237620)), the first run on `38cb5f482e` after several merges: Backend 4:40, Native Linux 3:43, WASM 3:48, Windows 7:42 and macOS 7:21. Dispatch 1 restored older caches and rebuilt most of the dependency layers.
- **The other two** are a Native Linux run at 2:33 and a Container image run at 3:20. The Container image run is under #1061's 4:00 but over the new 3:01.

### Back-test

The back-test window equals the baseline window. Each of its held-out runs, on `main` and in pull requests alike, was on the publication path, so **this record has no check-path back-test**.
- **What it showed instead:** the copied publication path is stale.
  - **On `main`:** 2 of 5 held-out pushes exceeded it. Run 45602517098 took 3:42 in Backend against 3:16, and run 45606707078 took 5:34 in Container image against 4:00.
  - **In pull requests:** 0 of 8 held-out runs exceeded it.

### After a native dependency change

A pull request that changes `native/Cargo.lock` rebuilds the cached native dependency layers. This is measured on the push runs of the two merges #1065 names, each against the warm dispatch that followed on the same commit:

| Run | Container image | Native Linux | Native WASM | Native Windows | Native macOS |
| --- | --: | --: | --: | --: | --: |
| push after #1031 (lock change), [45022042303](https://github.com/mgasca/calendar/actions/runs/45022042303) | 4:51 | 4:30 | 1:00 | 7:22 | 7:44 |
| warm dispatch on the same commit, [45022778825](https://github.com/mgasca/calendar/actions/runs/45022778825) | 2:00 | 1:32 | 1:12 | 2:28 | 1:15 |
| push after #1052 (cache from #1047's lock change), [45606707078](https://github.com/mgasca/calendar/actions/runs/45606707078) | 5:34 | 4:47 | 2:31 | 4:41 | 3:13 |
| new check-path threshold | 3:01 | 2:29 | 2:37 | 4:38 | 6:01 |

- **Cold runs exceed the thresholds:** a cold dependency layer takes Container image, Native Linux and Native Windows past them, and in the first case Native macOS too.
- **How often:** `native/Cargo.lock` changed in 6 of the 36 commits on `main` from 2026-11-19 to 2026-11-27.
- **What it means for a PR:** a pull request that changes it can expect a gate failure on its first run, and the fix is a re-run once `main` has saved the new cache. ADR-0045 already covers this case, because a necessary slowdown regenerates the file in the PR that adds it. A lock change only adds time until the cache is saved, so it is a re-run case, not a re-pin.

## Reading

- **Container image's check-path threshold drops from 4:00 to 3:01.** That is the measured cost of building the WASM bundle from `main`'s warm cache: median 2:01, against 1:23 in record 0030 before the bundle.
- **The four Native jobs are gated on the check path for the first time.**
  - **macOS:** its threshold, 6:01, is the loosest, because macOS runners vary the most (log-MAD 0.198).
  - **Windows:** the slowest job at a median of 3:04, gated at 4:38.
- **Two older thresholds widened:** Frontend (1:35 to 2:16) and Flow binding (0:35 to 0:51). Their medians barely moved (Frontend 1:08 to 1:06, Flow binding 0:18 both times), but their log-MAD roughly doubled: Frontend from 0.061 to 0.128, and Flow binding from 0.118 to 0.182. The other older thresholds moved by 9 s or less, Backend's the most (2:22 to 2:31, with its median up from 1:57 to 2:05).
- **#1065 isn't done:** the publication path still holds #1061's hand-set 4:00 and has no Native entries. Rebuilding it needs 30 successful pushes to `main` since #1038 (11 on 2026-11-27). The maintainer chose on #1065 to pin the check path now and rebuild the publication path in a second PR once there are 30 such pushes.

## Reconsider when

- **Publication path:** 30 successful pushes to `main` exist since #1038. Rebuild the publication path with `--path publication`; that PR closes #1065.
- **Native toolchain or runners:** the Rune pin, the native Rust toolchain or a runner image changes, or a Native job's median moves by more than its margin.
- **False failures:** check-path pull request runs fail the gate on Native jobs more often than ADR-0045's budget allows, outside native lock changes.
