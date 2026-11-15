---
subject: "CodeQL rust analysis on main and on pull requests after epic 881: reuse of the base result, cached extractor builds, and no larger runner"
harness: "tools/ci-timings/ci-timings.ts"
---

# 0029 CodeQL rust analysis after epic #881

- **Date:** 2026-11-15
- **Epic:** [#881](https://github.com/mgasca/calendar/issues/881). Its three children and their records:
  - [#882](https://github.com/mgasca/calendar/issues/882), skip the rust analysis on pull requests without Rust input: record [0026](0026-codeql-rust-analysis-on-pull-requests-without-rust-input.md), delivered by #904 (`aee34abce`).
  - [#883](https://github.com/mgasca/calendar/issues/883), cache the extractor's cargo state: record [0027](0027-codeql-rust-extractor-cargo-caches.md), delivered by #905 (`015cbf7e0`) and #906 (`7c4f1c37c`).
  - [#884](https://github.com/mgasca/calendar/issues/884), larger runner: record [0028](0028-codeql-rust-analysis-on-a-larger-runner.md). Closed on evidence, it **contributes no change**.
- **Harness:**
  - **Jobs API:** `gh api repos/mgasca/calendar/actions/runs/<id>/jobs`, `started_at` to `completed_at` for the `Analyze (rust)` job and its steps. This is the quantity of the epic's table, which `just tools ci-timings --workflow CodeQL --job "Analyze (rust)"` tabulates.
  - **Job logs:** `gh run view --job <id> --log`, for the extractor's `total duration (…)` lines and the reuse step's message.
  - **Time to the last required result:** from the CodeQL run's `created_at` (the push) to the later of the `CI result` check's `completed_at` and the CodeQL run's `updated_at`. The CodeQL check run itself completes before the rust job on a full analysis, so its timestamp is not used.
  - **Runners:** GitHub-hosted `ubuntu-latest`, 4 CPUs.
- **Before:** the epic's table (40 runs of all events, 2026-11-13), plus a push-only baseline: the 10 latest successful `codeql.yml` push runs on `main` before #905 merged (2026-11-13 23:51Z to 2026-11-14 11:09Z).
- **After:** the first 10 successful `codeql.yml` push runs on `main` from `7c4f1c37c` (#904 and #906 merged), sampled by head commit. Also every successful `codeql.yml` pull-request run pushed after 11:20Z on 2026-11-15. The window that excludes is explained under "Excluded window".

## Question

Did the epic shorten the CodeQL rust job, the long pole before merge? By how much for pull requests with and without Rust input, and what does the job now cost on `main`?

## Pull requests (measured)

| Pull request kind | Runs | `Analyze (rust)` | Push to last required result | Long pole |
| --- | --: | --: | --: | --- |
| Before, every pull request (the epic's table, all events) | 40 | median 6:04 (4:34–7:31) | about 6 min (CodeQL), against about 2:14 for CI | CodeQL rust |
| After, no Rust input: main's result reused | 9 | **14–22 s** | median **2:03** (1:12–3:55) | CI; the CodeQL run finished 66–91 s after the push |
| After, backend change: full analysis | 6 | 5:20–6:53 | median **6:51** (5:33–7:06) | CodeQL rust |

Runs after, no Rust input (head, CodeQL run, last required result):
- `369594012`, 43708810499, 2:07
- `6924149e1`, 43708734445, 2:02
- `8ac96f2a6`, 43709138720, 1:12
- `72ef06e88`, 43709672459, 1:54
- `7376f225a`, 43709859620, 2:07
- `9558d6c83`, 43710195821, 2:03
- `64782279a`, 43711423399, 3:55
- `fa2b90643`, 43711708393, 2:12
- `8342c58f1`, 43711706828, 1:45

Runs after, backend (head, CodeQL run, last required result):
- the Rust 1.100 toolchain bump (#789): `676b9886d`, 43708665828, 7:04; `5678306b9`, 43709577207, 5:38; `2ccfc353f`, 43710167708, 7:06; `9ea4407e5`, 43710794784, 6:57
- #928: `febd3bcf6`, 43709678720, 5:33; `e217fc724`, 43710203390, 6:45

- **Without Rust input** (measured): the rust entry looks up main's result and uploads it in about 15 s, and the CodeQL check reports success ("No new alerts in code changed by this pull request"). The pull request now waits on CI, about 2 minutes, instead of about 6 on CodeQL. Before the epic, 23 of 40 pull requests changed no Rust input (epic #881).
- **With a backend change** (measured): the rust analysis still decides when the pull request can merge, at about 7 minutes from the push. The warm caches make it start faster (below), but query evaluation is unchanged, and it stays CPU-bound on 4 cores (record 0028).

## Push runs on main (measured)

| Push runs | n | `Analyze (rust)` median | min–max | LoadManifest |
| --- | --: | --: | --: | --: |
| Before #905 (runs 43530213235 to 43588633274) | 10 | **7:12** | 5:00–7:23 | 25–50 s (the epic's 14 logs) |
| After #904 and #906 (below) | 10 | **6:08** | 4:19–6:47 | **1.4–3.0 s** |

The before runs, with job seconds: 43530213235 442, 43531016230 434, 43580388097 443, 43581741771 363, 43582675625 437, 43583987117 302, 43584526895 434, 43585014156 318, 43587048898 431, 43588633274 300.

| Run | Job | Head | Job | LoadManifest | ExtractLibrary | Extraction |
| --- | --- | --- | --: | --: | --: | --: |
| 43703032036 | 132778101841 | `7c4f1c37c` | 5:42 | 2.3 s | 34.0 s | 1:19.1 |
| 43703566424 | 132779740205 | `a31b972db` | 6:31 | 2.3 s | 41.5 s | 1:33.7 |
| 43704205612 | 132781697970 | `aebdb39c4` | 6:38 | 2.7 s | 42.4 s | 1:33.7 |
| 43704779473 | 132783430148 | `6f535beb4` | 6:43 | 3.0 s | 41.8 s | 1:34.3 |
| 43708883118 | 132795948586 | `6900ee2e6` | 5:45 | 2.4 s | 34.5 s | 1:20.5 |
| 43709557760 | 132797978176 | `0f98826fd` | 5:18 | 1.4 s | 32.2 s | 1:14.6 |
| 43709832163 | 132799283251 | `304bbde5a` | 6:47 | 2.7 s | 42.9 s | 1:35.4 |
| 43710771665 | 132801630964 | `f8359183e` | 5:17 | 2.1 s | 31.5 s | 1:14.3 |
| 43710817392 | 132802940396 | `aafa7644c` | 4:19 | 2.1 s | 22.9 s | 0:58.9 |
| 43711465417 | 132803998809 | `c22618111` | 6:47 | 3.0 s | 42.6 s | 1:35.4 |

- **Caches** (measured): every after run restored the extractor's target directory, in 1–3 s, and the registry, in 1–2 s. LoadManifest stayed at 1.4–3.0 s, against 25–50 s before. That is the saving of record 0027, about 25–45 s per run.
- **Job** (measured): the median fell by 64 s, from 7:12 to 6:08. Ten runs on each side over a runner pool with two speed groups is a small sample. ExtractLibrary alone ranged from 22.9 to 42.9 s, so the effect is real but smaller than the spread.
- **Coverage** (measured): every after run had 121 inputs. The two extra inputs since record 0027 came from changes on `main`.
- **Extra run:** dispatch run 43708441515 on `03d5e42f4` (job 132794584732), used to confirm uploads after the switch back below, took 5:16 with a LoadManifest of 1.3 s. It is not in the push medians.

## When a pull request without Rust input still gets the full analysis (measured)

Main's result is reused only from a commit that `main` has already analysed. The commit must be the merge base or one of its ancestors, and its files up to the pull request's head must change no Rust input. Two cases fall back to the full analysis, which is the conservative outcome:
- **Right after a Rust-input merge:** for about 6 minutes after a commit that changes Rust input lands on `main`, its analysis is still running. A pull request based on it then finds no match. Two runs show it:
  - #926 (job 132781049876) was based on `a31b972db` (#889), which `main` analysed from 10:20:08Z to 10:26:48Z.
  - #925 (CodeQL run 43710892168) was based on `f8359183e` (#928), analysed from 11:49:27Z to 11:54:53Z.

  Both lookups logged "rust: no analysed main commit has these Rust inputs; running the full analysis."
- **`backend/**` documentation is Rust input:** the Backend set of `.github/ci-changes.jq` is a prefix set. So #889's change to `backend/AGENTS.md` made the Rust analysis run, as did its change to `.github/ci-changes.jq`, one of the rule files.

## A configuration on main that a pull request lacks blocks the merge (measured)

The probe of record 0026 found this for a missing `/language:rust` analysis. It happened twice more during delivery:
- **After #889 removed .NET** (`a31b972db`): `main` kept its `/language:csharp` configuration, so every pull request's CodeQL check was neutral, "1 configuration not found", and pull requests to `main` read BLOCKED. Removing a CodeQL language therefore needs its configuration deleted on `main` too (`DELETE /code-scanning/analyses/{id}?confirm_delete=true`, newest first).
- **During the default setup** (below): its own configurations (`dynamic/github-code-scanning/codeql:analyze`) were left on `main` afterwards.

On 2026-11-15, with the maintainer's approval, those four stale configurations were deleted from `main`. That was the csharp one (30 analyses) and the three of default setup (1 analysis each), all with 0 results, while no alert was open. `main` now holds only `codeql.yml`'s actions, javascript-typescript and rust configurations. The first pull-request run afterwards, #929 (`369594012`), reported success, not neutral.

## Excluded window (measured)

- **10:48Z:** CodeQL default setup was turned on. Its first run was 43705843373 on `main`. While it was on:
  - `codeql.yml` was disabled (workflow state `disabled_manually`), so pushes started no `codeql.yml` run after 10:44:53Z;
  - code scanning rejected an advanced upload: job 132785672639 on #928 failed with "analyses from advanced configurations cannot be processed when the default setup is enabled".
- **The switch back:** the maintainer decided to turn default setup off (state `not-configured`). `codeql.yml` was re-enabled at 11:20Z.

No run between 10:48Z and 11:20Z, and no default-setup (`dynamic`) run, is in this record's samples. That covers the one on #789 at 11:14:40Z too.

## Findings

- **Pull requests without Rust input** (measured): the wait for CodeQL fell from about 6 minutes to 66–91 s, and CI is now the long pole, at about 2 minutes. This was the epic's biggest predicted saving, and it is delivered.
- **Backend pull requests** (measured): still about 7 minutes, decided by the rust analysis. The cached extractor builds remove 25–45 s of LoadManifest. Query evaluation is unchanged, and #884 found no larger runner available to this repository.
- **Push runs on main** (measured): median 7:12 before, 6:08 after, n = 10 each. LoadManifest is consistently 1.4–3.0 s.

## Proposal: a run-time gate for CodeQL

`.github/ci-baseline.json` gates only `ci.yml` ([ADR-0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md)). A CodeQL gate would catch a regression of records 0026 and 0027: a reuse that stops matching, or caches that stop restoring.
- **Not yet:** the rust job now has two paths, reuse at about 15 s and full analysis at about 5–7 minutes, and ADR-0045 needs 30 runs per path. The full path also spreads widely with the runner groups.
- **Suggested shape:** two paths, keyed on whether the `Upload main's Rust result` step ran (as the Docs site job is keyed on its publication step). Baseline it from 30 runs per path on `main`.
- **Until then:** the mechanism guards `codeql-rust-gate` and `codeql-rust-caches` in `tools/delivery-guards` protect both mechanisms.

## Decision and reconsideration

Keep all three outcomes: the reuse (#882), the caches (#883), and the standard runner (#884). Reconsider when:
- backend pull requests become the larger share of pull requests, or their wait on the rust analysis matters more than CI's;
- the reuse falls back more often than the post-merge window explains (watch the reuse step's message in the job summary);
- a warm LoadManifest on `main` exceeds 10 s;
- the repository moves into an organization (record 0028).
