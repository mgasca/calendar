---
status: implemented
date: 2026-11-06
issue: https://github.com/mgasca/calendar/issues/342
pr:
  - https://github.com/mgasca/calendar/pull/343
  - https://github.com/mgasca/calendar/pull/344
adrs: ["0017", "0042"]
---

# 0033 Review how long delivery automation makes us wait

## Story

> As a maintainer, I need a repeatable performance review of the automation that delivers our changes (CI, task-runner recipes, tests, builds and the agent sessions that drive them), so that I find out what we wait for and why, with measured evidence, without rediscovering the method each time.

Tracked in issue #342.

## Background

Epic #272 began with one request: the Frontend CI job was slow, so sample its history, analyse the job, the frontend recipes and the tests, and report. The agent session that did it sampled 40 runs, found that four Astro content syncs took about 175 s of a 266 s job, and instrumented the docs loader. The loader re-read the whole corpus once per rendered page, 110 times per sync. The report became an epic with four children, each delivered with its own benchmark record. The Frontend job fell from a 4:28 median to 0:53 ([0002](../benchmarks/0002-frontend-ci-job.md), [0007](../benchmarks/0007-frontend-ci-job-after.md)).

The method exists only in that session's transcript, so the next review would start from nothing. That includes the Backend job, which is now the critical path. Some of the method went wrong along the way, and those lessons matter as much as the parts that worked. A probe edit failed because the shell had drifted into another directory. A benchmark overran its 10-minute budget. Dispatched CI runs were cancelled by the concurrency group. One sample mixed runs from before and after a change. Three of four children merged without `Closes #N`.

The `performance-reviewer` agent reviews a branch's diff, read-only, in a fresh context. This story covers what that agent does not: starting from history rather than a diff, measuring over minutes, and turning findings into tracked, measured work. It builds on the benchmark conventions in `docs/benchmarks/README.md` and the `ci-timings` harness from #272. It hands delivery to the existing `issue-handover` skill and the `epic-delivery` skill ([0028](0028-coordinate-epic-delivery-across-agent-sessions.md)).

### Agreed scope

Agreed with the maintainer on #342. The answers were given in conversation and recorded on the issue.

* **A skill that orchestrates, and a read-only agent for the static pass:** the skill `delivery-performance-review` (`.claude/skills/`) runs in the session that invokes it, because the review needs long measurements, a scratch worktree for probes, and (on request) issue and PR writes. The agent `delivery-performance-reviewer` (`.claude/agents/`) reads workflows, recipes, test and build configs and CI history in a fresh context and returns hypotheses with invocation counts and evidence marks, so the file dumps stay out of the orchestrating session. The agent never edits, probes or posts.
* **Five surfaces:** CI workflows, task-runner recipes, test suites, builds and publication, and agent delivery loops (watch wake-ups that need no action, CI runs dispatched only to measure, waits on checks). Backend and frontend alike.
* **Three modes, report first:** `report` (default) writes nothing outside a scratch directory or worktree. `issues` files an epic and one child per opportunity, each child stating its baseline. `deliver` forks to `epic-delivery`, which hands the children to `issue-handover`. A request only to deliver an epic filed earlier runs `epic-delivery` in the session that receives it; this was amended after #347. The skill always reports first and files only when the maintainer says so after reading the report, even when the invoking prompt names a mode. Merges stay with the maintainer.
* **Two lenses, kept apart:** latency (the critical path of a run, what a person waits for) and compute (the sum of job time per run). A change can improve one and worsen the other.
* **Evidence rules:** every number says whether it is measured or inferred, and gives its sample (runs, commits, window, machine). A sample is filtered by head commit. A bimodal sample is checked for runner hardware before it is blamed on code. Interacting changes are measured together at the end.
* **Cost of measuring:** the report states how many CI runs a proposed after-measurement would dispatch, and sizes the sample from the spread it observed.
* **Stopping rule:** a target that is no longer on the critical path stops earning latency. The report says so rather than ranking more savings there.
* **Lessons recorded with their source:** each rule the skill takes from #272 cites the record, issue or PR that shows it, so a reader can check it.
* **Evals:** at least two cases in the skill's `evals/`, in the format `dream-weaver` uses. One checks that `report` writes nothing. One checks that a report names the critical path, both lenses, the evidence basis of each number and a baseline for each opportunity.

### Not in this story

* **Changing `issue-handover`:** epic #318 and its children own that file. #322 moves its performance section to `docs/benchmarks/README.md`, and this skill points there.
* **New repo tooling:** the skill uses `just tools ci-timings` as it is. A queue-time or critical-path option for that tool would be a follow-up issue (ADR-0017 tooling).
* **Running a review:** reviewing today's pipeline, the Backend job included, is a later use of the skill, not part of building it.
* **Gating CI on timings:** records stay evidence, not gates, as `docs/benchmarks/README.md` says.
* **Changing `performance-reviewer`:** it stays the diff reviewer. The skill names it as the tool for reviewing a delivery PR's diff.

### Acceptance criteria

1. **Given** a request to review CI, recipes or tests for speed with no mode named, **when** the skill runs, **then** it produces a report and runs no command that writes to GitHub or to the checkout, keeping probes in a scratch directory or worktree.
2. **Given** a review, **when** the skill needs the static pass over workflows, recipes and configs, **then** it delegates it to the `delivery-performance-reviewer` agent, which returns findings with evidence marks and makes no edit, probe or post.
3. **Given** a request that names the `issues` mode up front, **when** the skill finishes its report, **then** it asks before filing anything.
4. **Given** a sample of CI runs, **when** the report gives timings, **then** it names the critical path of a run and reports latency and compute separately, each number marked measured or inferred, with its sample size, window and commits.
5. **Given** a sample whose durations fall into two clusters, **when** the report explains them, **then** it checks a step the code under review does not touch, as a control, before it attributes the difference to code.
6. **Given** an opportunity in the report, **when** it is listed, **then** it has a baseline quantity, a predicted saving with its basis, the critical-path effect, and the proof a fix would need (a test that fails without it, and a benchmark record).
7. **Given** a request for issues, **when** the skill files them, **then** each child carries its baseline, and the delivery brief for each child tells its PR to carry `Closes #N` against `main`.
8. **Given** a proposed after-measurement, **when** the report describes it, **then** it states how many CI runs it would dispatch and dispatches none in `report` mode.
9. **Given** the skill, **when** a reader checks a rule taken from #272, **then** the rule cites the benchmark record, issue or PR that shows it.
10. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0042](../decisions/0042-layered-agent-guidance-and-hooks.md) | Layer agent guidance by scope | The review procedure is on-demand, so it belongs in a skill, not in root guidance or a hook. |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | Repo tooling as .NET file-based apps | Any harness the skill needs beyond `ci-timings` is a .NET tool in a follow-up, never a shell or Python script in the skill. |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **A skill and an agent, split by what each does well:** an agent runs in a fresh context with a fixed tool set and returns a report, which suits reading many files without flooding the caller and judging them without the caller's hypothesis. It does not suit measuring for minutes, probing code or filing issues. So the agent reads and the skill measures, decides and hands off. The maintainer chose this split on #342 over a skill alone.
* **Report before filing, always:** the maintainer chose asking before filing over filing whenever the prompt names a mode. A report can show that the target is off the critical path, and then the right number of issues is zero.
* **Modes like `dream-weaver`:** report by default, writes only when asked. A review that files issues unasked would create work nobody accepted.
* **Agent loops count as delivery automation:** in the #272 session, 13 of 80 assistant messages acknowledged the session's own posts or nothing new, and at least 13 CI runs were dispatched only to measure. Those are real costs of how we deliver, and no other review looks at them.

## Implementation notes

Delivered in #344, stacked on the card PR #343.

### Where things live

| Area | Location |
| --- | --- |
| Skill (steps, modes, honesty rules, limits) | `.claude/skills/delivery-performance-review/SKILL.md` |
| Static-pass agent | `.claude/agents/delivery-performance-reviewer.md` |
| Sampling, statistics, lenses, A/B, dispatching | `.claude/skills/delivery-performance-review/references/measurement.md` |
| The #272 case study and the evidence for each rule | `.claude/skills/delivery-performance-review/references/case-272.md` |
| Report shape | `.claude/skills/delivery-performance-review/references/report-template.md` |
| Eval cases | `.claude/skills/delivery-performance-review/evals/` |
| Reviewer-subagent line | `AGENTS.md` ("Testing principles") |

### API

No changes.

### Testing

`claude plugin eval` was not installed where this was built, so the eval cases were exercised as scenario runs. A fresh agent was given only the skill and the case prompt, not the graders or the author's conclusions, and its answer was graded against the case's graders by hand. Results are on #344.

| Case | Run | Result |
| --- | --- | --- |
| [bimodal-sample-is-checked-against-a-control](../../.claude/skills/delivery-performance-review/evals/bimodal-sample-is-checked-against-a-control/case.yaml) | offline, synthetic fixture | both graders pass: control steps checked before blame, the revert advised against, the critical path worked out per cluster with its uncertainty |
| [report-mode-is-read-only](../../.claude/skills/delivery-performance-review/evals/report-mode-is-read-only/case.yaml) | live, read-only review of `ci.yml` on `origin/main` 3c3304d1, 40 runs | all five graders pass: no writes or dispatches, critical path and both lenses, every number with its basis, static pass delegated without a hypothesis, Not covered and the review's cost |
| [names-the-mode-but-reports-first](../../.claude/skills/delivery-performance-review/evals/names-the-mode-but-reports-first/case.yaml) | not run | not exercised |

Acceptance criteria against that evidence:
- Criteria 1, 2 and 4–6, 8 and 9 are covered by the two runs above. For criterion 2 the static pass ran as a general-purpose agent with the agent file's body, because a new agent type is registered only in later sessions.
- Criterion 3 has a case that was not run.
- Criterion 7 (filing) was not exercised: no issues were filed from either run.
- Criterion 10's result for the final revision is recorded on #344.

### Lessons learned, known issues and follow-ups

* **The live test found what the case study could not.** About one PR run in five waited 20–85 s before its first job started. A new push had cancelled the previous run, but that run kept going until its `if: always()` result job had finished. Pushing several commits a minute apart is the agent-loop habit behind it. The skill now counts this from CI history, with no transcript needed.
* **`just tools ci-timings` splits quoted job names** (`--job "Docs site"`). Filed as #345; the skill and the agent give the direct `dotnet run` form until it is fixed.
* **A new agent type is not available in the session that adds it.** The skill says to fall back to a general-purpose agent with the agent's body, and to say so.
* **The live run is itself a review of today's pipeline.** Job medians are within a few seconds of record 0007, and Backend (1:55) is the critical path in 37 of 40 runs. It found four opportunities: the superseded-run wait; serial API test classes with two database resets per case; `dotnet format` repeating the build's analyzer pass; and a Tooling job without a NuGet cache. They are reported on #344 but not filed, because the skill files only when asked.
* **The first delivery had to ask eight questions.** The four findings were filed as epic #347 (#348–#351). The session that delivered it, without having run the review, had to ask who coordinates, how to group the children into sessions, whether a story card was needed, how to shape PRs that share `ci.yml`, whether the CI budgets and a throwaway-branch negative control were approved, how to launch the workers, and how to send alerts. The answers are recorded on #347. Six of them became the skill's delivery-plan defaults: coordination, grouping, durable record, PR shape, CI budget and negative controls. The skill files that plan on the epic, so the next delivery can start without asking. The launcher and alerts stay out of the skill: the launcher depends on the session tools at hand, which `epic-delivery` already covers, and alerts are the maintainer's preference.
* **One case study.** The rules come from one epic, as the skill's Limits section says. Revise them when a review contradicts them.

## User guide

Ask: **Use delivery-performance-review on the CI pipeline** (or on the backend tests, the `just` recipes, or the agent watch loop). The skill samples recent runs, reads the workflows, recipes and test setup, probes what it suspects, and reports: what a run costs and what you wait for, where the time goes, and the opportunities in order with the evidence each one rests on. Nothing is filed until you ask. Say **file issues** to get an epic with one child per opportunity, or **deliver** to have the children taken through to merged, measured PRs.
