---
status: planned
date: 2026-11-09
issue: https://github.com/mgasca/calendar/issues/595
pr:
  - https://github.com/mgasca/calendar/pull/603
  - https://github.com/mgasca/calendar/pull/604
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
6. **Given** a job with too few runs, **when** the page shows its failure rate, **then** it is marked inconclusive, not shown as 0 % or 100 %.
7. **Given** a metric breaches its threshold, **when** the daily workflow runs, **then** it opens or updates exactly one issue and opens no other alert.
8. **Given** an issue with no count comments, **when** the agent proxies are computed, **then** the issue appears with no cost data and does not fail the run.
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
* **Retention and size:** the data branch gets a size and retention rule in slice 6 (#601).
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
