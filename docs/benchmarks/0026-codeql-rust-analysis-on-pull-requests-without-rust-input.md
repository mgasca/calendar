---
subject: "Skipping the CodeQL rust analysis on pull requests that change no Rust input, and how the code scanning merge rule of the main ruleset treats the missing analysis (issue #882)"
harness: "tools/ci-timings/ci-timings.ts"
---

# 0026 CodeQL rust analysis on pull requests without Rust input

- **Date:** 2026-11-14
- **Issue:** [#882](https://github.com/mgasca/calendar/issues/882), epic [#881](https://github.com/mgasca/calendar/issues/881); [ADR-0046](../decisions/0046-run-ci-jobs-only-for-the-paths-they-check.md), story [0038](../stories/0038-run-ci-jobs-only-for-the-paths-they-check.md)
- **Harness:**
  - **Baseline:** `just tools ci-timings --workflow CodeQL --job "Analyze (rust)" --runs 40`.
  - **Probe:** the merge state of throwaway PR [#896](https://github.com/mgasca/calendar/pull/896), polled every 15–60 s with `gh pr view --json mergeStateStatus,statusCheckRollup`. Also polled: `main`'s head (`gh api repos/mgasca/calendar/branches/main`), the check runs of each head (`gh api repos/mgasca/calendar/commits/<sha>/check-runs`), and which contexts are required (GraphQL `CheckRun.isRequired`).
  - **Runners:** GitHub-hosted `ubuntu-latest`.
- **Before:** the epic's sample. 40 successful CodeQL runs, 2026-11-13, `pull_request` and `push`. 23 of the last 40 PRs changed nothing under `backend/` (`gh pr list --json files`).

## Question

On a pull request, can the rust analysis be skipped when the PR changes no Rust input? And can such a PR still merge under the `code_scanning` rule of `.github/rulesets/main.json`? GitHub's docs say only that the rule blocks while a required tool's analysis "is still in progress". They do not say what happens when one category (`/language:rust`) has no analysis at all on the PR head, while `main` has one.

## Baseline (measured, from the epic)

| Quantity | n | median | p90 |
| --- | --: | --: | --: |
| Analyze (rust), all events | 40 | 6:04 | 7:11 |
| Analyze (csharp), next longest CodeQL job | 40 | 1:38 | 2:05 |
| CI critical path (Changes plus the slowest filtered job) | 40 | ~2:14 | |

## Probe (measured, 2026-11-14)

**Setup:** throwaway PR #896 against `main` changed one docs README (an HTML comment). Its CodeQL matrix had no `rust` entry, so the head got analyses for `csharp`, `javascript-typescript` and `actions` only. The PR is closed and its branch is deleted.

| Head | CodeQL run | CI run | What changed | CodeQL check | Merge state, all checks complete |
| --- | --- | --- | --- | --- | --- |
| `7561388d1` | 43583856991 | 43583856900 | docs comment, no rust analysis | neutral, "1 configuration not found: `/language:rust`" | BEHIND (`main` had moved) |
| `fd115a3e7` | 43584062153 | 43584062197 | the same, updated from `main` | neutral, as above | **BLOCKED** from 10:13:51Z (last check done) to at least 10:16:30Z, then BEHIND at 10:18:32Z when `main` moved |
| `386ee478f` | 43584745310 | 43584745326 | the same, updated again | neutral, as above | BLOCKED while checks ran, BEHIND at 10:23:17Z before they finished |
| `f406b09ba` | 43585573007 | 43585573143 | the same, updated after `main`'s own CodeQL run (43585014156, head `dd1e132f1`) had completed | neutral, as above | **BLOCKED** from 10:32:10Z (last check done) to at least 10:34:59Z, with `main` unchanged |
| `1cb2d3323` | 43586039499 | 43586039550 | control: rust analysis restored | success | BLOCKED while `Analyze (rust)` ran, then **CLEAN** at 10:43:01Z, 17 s after the CodeQL check turned success |

- **Merge rule** (measured): with every check complete, `CI result` green (the only required status check, `isRequired: true`) and `main` unchanged, a PR head without a `/language:rust` analysis stays **BLOCKED**. On heads `fd115a3e7` and `f406b09ba` it stayed blocked for more than 2.5 minutes. With the rust analysis present, the same PR went CLEAN as soon as it finished. The only other difference between those heads was the matrix. So the `code_scanning` rule blocks a missing configuration of a required tool: it waits for it as if it were in progress.
- **The CodeQL check** (measured): it is neutral, with the title "1 configuration not found" and a warning that code scanning "cannot determine the alerts introduced by this pull request". It is not a required check (`isRequired: false`); the block comes from the ruleset rule.
- **`CI result`** (measured): unaffected. It passed on every head, with Backend, Frontend, ADR conventions, Narratives and Container image skipped as for any docs change.
- **A misleading counter-example:** open PR #889 also lacks one category (`/language:csharp`) and read CLEAN during the probe. But its base is `migration/deno-runtime`, not `main`, so the `main` ruleset does not apply to it.
- **Base analyses** (measured): `main` keeps a rust analysis for every push (for example analysis 2167133475 on `dd1e132f1`: CodeQL 2.27.4, 0 results, 28 rules). Its SARIF downloads through `GET /code-scanning/analyses/{id}` with `Accept: application/sarif+json` (113 KB). No code-scanning alert was open on 2026-11-14.

## Finding

Skipping the rust analysis with a matrix exclude, a workflow `paths` filter or a job-level `if` saves about 4 minutes of waiting on CodeQL in principle. In practice the PR then cannot merge at all, because the `code_scanning` rule waits for the missing `/language:rust` analysis indefinitely. A shape that skips the analysis must still upload a result for the category, or change the rule. Per the epic's go-ahead, the choice goes back to epic #881 for the maintainer. Until that decision, no gate merges.

## Decision and reconsideration

Pending the maintainer's choice on epic #881. The after-quantities (time to mergeable on 3 non-Rust PRs and 2 backend PRs) are added to this record once a shape is chosen and delivered. Reconsider if GitHub documents, or changes, how the `code_scanning` rule treats a missing configuration.
