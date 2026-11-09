---
status: in-progress
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
* **Public-safe by schema:** the repository is public. A snapshot holds aggregates, counts and public PR and issue numbers and titles. No machine paths, no session or task handles, no per-person ranking. A test enforces it.
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

1. **Given** the daily workflow runs or is dispatched, **when** it finishes, **then** the data branch holds one valid snapshot for that day, and a second run the same day replaces it.
2. **Given** a snapshot that holds a machine path, a session or task handle, or a field outside the schema, **when** the snapshot checks run, **then** they fail and name the field.
3. **Given** a valid latest snapshot, **when** the documentation site is built, **then** the CI-speed page shows each CI job's run count, minimum, median, p90 and maximum, its baseline and threshold, and the trend verdict of ADR-0045 ([dashboard.test.ts](../../frontend/apps/docs/src/lib/dashboard.test.ts), [delivery-dashboard.tests.cs](../../tools/delivery-dashboard/tests/delivery-dashboard.tests.cs)).
4. **Given** an invalid snapshot, **when** the site is built, **then** the build fails with a message that names the file, the field and the rule. **Given** no snapshot yet (the `dashboard-data` branch does not exist or holds none), **then** the build succeeds and the page says plainly that no snapshot exists yet, with no numbers, so a fresh clone, a fork and the time before the first daily run still build. *(Amended in #597: the original wording failed the build for a missing snapshot, but before the first workflow run there is nothing to read.)* ([dashboard.test.ts](../../frontend/apps/docs/src/lib/dashboard.test.ts))
5. **Given** a number on the page, **when** I read it, **then** it states whether it is measured or inferred and gives its sample and window ([dashboard.test.ts](../../frontend/apps/docs/src/lib/dashboard.test.ts)).
6. **Given** a job with too few runs, **when** the page shows its failure rate, **then** it is marked inconclusive, not shown as 0 % or 100 %. "Too few" is fewer than 20 trials; `main` and pull requests are separate tables. Data: [quality tests](../../tools/delivery-dashboard/tests/QualityTests.cs) (`Fewer_trials_than_the_rule_needs_are_inconclusive_with_no_rate_and_no_interval`, `An_inconclusive_row_with_a_rate_fails`). Page: [dashboard tests](../../frontend/apps/docs/src/lib/dashboard.test.ts) ("the quality page": `marks a job with too few trials inconclusive and shows no rate for it`).
7. **Given** a metric breaches its threshold, **when** the daily workflow runs, **then** it opens or updates exactly one issue and opens no other alert. Thresholds and the one-issue-per-kind rule: [AlertTests.cs](../../tools/delivery-dashboard/tests/AlertTests.cs) (`Several_breaches_of_one_kind_open_exactly_one_issue`, `An_open_issue_with_the_title_is_commented_on_instead_of_a_second_one_opened`).
8. **Given** an issue with no count comments, **when** the agent proxies are computed, **then** the issue appears with no cost data and does not fail the run. Data: [agent tests](../../tools/delivery-dashboard/tests/AgentTests.cs) (`An_issue_without_count_comments_is_listed_with_no_cost_data_and_does_not_fail`, `A_count_comment_with_an_unusable_number_is_malformed_and_contributes_nothing`); the page follows the data.
9. **Given** the change is complete, **when** I run `just check`, **then** it passes, including the architecture model entry for the new components.

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
* **Retention and size:** the data branch keeps everything until it passes a size limit chosen from a measurement in slice 6 (#601), then thins to weekly files.
* **Screenshots for every slice that shows something:** a slice that adds or changes a page (#597 to #600, and the architecture page in #601) shows the page in its PR description with the `github-screenshots` skill: the light and dark themes, and a before and after where a page changes, taken from the real build with the `run-calendar` skill's approach to driving a browser. A slice with no visible output (the snapshot pipeline, #596) says so in its PR and shows the tool's real output as text instead.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| Snapshot tool | `tools/` (new folder, name settled in #596) |
| Daily workflow | `.github/workflows/` (modelled on `ci-trend.yml`) |
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
* **Deferred: superseded-run waste.** It needs pull request runs and two jobs calls per pair (dozens of calls per daily snapshot), so the page states that it is not shown. A follow-up, not part of this slice.
* **Answered by the maintainer on #609:** the absent-versus-invalid reading above is accepted, and superseded-run waste stays out of this slice (a follow-up, not yet filed as an issue).

### Flow page (#598)

* **Collection:** two GraphQL calls per daily snapshot (one for open and merged pull requests and the open `epic` issues, one for the state of the issues the epics' task lists name), public data only. Branch names are used to find stacks and are not written to the snapshot; no title, login or path is kept.
* **Schema:** an optional root section `flow` (older files stay valid, no version bump), in `FlowSection.cs` and `FlowRules.cs`; the privacy scan covers it. A distribution exists exactly when its sample reaches `minSample` (5); below it only the count is kept and the page says "inconclusive".
* **Definitions** (also printed on the page): the age of an open pull request runs from opening; "waiting for a first review" is open, not draft and without a submitted review; lead time runs from opening to the merge into `main`; issue to merge runs from the issue's opening to the last merge into `main` of a pull request that closes it. **Stacks:** a pull request merged into another pull request's branch is a stack step, counted on its own and not in the lead time; when a stack is squash-merged and the pull requests above are retargeted to `main`, each counts from its own opening, so the time it waited for the ones below is part of its lead time. Open stacks are chains of open pull requests where one targets the branch of another.
* **Window:** merged pull requests of the last 30 days; GitHub returns the newest 100, and when that page is full the window starts at the oldest merge returned, so the real window is shown. A real run on 2026-11-09 covered 2.1 days for that reason.
* **Epic progress** counts the issues named in the epic's task list by their real state, not by the ticked box.
* **Tests:** constructed histories with a squash-merged stack, an issue closed by two pull requests, a full page, a branch cycle, task-list parsing, the GraphQL parser on constructed JSON and the schema rules (`tools/delivery-dashboard/tests/FlowTests.cs`); the docs page on the fixtures (`dashboard.test.ts`).

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

* **Alerts reuse the `performance` issue, one per kind.** The daily workflow's new `alert` job (permissions `contents: read` and `issues: write` only; the job that reads GitHub still cannot write issues) runs `delivery-dashboard alerts` on the checked snapshot. Flow: the oldest pull request waiting for a first review for more than 14 days, a median lead time above 24 hours over at least 5 pull requests, or an open stack deeper than 4. Quality: a job with at least 20 attempts on `main` whose failure rate's 95 % interval lies wholly above 10 %. Several breaches of one kind go into one issue; an open issue with the title is commented on, else it is opened; an inconclusive number never breaches; nothing else is ever posted. The thresholds are my proposal and are constants in `Alerts.cs` with tests; the maintainer can change them.
* **Retention, from a measurement.** Every daily snapshot is kept until `snapshots/` would pass 50 MB; the daily run fails before it publishes the snapshot that would pass it and warns from 80 % (`delivery-dashboard retention`, reading `git ls-tree -r -l`). Measured on a synthetic year of 365 files of 12 KB (a real snapshot with perturbed numbers, local `file://` remote, network time not measured): tree 4.4 MB, packed history 0.59 MB, shallow fetch 0.43 MB in 0.04 s, push 0.5 s. Inferred: about 11 years to the limit at 12 KB a day, about 7 at 20 KB. When it nears the limit the runbook thins the tree to Mondays for everything older than 90 days (the maintainer's answer to question 2 on #603: keep everything until a limit, then thin to weekly).
* **Runbook:** `docs/runbooks/delivery-dashboard.md` (refresh check, failed run table, invalid snapshot, threshold issues, thinning, schema change).
* **Architecture model:** the tool, the data branch and the dashboard pages (on the docs site node), the `dashboard-snapshot.yml` workflow in the CI/CD node, four relationships and story 0053; `just docs architecture` validates it.
* **Escaping job names:** done with the page in #597 (`escapeText`, tested with a hostile name from a fixture).
* **Known gaps:** the alert issue is commented on each day the threshold stays crossed (as the CI trend check does), which can be noisy; the thinning is a manual, documented procedure, not automated, because the limit is years away.

### Agent proxies section (#600)

* **Data:** the optional `agents` section (`tools/delivery-dashboard/AgentSection.cs`, `AgentRules.cs`): per issue number, valid and malformed count comments, tasks and subagents started, comments, reviews on the pull requests that mention it, and those pull requests, with sums that the rules check. No logins, titles or comment text are read into the snapshot; a test feeds comments with a path, an e-mail address and a handle and checks that none of them reaches the file.
* **Count comment shape:** the comments in the repository read `Tasks started: N. Subagents started: M.`, so the parser accepts that line anywhere in a comment, ignoring quoted lines. A whole number above 1000, a negative or a non-number makes the comment malformed (counted, contributes nothing). The skill states the line since #610.
* **Coverage:** the 100 most recently updated issues, so older count comments are not seen, and the page says so; an issue without a count comment is listed with null totals. Maintainer's answer on #603: this coverage is acceptable. Reading more than 100 issues is an open question on #608; the recommendation (100 now, history builds up in the daily snapshots) stands.
* **Limits to state on the page:** proxies for agent activity, not token or money cost; counts are self-reported by the agent (**inferred**), comment, review and pull request counts are recorded by GitHub (**measured**); pull requests are those that mention the issue, whether or not they deliver it. Local transcript aggregates stay a revisit trigger of ADR-0049.

### API

No changes. The calendar API is not touched.

### Testing

* Pure xUnit tests of the metric calculations on constructed histories, including a squash-merged stack and cancelled or superseded runs.
* A schema test that rejects private data.
* Docs-site tests that render the page from fixture snapshots (version 1 and 2), build an explicit "no snapshot yet" page from an absent or empty folder, and fail on an invalid one, naming file and rule.

### Lessons learned, known issues and follow-ups

* To be filled in on delivery. Deferred scope goes to a card or issue, not a loose sentence.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### See how delivery is going

Open **Delivery dashboard** in the documentation site's sidebar (the **CI speed** page is the first one). Until the first daily snapshot exists it says "No snapshot yet". For a local build, `just docs build` reads the data branch first; without network access or the branch, the pages say so.

The dashboard shows how long each CI job takes against its baseline, how long PRs wait, how often checks fail and what agent-driven work costs, each with its sample and window. The page updates once a day. A number marked **inferred** is an estimate, not a measurement.
