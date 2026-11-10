---
status: implemented
date: 2026-11-09
issue: https://github.com/mgasca/calendar/issues/595
pr:
  - https://github.com/mgasca/calendar/pull/603
  - https://github.com/mgasca/calendar/pull/604
  - https://github.com/mgasca/calendar/pull/609
  - https://github.com/mgasca/calendar/pull/611
  - https://github.com/mgasca/calendar/pull/616
  - https://github.com/mgasca/calendar/pull/606
  - https://github.com/mgasca/calendar/pull/607
  - https://github.com/mgasca/calendar/pull/608
  - https://github.com/mgasca/calendar/pull/619
  - https://github.com/mgasca/calendar/pull/620
  - https://github.com/mgasca/calendar/pull/622
  - https://github.com/mgasca/calendar/pull/631
adrs: ["0017", "0025", "0045", "0046", "0049"]
---

# 0053 Show how fast and how smoothly changes reach main

## Story

> As a maintainer, I need a delivery dashboard on the documentation site that shows CI speed, the flow of PRs and issues, failures and the cost of agent-driven delivery, so that I see where delivery slows down or breaks without running a one-off analysis each time.

Tracked in issue #595 (epic), with one child issue per slice.

## Background

Delivery data exists but is scattered. `ci-timings` pins a run-time baseline per CI job and runs a daily trend check ([0034](0034-gate-ci-job-run-times-against-a-pinned-baseline.md), [ADR-0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md)). `handover-watch` follows one issue at a time, the benchmark records hold one-off measurements, and the review in story [0033](0033-review-how-long-delivery-automation-makes-us-wait.md) is run by hand. GitHub keeps workflow run data only for a limited time, so a trend over months is lost, and nobody sees PR age, lead time, failure rates or agent activity in one place.

The approach was compared against GitHub-native views, Apache DevLake with Grafana, Metabase or Superset, SaaS tools with free tiers and Four Keys. [ADR-0049](../decisions/0049-build-the-delivery-dashboard-from-daily-snapshots-on-the-docs-site.md) records the choice: a .NET snapshot tool, a never-merged data branch and a page on the existing documentation site. This card holds the scope; the epic's child issues deliver it in slices.

### Agreed scope

Agreed with the maintainer in a Claude Code session on 2026-11-09 and recorded on #595.

* **Four questions answered:** CI speed and regressions, flow of PRs and issues, quality and failures, and agent cost.
* **A page on the documentation site:** published with the site, in the light and dark themes, also in per-PR previews.
* **History on a data branch:** one small JSON snapshot per day on a never-merged branch, so history outlives GitHub's run retention.
* **Daily plus on demand:** a scheduled workflow and a manual dispatch, like the trend check. Alerts reuse the open `performance` trend issue; there is no new alert channel.
* **Public-safe by schema:** the repository is public. A snapshot holds aggregates, counts and public PR and issue numbers, with no titles (the maintainer's answer on #603). No machine paths, no session or task handles, no per-person ranking. A test enforces it.
* **Agent cost from GitHub-only proxies:** the count comments of the `issue-handover` skill, comment and review activity per issue and PR counts per issue. The page says these are proxies, not token or money cost.
* **Evidence marks:** every number on the page says whether it is measured or inferred and gives its sample (runs, window).
* **First slice:** the CI-speed page, built on the existing baseline and trend data.

### Not in this story

* **A self-hosted Grafana, DevLake or BI server, and any SaaS dashboard:** compared in ADR-0049. Revisit triggers are recorded there: several repositories, a need for local transcript aggregates, or acceptance of data leaving the organisation.
* **Local transcript data:** no transcript, token count or machine path is published. Local aggregates are a later story if the GitHub proxies prove too coarse.
* **Gating CI on the new metrics:** [ADR-0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md) owns the run-time gate. The new workflow stays outside `CI result` ([ADR-0046](../decisions/0046-run-ci-jobs-only-for-the-paths-they-check.md)).
* **Per-person metrics:** the page ranks work, not people.
* **Live data:** the page shows the latest daily snapshot, not the current minute.

### Dependencies

* Slices follow the epic: snapshot pipeline (#596), then the pages (#597 first, then #598, #599, #600), then alerts and upkeep (#601).
* The page build must work with the Pages permission split of [ADR-0025](../decisions/0025-github-pages-pr-previews.md).

### Acceptance criteria

1. **Given** the daily workflow runs or is dispatched, **when** it finishes, **then** the data branch holds one valid snapshot for that day, and a second run the same day replaces it. No automated test: the workflow's `publish` job writes `snapshots/<date>.json` and skips an unchanged file. Checked on real runs on 2026-11-09, which committed `snapshots/2026-11-09.json` to `dashboard-data` and then replaced it.
2. **Given** a snapshot that holds a machine path, a session or task handle, or a field outside the schema, **when** the snapshot checks run, **then** they fail and name the field. See [delivery-dashboard.tests.cs](../../tools/delivery-dashboard/tests/delivery-dashboard.tests.cs): `A_machine_path_in_a_string_fails`, `A_session_or_task_handle_fails`, `A_uuid_fails`, `An_email_address_fails`, `A_field_outside_the_schema_fails_and_names_the_field` and `A_private_field_name_fails`. The docs reader repeats the scan: [dashboard.test.ts](../../frontend/apps/docs/src/lib/dashboard.test.ts) ("reading snapshots": `accepts the optional sections that other slices add, and still scans their strings`).
3. **Given** a valid latest snapshot, **when** the documentation site is built, **then** the CI-speed page shows each CI job's run count, minimum, median, p90 and maximum, its baseline and threshold, and the trend verdict of ADR-0045 ([dashboard.test.ts](../../frontend/apps/docs/src/lib/dashboard.test.ts), [delivery-dashboard.tests.cs](../../tools/delivery-dashboard/tests/delivery-dashboard.tests.cs)).
4. **Given** an invalid snapshot, **when** the site is built, **then** the build fails with a message that names the file, the field and the rule. **Given** no snapshot yet (the `dashboard-data` branch does not exist or holds none), **then** the build succeeds and the page says plainly that no snapshot exists yet, with no numbers, so a fresh clone, a fork and the time before the first daily run still build. *(Amended in #597: the original wording failed the build for a missing snapshot, but before the first workflow run there is nothing to read.)* ([dashboard.test.ts](../../frontend/apps/docs/src/lib/dashboard.test.ts))
5. **Given** a number on the page, **when** I read it, **then** it states whether it is measured or inferred and gives its sample and window ([dashboard.test.ts](../../frontend/apps/docs/src/lib/dashboard.test.ts)).
6. **Given** a job with too few runs, **when** the page shows its failure rate, **then** it is marked inconclusive, not shown as 0 % or 100 %. "Too few" is fewer than 20 trials; `main` and pull requests are separate tables. Data: [quality tests](../../tools/delivery-dashboard/tests/QualityTests.cs) (`Fewer_trials_than_the_rule_needs_are_inconclusive_with_no_rate_and_no_interval`, `An_inconclusive_row_with_a_rate_fails`). Page: [dashboard tests](../../frontend/apps/docs/src/lib/dashboard.test.ts) ("the quality page": `marks a job with too few trials inconclusive and shows no rate for it`).
7. **Given** a metric breaches its threshold, **when** the daily workflow runs, **then** it opens or updates exactly one issue and opens no other alert. Thresholds and the one-issue-per-kind rule: [AlertTests.cs](../../tools/delivery-dashboard/tests/AlertTests.cs) (`Several_breaches_of_one_kind_open_exactly_one_issue`, `An_open_issue_with_the_title_is_commented_on_instead_of_a_second_one_opened`).
8. **Given** an issue with no count comments, **when** the agent proxies are computed, **then** the issue appears with no cost data and does not fail the run. Data: [agent tests](../../tools/delivery-dashboard/tests/AgentTests.cs) (`An_issue_without_count_comments_is_listed_with_no_cost_data_and_does_not_fail`, `A_count_comment_with_an_unusable_number_is_malformed_and_contributes_nothing`). Page: [dashboard tests](../../frontend/apps/docs/src/lib/dashboard.test.ts) ("the agent activity page": `shows issues by number with links, and an issue without count comments as having no cost data`, `states that these are proxies, not token or money cost, and what is not covered`).
9. **Given** pull request runs that a newer push cancelled, **when** the snapshot and the CI-speed page are built (#618), **then** each week shows how many were superseded and how long the newer run waited, beside a control of runs that superseded nothing, labelled inferred (the pairing) and measured (the waits), and a week below the minimum shows no statistic. Data: [superseded tests](../../tools/delivery-dashboard/tests/SupersededTests.cs) (`Pairs_are_counted_and_timed_per_week_beside_the_control`, `A_run_cancelled_by_hand_before_the_newer_run_is_not_a_pair`, `Version_2_may_not_carry_the_section`). Page: [dashboard tests](../../frontend/apps/docs/src/lib/dashboard.test.ts) ("superseded runs": `shows the weeks with their control, and no statistic for a week below the minimum`).
10. **Given** the change is complete, **when** I run `just check`, **then** it passes, including the architecture model entry for the new components. CI (the same checks as `just check`) passed on every delivering PR and on `main` at the merge of #620. `just docs architecture` validates the model entries added in #616.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0049](../decisions/0049-build-the-delivery-dashboard-from-daily-snapshots-on-the-docs-site.md) | Daily snapshot tool, data branch and a documentation-site page | The approach this story delivers, and the options it rejected |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | .NET file-based apps for repo tooling | The snapshot tool lives in `tools/` with analyzers and tests |
| [0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md) | Pinned baseline and trend check for CI job run times | The CI-speed page reads the same baseline and verdicts |
| [0046](../decisions/0046-run-ci-jobs-only-for-the-paths-they-check.md) | CI jobs run only for the paths they check | The new workflow is not part of `CI result` |
| [0025](../decisions/0025-github-pages-pr-previews.md) | GitHub Pages previews with split permissions | The page build must fit the assemble and deploy split |

### Other decisions (not ADR-worthy)

* **Schema version field:** every snapshot carries a version so older snapshots stay readable when the schema grows.
* **Reuse, not copy:** the tool reuses `ci-timings` parsing so the dashboard and the gate cannot disagree.
* **Answers to the review questions (maintainer, 2026-11-09, accepting ADR-0049):** the docs build reads the `dashboard-data` branch into a git-ignored folder in the Pages `assemble` job and for local builds; the public page shows PR and issue numbers and links, never titles; issues without count comments show no cost data.
* **Retention and size:** the data branch keeps every daily file until it reaches the 50 MB limit, which was set from a measurement in slice 6 (#601). Older files are then thinned to weekly ones.
* **Screenshots for every slice that shows something:** a slice that adds or changes a page (#597 to #600, and the architecture page in #601) shows the page in its PR description with the `github-screenshots` skill: the light and dark themes, and a before and after where a page changes, taken from the real build with the `run-calendar` skill's approach to driving a browser. A slice with no visible output (the snapshot pipeline, #596) says so in its PR and shows the tool's real output as text instead.

## Implementation notes

### Delivery

| Slice | Issue | PRs |
| --- | --- | --- |
| 0. Decision and card | #595 | #603 (ADR-0049 and this card), #606 (ADR-0049 accepted) |
| 1. Snapshot pipeline | #596 | #604 |
| 2. CI-speed page | #597 | #609 |
| 3. Flow page | #598 | #611 |
| 4. Quality page | #599 | #607 (data), #619 (page) |
| 5. Agent proxies | #600 | #608 (data), #620 (page) |
| 6. Alerts and upkeep | #601 | #616, #622 (first run on `main` recorded, closes #601) |
| Review findings on #607 | #613, #614 | #615 (pull request job names that `main` lacks are dropped), #617 (the jobs already fetched are reused) |
| Count-comment line in the skill | #610 | #612 |

The slices were delivered as stacked PRs and squash-merged on 2026-11-09. This card PR (#631) completes the story.

### Where things live

| Area | Location |
| --- | --- |
| Snapshot tool | `tools/delivery-dashboard/` (`delivery-dashboard.cs` with the `snapshot`, `check`, `alerts` and `retention` commands; schema and rules in `Snapshot.cs`, `SnapshotRules.cs` and one section and rules file per slice) |
| Daily workflow | `.github/workflows/dashboard-snapshot.yml` (jobs `snapshot`, `alert` and `publish`, each with only its own permissions) |
| Data branch | `dashboard-data`, one `snapshots/YYYY-MM-DD.json` per day |
| Runbook | `docs/runbooks/delivery-dashboard.md` |
| Page | `frontend/apps/docs/src/lib/dashboard.ts` (reader, validator, renderer and the list of pages); the loader in `docs-loader.ts` adds the entries and `astro.config.ts` the sidebar group from that list |
| Page data | `frontend/apps/docs/.dashboard-data/snapshots/` (git-ignored), filled by `just docs dashboard-data` and by the "Read the dashboard data branch" step of the Docs site job in `ci.yml`; `DASHBOARD_DATA_DIR` overrides the folder |
| Fixtures | `frontend/apps/docs/src/lib/fixtures/dashboard/valid/snapshots/`, read by the docs tests and by the .NET rules tests |
| Baseline and trend input | `.github/ci-baseline.json`, `tools/ci-timings` |
| Architecture model | `docs/architecture/calendar.architecture.json` |

### CI-speed page (#597)

* **Build-time read, no client calls.** The Docs site job (which builds the publication artifact that `pages.yml` assembles) fetches `dashboard-data` with `contents: read`; `pages.yml` and the ADR-0025 permission split are unchanged. Maintainer answer to question 1 on #603: copy the data branch into a git-ignored folder at build time.
* **Absent versus invalid.** No branch or no snapshot builds a "no snapshot yet" page (this is what a fork, a fresh clone and the time before the first daily run see). A snapshot that is present but breaks the schema, the privacy rules, or its file name (`yyyy-MM-dd.json` with a matching `date`) fails the build naming the file, the field and the rule. A failed `git fetch` for any reason other than "no such branch" fails the job instead of publishing an empty page.
* **Schema versions.** The writer emits version 2: per job a `baseline` (pinned count, median, threshold) and a `trend` (verdict, recent runs, shift and interval, minimum effect), at section level a `trend` (runs compared and required, window) and a `queue` (wait before the first job). Version 1 files already on the data branch still validate and render, with those parts shown as absent; a version 1 file may not carry version 2 fields and a version 2 file must carry them (null when unknown). The tool and the docs reader both accept 1 to 2. Fields are only ever added, with a new version.
* **Trend verdicts come from `ci-timings`.** The snapshot tool reads `.github/ci-baseline.json` and calls `Trend.RecentRuns` and `Trend.Evaluate` on the runs it already sampled, so the page and the gate cannot disagree and no GitHub call was added. With fewer recent runs than the check needs the verdict is `inconclusive`, never "no shift".
* **Two readers, one set of fixtures.** The privacy rules live in the .NET tool and run before a snapshot is published; the docs reader re-checks shape and the same four privacy patterns before rendering, because the branch is outside the pull request flow, and escapes every job name it prints. The valid fixtures are read by both test suites so the two readers cannot drift apart. Known gap: the .NET rules test runs in the Tooling job and the docs tests in the Docs site job, and a change to a shared fixture runs only the Docs site job on a pull request; `main` runs both.
* **Deferred in this slice: superseded-run waste.** Showing it needs the pull request runs and two jobs calls per pair of runs, which is dozens of calls per daily snapshot. Delivered in #618 (below).
* **Answered by the maintainer on #609:** the absent-versus-invalid reading above is accepted. Superseded-run waste stays out of this slice and moves to #618.

### Superseded pull request runs (#618)

* **What it shows.** Per ISO week (Monday start, UTC): how many pull request runs a newer push cancelled, how long the newer run waited from its creation to its first job starting (median, p90), how far apart the two pushes were (median), and the same wait for a control group, the successful pull request runs of that week that superseded nothing. A week with fewer pairs than `sample.minPairs` (3) shows the count and "not enough runs" instead of a statistic.
* **Measured or inferred.** That a run was superseded is **inferred** (a later `pull_request` run of the same branch exists; a cancelled run that had already ended when the newer one was created is left out as a manual cancel and counted in `sample.ignored`). The waits and the push gap are **measured**: differences of timestamps GitHub recorded. The section carries both labels in `basis`.
* **Schema version 3.** The writer emits version 3, which adds the root section `superseded` (`null` when not sampled). Versions 1 and 2 still validate and render, with the block saying that pull request runs were not sampled; a version 1 or 2 file may not carry the section and a version 3 file must carry the key. The tool and the docs reader accept 1 to 3. The section holds aggregates only: no run ids, branches or paths, and a test checks it.
* **Reuses `ci-timings`.** Pairing and timing are `Supersession.Pair` and `Supersession.Measure`, the code behind `ci-timings --superseded` ([benchmark record 0008](../benchmarks/0008-superseded-run-wait.md)); the snapshot tool has no second implementation.
* **Cost.** Each pair needs two jobs calls, and each control run one. A snapshot measures at most 30 pairs and 30 control runs (`sample.cap`), so at most about 90 calls, run once a day; older weeks can therefore be partial, and the page says so. The call count of the first real run is not yet measured.
* **Not in scope.** Gating on it; ADR-0045 owns the gate.

### Flow page (#598)

* **Collection:** two GraphQL calls per daily snapshot (one for open and merged pull requests and the open `epic` issues, one for the state of the issues the epics' task lists name), public data only. Branch names are used to find stacks and are not written to the snapshot; no title, login or path is kept.
* **Schema:** an optional root section `flow` (older files stay valid, no version bump), in `FlowSection.cs` and `FlowRules.cs`; the privacy scan covers it. A distribution exists exactly when its sample reaches `minSample` (5); below it only the count is kept and the page says "inconclusive".
* **Definitions** (also printed on the page): the age of an open pull request runs from opening; "waiting for a first review" is open, not draft and without a submitted review; lead time runs from opening to the merge into `main`; issue to merge runs from the issue's opening to the last merge into `main` of a pull request that closes it. **Stacks:** a pull request merged into another pull request's branch is a stack step, counted on its own and not in the lead time; when a stack is squash-merged and the pull requests above are retargeted to `main`, each counts from its own opening, so the time it waited for the ones below is part of its lead time. Open stacks are chains of open pull requests where one targets the branch of another.
* **Window:** merged pull requests of the last 30 days; GitHub returns the newest 100, and when that page is full the window starts at the oldest merge returned, so the real window is shown. A real run on 2026-11-09 covered 2.1 days for that reason.
* **Epic progress** counts the issues named in the epic's task list by their real state, not by the ticked box.
* **Tests:** constructed histories with a squash-merged stack, an issue closed by two pull requests, a full page, a branch cycle, task-list parsing, the GraphQL parser on constructed JSON and the schema rules (`tools/delivery-dashboard/tests/FlowTests.cs`); the docs page on the fixtures (`dashboard.test.ts`).

### Quality section (#599)

* **Data:** the optional `quality` section of the snapshot (`tools/delivery-dashboard/QualitySection.cs`, `QualityRules.cs`): run classes (`passed`, `passedAfterRerun`, `failed`, `cancelled`, `superseded`, `other`) for pushes to `main` and for pull requests, failure rate per job with a two-sided 95 % Clopper-Pearson interval, the required check `CI result` flagged, run ids and an Actions search query that back each count, and the guard step per day. Version 1 stays: the section is optional, so older files validate.
* **Cancelled and superseded runs are no failures**, and their jobs are trials in no rate (`CI result` fails there only because the others were cancelled; found on the first real sample, where it made 3 failures of 2 failed runs). A run is `superseded` when a later `pull_request` run of the same branch exists, which is **inferred**; the other counts are recorded conclusions (**measured**).
* **Inconclusive below 20 trials**, with counts and no rate or interval. The number 20 is in the snapshot (`rule.minTrials`), so changing it needs no schema change.
* **Guards over time are inferred:** the delivery guards have no CI job of their own; they run in the Tooling job's step "Test and lint tooling" with the other tool tests, so a failure of that step is not necessarily a guard.
* **Answered by the maintainer on #607:** (1) a failure rate is conclusive from 20 trials, stored as `rule.minTrials` in the snapshot; (2) pull request runs are shown beside `main` in separate tables, `main` first; (3) the Tooling step "Test and lint tooling" is the delivery-guards proxy, marked inferred on the page, and a separate follow-up issue is opened only if the number proves too coarse.

* **The page** (`Quality and failures`, `frontend/apps/docs/src/lib/dashboard.ts`, added to `dashboardPages`): per scope the run classes with their meaning, links to GitHub's current run lists and to the newest failed and rerun runs of the sample, the failure rate per job with its interval (an inconclusive row shows its counts and "none"), the guard step by day, and a history over the snapshots. The reader checks the section's shape again (the same rules as `QualityRules.cs`) and fails the build on a violation; the fixtures are checked by both readers. Links use only the repository, workflow and run ids of the snapshot.

### Alerts, upkeep and runbook (#601)

* **Alerts reuse the `performance` issue, one per kind.** The daily workflow's new `alert` job (permissions `contents: read` and `issues: write` only; the job that reads GitHub still cannot write issues) runs `delivery-dashboard alerts` on the checked snapshot. Flow: the oldest pull request waiting for a first review for more than 14 days, a median lead time above 24 hours over at least 5 pull requests, or an open stack deeper than 4. Quality: a job with at least 20 attempts on `main` whose failure rate's 95 % interval lies wholly above 10 %. Several breaches of one kind go into one issue; an open issue with the title is commented on, else it is opened; an inconclusive number never breaches; nothing else is ever posted. The thresholds were proposed in #616 and shipped unchanged. They are constants in `Alerts.cs` with tests, so changing one takes a small PR.
* **Retention, from a measurement.** Every daily snapshot is kept until `snapshots/` would pass 50 MB. The daily run warns from 80 %, and fails before it publishes a snapshot that would pass the limit. The check is `delivery-dashboard retention`, which reads the blob sizes from GitHub's trees API without fetching the branch; this change came from the #616 performance review. Measured on a synthetic year of 365 files of 12 KB (a real snapshot with perturbed numbers, local `file://` remote, network time not measured): tree 4.4 MB, packed history 0.59 MB, shallow fetch 0.43 MB in 0.04 s, push 0.5 s. Inferred: about 11 years to the limit at 12 KB a day, about 7 at 20 KB. When it nears the limit the runbook thins the tree to Mondays for everything older than 90 days (the maintainer's answer to question 2 on #603: keep everything until a limit, then thin to weekly).
* **Runbook:** `docs/runbooks/delivery-dashboard.md` (refresh check, failed run table, invalid snapshot, threshold issues, thinning, schema change).
* **Architecture model:** the tool, the data branch and the dashboard pages (on the docs site node), the `dashboard-snapshot.yml` workflow in the CI/CD node, four relationships and story 0053; `just docs architecture` validates it.
* **Escaping job names:** done with the page in #597 (`escapeText`, tested with a hostile name from a fixture).
* **Known gaps:** the alert issue is commented on each day the threshold stays crossed (as the CI trend check does), which can be noisy; the thinning is a manual, documented procedure, not automated, because the limit is years away.

### Agent proxies section (#600)

* **Data:** the optional `agents` section (`tools/delivery-dashboard/AgentSection.cs`, `AgentRules.cs`): per issue number, valid and malformed count comments, tasks and subagents started, comments, reviews on the pull requests that mention it, and those pull requests, with sums that the rules check. No logins, titles or comment text are read into the snapshot; a test feeds comments with a path, an e-mail address and a handle and checks that none of them reaches the file.
* **Count comment shape:** the comments in the repository read `Tasks started: N. Subagents started: M.`, so the parser accepts that line anywhere in a comment, ignoring quoted lines. A whole number above 1000, a negative or a non-number makes the comment malformed (counted, contributes nothing). The skill states the line since #610.
* **Coverage:** the 100 most recently updated issues, so older count comments are not seen, and the page says so; an issue without a count comment is listed with null totals. Maintainer's answer on #603: this coverage is acceptable. Question 2 on #608 asked whether to read more than 100 issues. It got no answer, so the recommendation shipped: read 100 issues, and let the history build up across the daily snapshots.
* **Limits to state on the page:** proxies for agent activity, not token or money cost; counts are self-reported by the agent (**inferred**), comment, review and pull request counts are recorded by GitHub (**measured**); pull requests are those that mention the issue, whether or not they deliver it. Local transcript aggregates stay a revisit trigger of ADR-0049.

* **The page** (`Agent activity`, in `dashboard.ts`): a caution that these are proxies and not token or money cost, what is counted and what is not (older issues, issues without count comments), a summary with measured or inferred per row, a per-issue table by number with links (an issue without a count comment reads "no cost data"), and a history. The reader re-checks the section's shape and sums and fails the build on a violation. **Known limitation:** a comment that quotes the format with placeholders (`Tasks started: N. Subagents started: M.`) is read as a malformed count comment; the page shows such comments under "malformed" and ignores them. Fixing the parser for quoted examples is a possible follow-up.

### API

No changes. The calendar API is not touched.

### Testing

* **Tool (xUnit, run by `just tools test`):** pure tests of the metric calculations on constructed histories, including a squash-merged stack and cancelled or superseded runs. Also schema and privacy tests that reject private data, plus the alert and retention rules. The files are `delivery-dashboard.tests.cs`, `FlowTests.cs`, `QualityTests.cs`, `QualityReuseTests.cs`, `QualityJobNameTests.cs`, `AgentTests.cs`, `SupersededTests.cs` and `AlertTests.cs` under `tools/delivery-dashboard/tests/`.
* **Docs site (Vitest, `dashboard.test.ts`):** the tests render every page from the fixture snapshots, in versions 1 to 3. They build an explicit "no snapshot yet" page from an absent or empty folder, and fail on an invalid snapshot, naming the file and the rule. They also escape hostile job names and check that no login, title or comment text reaches a page.
* **Shared fixtures:** both test suites read the same valid snapshots, so the .NET rules and the docs reader cannot drift apart.
* **Not automated:** the workflow itself, meaning the commit to the data branch, the same-day replacement and the real alert issue. These were checked on real runs.

### Lessons learned, known issues and follow-ups

* **Verified on `main`:** the first run dispatched after slice 6 ([run 42675345135](https://github.com/mgasca/calendar/actions/runs/42675345135)) passed all three jobs: the snapshot, the threshold check and the commit to the data branch. It published a snapshot with every section and opened no threshold issue, because nothing breached. This was the check the slice 6 PR could not make, because the workflow runs only from `main` (#622).
* **Stacked slices and squash merges.** Each squash merge left the PRs above it with their own copies of the merged commits. Every slice after the first needed a merge of `origin/main` and conflict resolution in the same few files: the `Snapshot` record, the optional-section list in `SnapshotRules.cs`, `dashboard.ts`, `dashboard.test.ts`, the fixtures and this card. **Lesson:** when several slices add sections to one schema, put the extension points in place first, so each slice touches its own file. Examples are an ordered list of optional sections and one file per section in both readers.
* **Fixtures shared across slices.** Once the fixtures gained sections, a test that built a duplicate JSON key by text replacement broke. Tests now change the parsed object instead.
* **A workflow job that is hard to verify:** list its first real run as a follow-up, not as "verified".
* **Keep the safety rules in the schema:** rejecting unknown keys and private fields caught real data problems early. Keep them in the schema, not only on the page.
* **CI infrastructure.** Twice a job ended as `abandoned`, and the ADR-0045 gate also flaked. A full re-run ("Re-run all jobs") fixed both; per ADR-0045, rerunning only the failed jobs reuses the old timings.
* **Known issues (no issue opened; open one when it hurts):**
  * The alert issue gets a comment every day a threshold stays crossed. This is noisy by design, like the CI trend check.
  * Thinning the data branch is a manual runbook step until the limit is near, which is years away.
  * Count comments that quote the format with placeholders are read as malformed.
  * Only the 100 most recently updated issues are read for the agent proxies.
  * The guard numbers are a proxy taken from a shared Tooling step.
* **Follow-ups:**
  * #618: delivered in the CI-speed page; the first real daily run should confirm the number of GitHub calls it makes.
  * Revisit triggers in ADR-0049: several repositories, local transcript aggregates, or data leaving the organisation.

## User guide

### See how delivery is going

Open **Delivery dashboard** in the documentation site's sidebar. Its **Overview** links to the four pages:

* **CI speed:** for each CI job, the run count, minimum, median, p90 and maximum, set against the job's pinned baseline and threshold, with the trend verdict, the time runs wait in the queue, and, per week, the pull request runs a newer push cancelled with how long the newer run waited.
* **Flow:** open pull requests and their age, pull requests waiting for a first review, lead time to `main`, time from issue to merge, open stacks and epic progress. Each metric is defined on the page.
* **Quality:** how runs on `main` and on pull requests ended, the failure rate per job with its 95 % interval, and the delivery-guard step by day. Each count links to the public runs behind it.
* **Agent activity:** for each issue, the tasks and subagents started (from count comments), the comments and reviews, and the pull requests that mention the issue. These are proxies, not token or money cost.

Every number says whether it is **measured** (recorded by GitHub) or **inferred** (an estimate), and gives its sample and window. A sample that is too small reads **inconclusive** instead of showing a figure. The pages show numbers and links only, never titles or names. Pages with two or more daily snapshots also show a history.

The data is refreshed once a day at about 06:47 UTC. A maintainer can also run the **Dashboard snapshot** workflow by hand, and the site shows the new data after its next build. Until a first snapshot exists, the pages say **No snapshot yet**. A local `just docs build` reads the data branch first; without network access or without the branch, the pages say so.

When a flow or quality number crosses its threshold, the daily run opens or updates one `performance` issue for that kind of breach. For upkeep (a failed run, an invalid snapshot, thinning old data), see the delivery dashboard runbook.
