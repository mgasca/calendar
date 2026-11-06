---
name: delivery-performance-review
description: Review how long the delivery automation makes people wait and what it costs, from measured history rather than a diff. Covers CI workflows (jobs, steps, critical path, queue, repeated work), task-runner recipes and the local loop, test suites, builds and publication, and the agent sessions that drive delivery (watch wake-ups, CI runs dispatched only to measure). Samples CI, delegates the static pass to the delivery-performance-reviewer agent, probes suspects in a scratch worktree, and reports opportunities with baselines, critical-path effect and the proof each fix needs. Report-only by default; files an epic and children, or hands them to delivery, only when asked after the report. Use when the user says CI, a job, the build, the tests, `just check` or a recipe is slow, asks where pipeline time goes, wants run-time history sampled, or asks for a performance review of CI, delivery or the agent workflow, even without the word "performance". For a branch's diff use the performance-reviewer agent instead.
---

# Delivery performance review

The pipeline that delivers a change is code too, and it gets slower in the same ways an application does: work repeated per item, cost that grows with history, fixed overhead paid many times. It's easy to miss because nobody runs it on purpose. This skill makes the review repeatable. It turns "CI feels slow" into numbers people can check, a mechanism, and a short ordered list of changes, each with the evidence a fix would have to produce.

The method comes from the review behind epic #272. That review took the Frontend job from a 4:28 median to 0:53, and some of its mistakes were as instructive as its findings. [references/case-272.md](references/case-272.md) tells that story and cites the record, issue or PR behind each rule below. [references/measurement.md](references/measurement.md) holds the sampling and statistics. [references/report-template.md](references/report-template.md) is the report's shape.

## Terms

- **Run**: one execution of a workflow. **Wall clock** is from the run's creation to its last job finishing.
- **Critical path**: the chain of jobs that decides the wall clock: the longest `needs` chain, plus the slowest job of each parallel layer. Shortening any other job saves compute, not waiting.
- **Latency lens**: what a person waits for. That is the critical path, plus queue time before the first job starts.
- **Compute lens**: the sum of job durations in one run (runner minutes). Take it per run and then the median, not as a sum of job medians.
- **Baseline**: a quantity, its value, how it was measured (harness, sample, statistic) and the commit or window. A baseline that lacks any of these is incomplete.
- **Measured / inferred**: measured means a command produced the number and the report names the command. Inferred means it came from reading code or arithmetic. Every number in the report carries one of the two.

## Inputs and modes

From the request: the surfaces (default all five below), a focus (a workflow, job, recipe or suite), and the mode. Ask only about what changes the review.

| Mode | Triggers | May write | Output |
| --- | --- | --- | --- |
| `report` (default) | No mode named | Only a scratch directory and a scratch worktree, removed at the end | The report |
| `issues` | "file issues", "make an epic", after the report | One epic and one child issue per accepted opportunity | Report plus issue links |
| `deliver` | "deliver", "take them to merge", after the report | Through `issue-handover` or `epic-delivery` only | Report, issues, PRs |

**Report first, always.** Even when the request names `issues` or `deliver`, finish the report, then ask before filing. The maintainer decided this on #342. A report can show that the slow thing is off the critical path, and then the right number of issues is zero. Merges stay with the maintainer.

## Surfaces

| Surface | Look at |
| --- | --- |
| CI workflows | job and step durations, critical path, queue time, per-job fixed cost, repeated work across steps, caches, concurrency groups |
| Task-runner recipes | the local loop people run (`just check`, `just <module> dev` start-up, `just test`), and where recipes duplicate or diverge from what CI runs |
| Test suites | environment set-up per file, long-pole tests, contention when suites run concurrently, log noise (warnings, unhandled requests) |
| Builds and publication | the same input built or synced more than once per run, and work that grows with the repository's own content (pages, ADRs, stories, migrations) |
| Agent delivery loops | pushes that cancel a run already in progress (and make the next one wait), wake-ups that need no action (own posts, bot previews, empty checks), CI runs dispatched only to measure, idle waits on checks, usage-limit stalls |

## Steps

### 1. Frame the question

Write down what someone waits for and how often: "a PR author waits for CI result, about 40 runs a day" (#272's baseline had 40 runs in about 19 hours). Read `docs/benchmarks/README.md` and the records that touch the surface. Each record says what was measured and when to reconsider. A previous review's reconsideration condition tells you whether this one is due.

### 2. Baseline from history

Run `just tools ci-timings --job <name>` (repeat `--job`; `--branch`, `--runs`, `--workflow` narrow it) and keep its tables unchanged for the record. For a job name with a space, run the harness directly, `dotnet run tools/ci-timings/ci-timings.cs -- --job "Docs site"`: the recipe splits quoted arguments (#345). Then, per [references/measurement.md](references/measurement.md):

- Name the critical path from the job table and the workflow's `needs`. If the slow job isn't on it, say so first.
- Compute both lenses. Get queue time from the jobs API (`created_at` against `started_at`). The harness doesn't report it, so mark it as sampled by hand.
- Check the sample: only successful runs, the mix of events, and the commits it spans. If durations fall into two clusters, compare a control step the code doesn't affect before blaming code. In #272 the fast cluster was faster runner hardware.

### 3. Static pass: delegate it

Launch the `delivery-performance-reviewer` agent with a brief. An agent type added during a session is registered only in later sessions. Until then, launch a general-purpose agent whose prompt is the agent file's body plus the brief, and say that you did. Write a brief that names the surfaces, the focus, the commit, and whether it may sample CI. Don't hand it your hypothesis: its value is a read that isn't anchored on yours. While it runs, don't read the same files yourself. Do the history work of step 2, or the agent-loop work of step 5. When it returns, treat each hypothesis marked *inferred* as a lead to confirm in step 4, not as a finding.

### 4. Confirm by counting, in a scratch worktree

Pick the two or three leads with the largest critical-path effect and confirm their mechanism with a count before you time anything: calls per run, files parsed per call, environments created per suite. A count proves a mechanism. A timing on a busy machine only suggests one.

- Probe in a scratch worktree made from the reviewed commit (`git worktree add --detach <scratch>/probe <commit>`), never in the checkout under review. Use absolute paths, because a `cd` that carries over between commands is how #272's first probe edited the wrong place. Remove the worktree at the end and say that you did.
- Size a benchmark to the slow side. Iterations × the old cost must fit the harness timeout, or the "before" half never finishes, as happened to #272's old loader.
- Time mechanisms locally and magnitudes in CI. A workstation doesn't reproduce a 4-core runner's contention. In #272 the whole docs suite ran in 1.5 s locally, while its corpus test alone took 6.2 s in CI, with three test processes sharing four cores.

### 5. The agent loop, when in scope

Start with what CI history shows without any transcript. Count runs cancelled by a later push to the same ref, how long each ran first, and how long its superseding run waited before its first job started. In this repo's first live test of the skill, 14 of about 60 runs in one day were cancelled this way. One run in five waited 20–85 s, because the cancelled run kept going until its `if: always()` result job had finished. Pushing several commits a minute apart is a delivery-loop habit, and its fix (batching commits before pushing) belongs in the delivery skills, not the workflow.

Then use the session-history tool the environment provides (the `dream-weaver` skill lists them). If there is none, say that the transcript part of this surface wasn't covered. For the delivery sessions in the window, count: wake-ups, and how many led to no action (own posts, bot previews, empty check lists); CI runs dispatched only to measure; turns spent waiting on checks; usage-limit stops and the work redone after them. Report counts, not impressions. Then route each fix to where it belongs. Self-echo filtering belongs in the watch (#320), not in model turns. A dispatch budget belongs in the review's plan (step 7).

### 6. Rank

For each confirmed opportunity, estimate the latency saving: critical-path seconds per run × runs per day. Give the compute saving separately. Then apply these checks:

- **Savings don't add.** If two changes touch the same job, predict them together and plan one combined after-measurement on `main` at the end. #272's record 0007 exists because #274 was measured before #273 landed.
- **Stop at the critical path.** Once a target is no longer the longest path, a further second there saves no waiting. Say so, and name the new critical path as the next review's starting point.
- **Latency can cost compute.** Splitting a job runs its set-up again, and parallel jobs each pay checkout, toolchain and install. In #272 the split still lowered total job time, but say which way each lens moves.
- **Noise is a correctness finding.** Warnings and unhandled requests that print but don't fail cost no time. List them separately, as #275 did (and #291 after it).
- **Prefer the change that removes growth** over the one that buys time back once. A per-page corpus read gets worse with every story. A slow runner image doesn't.

### 7. Write the report

Follow [references/report-template.md](references/report-template.md). Every opportunity carries: the baseline, the predicted saving with its basis, the critical-path effect, the proof a fix needs, and the measurement plan. The proof is a test that fails without the fix, counting the mechanism, plus a `docs/benchmarks/` record. The plan says how many CI runs it would dispatch. In `report` mode, dispatch none.

End with **Not covered**: surfaces, jobs or sessions not examined, the measurements not run and why, and what you would need to settle each.

## Filing and delivering, after the report

Only when the maintainer asks, after reading the report:

- **Epic:** the report's sample, tables and analysis, then a children table (issue, problem, baseline, predicted saving, record number, PR). Use the `performance` label and the area labels (`gh label list`), and link the children as sub-issues.
- **One child per opportunity**, each with:
  - its baseline table and the after-quantities its PR must report on the same basis;
  - the proof the fix needs;
  - a reserved benchmark record number;
  - the files it owns, and which sibling owns shared files (for example the `docs/benchmarks/README.md` index row, which every sibling adding a record edits).
  - The instruction to carry `Closes #N` in a PR against `main`. Three of #272's four children merged without it, and those issues stayed open.
- **Deliver** through `issue-handover` (one child) or `epic-delivery` (several, in parallel sessions). Don't re-implement either skill here. The handover's rules for performance issues apply: baseline on the issue before implementing, same quantity after, a record, and close on evidence.
- **Dispatch budget:** for after-samples, run extra CI one at a time. The workflow's concurrency group keeps only one pending run per ref, so a second dispatch cancels the queued one. Stop at the sample size the spread justifies ([references/measurement.md](references/measurement.md)). Sample by head commit.

## Honesty rules

- Never present an inferred number as measured, or one sample's median as a trend. With five runs, the p90 is the maximum, and a single outlier moves the median a long way (record 0007's Backend 2:39, against 1:58 over forty baseline runs).
- Quote the headline the person feels. "Frontend job 4:28 → 0:53" was true, but a run's critical path fell to about the Backend job's 2:00 (record 0002's 1:58 median), not to 0:53.
- When a prose summary and a pasted table disagree, the table wins. Correct the prose in a new commit, as #303 did.
- Say what the review cost: CI runs dispatched, minutes of runner time, probes run.

## Limits

These rules come from one epic in one repository. They are a strong starting point, not a law. Where a new review contradicts one, follow the evidence and propose a change to this skill. The agent-loop counts come from one session's transcript, so treat them as a first measurement, not a norm. The harness can't yet report queue time or critical path directly. A `ci-timings` option for those would be a .NET tool change under ADR-0017, filed as its own issue.

## Final message to the user

The report itself, then one line saying what it cost (runs sampled, CI runs dispatched, probes run). Then the single question of whether to file issues, if there are opportunities worth filing.
