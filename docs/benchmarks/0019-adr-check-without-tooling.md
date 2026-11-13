---
subject: "CI runner time of a story-card-only pull request, before and after the ADR conventions job (issue #572)"
harness: "tools/ci-timings/ci-timings.ts"
---

# 0019 Story-card-only pull requests run the ADR check, not the Tooling job

- **Date:** 2026-11-09
- **Issue:** [#572](https://github.com/mgasca/calendar/issues/572) (epic [#559](https://github.com/mgasca/calendar/issues/559)), story [0051](../stories/0051-sweep-only-what-changed-and-check-each-finding.md), [ADR-0046](../decisions/0046-run-ci-jobs-only-for-the-paths-they-check.md) (amendment of 2026-11-08)
- **Harness:** `just tools ci-timings` for the job and step tables, and the jobs API (`gh api repos/mgasca/calendar/actions/runs/<id>/jobs`, `started_at` to `completed_at`) for the after run.
- **Before:** 26 successful push runs of `ci.yml` on `main`, 2026-11-08 00:01Z to 15:59Z, up to `2d6e1e34f` (`just tools ci-timings --branch main --created ">=2026-11-08T00:00:00Z"`). Also the one run of #567, which changed only `docs/decisions/0044-…`, on 2026-11-08 14:09Z (`--branch docs/adr-0044-amend-scheduled-sweeps --job Tooling`).
- **After:** run 42617811126 of the throwaway draft PR #588, at `6215ede38`. The PR was stacked on #579 and changed only `docs/stories/0038-…`. It ran on 2026-11-09 12:32Z on GitHub-hosted `ubuntu-latest`, then it was closed and its branch deleted.

## Question

[#569](https://github.com/mgasca/calendar/pull/569) made a change under `docs/stories/`, or to the architecture model, start the whole Tooling job. The reason is that `check-adr` reads those files. Tooling also runs every tool test app, `just infra integration` against PostgreSQL in Docker, the pin check and the just-format checks. Since 2026-08-01, 148 of the 318 commits on `main` touched `docs/stories/`. How much runner time does a card-only pull request spend once a small ADR conventions job runs the check instead?

## Before (measured)

| Sample | n | min | median | p90 | max |
| --- | --: | --: | --: | --: | --: |
| Tooling, push runs on `main` | 26 | 0:58 | 1:22 | 3:37 | 5:19 |
| Tooling, #567 (one ADR file) | 1 | 1:01 | 1:01 | 1:01 | 1:01 |

- In #567's Tooling run, the step "ADRs follow conventions" took 2 s, `just tools test` 30 s, `just infra integration` 15 s and setup-dotnet 6 s.
- The pinned baseline in `.github/ci-baseline.json` gives Tooling a median of 79 s on both paths (check n = 30, publication n = 48).
- No card-only pull request ran CI between #569's merge and this change (#566 merged before #569). The before cost of a card-only PR, about 1:01 to 1:22 of Tooling on top of Docs site, is therefore **inferred** from these samples. No such run was measured.

## After (measured, one run)

| Job | Result | Time |
| --- | --- | --: |
| Changes | success | 0:09 |
| Docs site | success | 2:11 |
| ADR conventions | success | 0:24 |
| Tooling, Backend, Frontend, Container image | skipped | – |
| CI result | success | 0:08 |

Steps of ADR conventions: set up job 1 s, checkout 1 s, setup-dotnet 2 s, `dotnet run .claude/skills/adr-draft/scripts/check-adr/check-adr.cs` 12 s (cold compile and the check), post setup-dotnet 4 s (it saved the NuGet cache, which this first run had missed), complete job 1 s.

The run-time gate printed `ADR conventions has no baseline on the publication path; it is not gated until the next baseline update.`. Pushes and dispatches run the job from #579 on, so the next re-pin can baseline it.

## Result

- **Runner time** of a card-only pull request falls by the Tooling job's time minus ADR conventions' time. The ADR conventions side is 0:24, measured on one cold run. Against Tooling's medians that is a saving of about **0:37** (#567's 1:01) to **0:58** (`main` median 1:22) per such PR. The saving is inferred, because the before side was not measured on a card-only PR.
- **Wall clock** does not change. Docs site (2:11) is the longest job on this path and runs in parallel with ADR conventions, as it did with Tooling.
- **Cost on `main`:** each push and dispatch now runs ADR conventions as well, about 0:24 of extra runner time. The maintainer accepted this so that ADR-0045 can gate the job (#579).
- The comparison is not an alternating A/B session. The before and after sides come from different runs on different days, and the after side is n = 1. A warm NuGet cache should take a few seconds off later runs. That is inferred, not measured.

## Reconsider when

- ADR conventions' baseline median, once it is pinned, exceeds about 45 s.
- `check-adr` gains a dependency that only Tooling sets up.
- A new input of `check-adr` is added outside `docs/decisions/`, `docs/stories/` and the model. Add it to `adr_inputs` in `.github/ci-changes.jq`.
