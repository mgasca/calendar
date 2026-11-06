# Case study: epic #272, the Frontend CI job

The review this skill is built from, told so that a reader can check each rule against the record, issue or PR behind it. Times are UTC, 2026-11-05.

## What happened

1. **Request (17:08).** "The frontend build in CI is taking a long time." Sample the job's run times, analyse the job, the frontend `just` recipes and the tests, and report.
2. **Report (17:23, about 15 minutes in).** 39 successful runs gave a Frontend median of 4:26 (the 40-run record 0002 later gave 4:28), 2.3× the next job and the critical path of every run. The step table showed four steps of about 45–50 s each, and every one held a full Astro content sync. A temporary counter in the docs loader showed `readDocuments()` running 110 times per sync, once from the loader and once for each of 109 rendered pages. Those calls took 31.0 s of a 33.7 s sync. The report ranked four opportunities: compute the route map once per sync; give the docs site its own job; test-suite changes; drop a duplicate `tsc -b`.
3. **Epic and children (17:42).** #272 with the analysis, and #273–#276, one per opportunity, linked as sub-issues, each with its baseline table.
4. **PR 0, #280.** The `ci-timings` harness, baseline record 0002, and a rule in the handover skill: performance issues close on evidence.
5. **Usage limit (18:00–19:06).** The session stopped for about an hour.
6. **Parallel delivery (19:09).** The maintainer asked whether the children could run in parallel. Subagents could not write to other worktrees, so the session offered two independent sessions (for #274 + #276, and for #275) and kept #273 itself. Record numbers and file ownership were fixed on the epic first.
7. **#273 → #288.** A regression test counted reads: 111 on the old loader, 1 on the fix. The local A/B showed `astro sync` going from a 38 s median to 4.3 s (record 0003). Five CI runs on the branch put the Frontend job at 1:43.
8. **#274 → #286, #276 → #287 (stacked), #275 → #290.** The docs site moved into its own job (record 0004: Frontend 0:49, Docs site 3:00, measured before #273 landed). The duplicate `tsc -b` was dropped (0006). Test changes followed: one jsdom per worker, the batching rule tested at unit level, and unmodelled requests failing their test. The test step went from 23 s to 11 s (0005).
9. **Close-out (20:21–20:44).** Three issues had stayed open after their PRs merged. #303 added record 0007: the Frontend job at a 0:53 median on `main` with all four fixes, the docs site at 1:14 in its own job, and Backend as the new critical path, which the epic never touched. #303 also added the `Closes #N` rule to the handover skill. #291, about act warnings, was left as a standalone follow-up.

## Rules and where they come from

| Rule in the skill | Evidence |
| --- | --- |
| Start from a harness and paste its tables | #280 built `ci-timings`; records 0002, 0004–0007 all use it |
| Name the critical path; the headline isn't the wait | 0002 (Frontend 4:28, Backend 1:58) and 0007 (Frontend 0:53, Backend now longest) |
| A bimodal sample is hardware until a control says otherwise | #272 report: the 2:48–3:35 runs had every sync about 15 s faster |
| Count invocations before timing | 110 `readDocuments()` calls per sync (#273); four syncs per job (#272); jsdom created 17 times (#275) |
| Look first for cost that grows with the repository's content | The loader's cost grew with the square of the docs corpus (#273) |
| Probe in a scratch worktree, with absolute paths | The first probe's `cp` failed after the shell's directory drifted into `frontend/apps/docs` |
| Size benchmarks to the slow side | The old-loader bench hit the 600 s timeout (#273) |
| Dispatch after-sample runs one at a time | Two of four parallel dispatches were cancelled by the concurrency group (#273) |
| Filter samples by head commit | 0007's first prose used a six-run sample that included a run from before the split; corrected in #303 |
| Savings don't add; measure together at the end | 0004 was measured before #273 landed; 0007 measures the combination |
| Every child PR carries `Closes #N` against `main` | #286, #287 and #290 had none; #287 also merged into a stacked branch; #274–#276 stayed open |
| Fix shared-file ownership before parallel work | Every record PR edited the `docs/benchmarks/README.md` index; the only conflicts were there (#290) |
| Noise is a separate, correctness finding | #275 made unmodelled requests fail; #291 followed for act warnings |
| Re-read the head before merging | "Update branch" moved #288's head and restarted its checks just before the merge |

## What the review cost

- **Agent attention.** In the delivering session, 13 of 80 assistant messages acknowledged the session's own posts or reported nothing new, out of 28 task notifications. Self-echo filtering in the watch (#320) would have saved them.
- **CI.** At least 13 successful `workflow_dispatch` runs existed only to measure: four for the after-sample on #273, five in record 0005 and four in record 0007. Each was a full run of every job, and two more were cancelled by the concurrency group.
- **Wall clock.** About 3 h 35 min from request to closed epic, including the hour-long usage-limit stop. The report itself took 15 minutes. Most of the remaining time went to measurement and waiting on checks, not to code.

## What it didn't look at

The Backend job, the container image and the tooling job; queue time; and the local `just check` loop end to end. Record 0007 names Backend as the next critical path.
