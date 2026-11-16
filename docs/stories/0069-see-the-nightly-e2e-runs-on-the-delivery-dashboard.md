---
status: implemented
date: 2026-11-15
issue: https://github.com/mgasca/calendar/issues/892
pr:
  - https://github.com/mgasca/calendar/pull/965
  - https://github.com/mgasca/calendar/pull/967
  - https://github.com/mgasca/calendar/pull/975
  - https://github.com/mgasca/calendar/pull/977
adrs: ["0045", "0049", "0058", "0061"]
---

# 0069 See the nightly E2E runs on the delivery dashboard

## Story

> As a maintainer, I need the delivery dashboard to show the nightly end-to-end runs next to CI, so that I can see the latest result, the recent failures and the run times without opening the Actions tab.

Tracked in issue #892, a follow-up of #737 (story [0064](0064-test-every-user-flow-end-to-end-and-prove-it-is-observable.md), epic #728).

## Background

The delivery dashboard of story [0053](0053-show-how-fast-and-how-smoothly-changes-reach-main.md) is built from one snapshot a day. The `Dashboard snapshot` workflow takes it with `tools/delivery-dashboard`, checks it against the schema and privacy rules, and commits it to the never-merged `dashboard-data` branch ([ADR-0049](../decisions/0049-build-the-delivery-dashboard-from-daily-snapshots-on-the-docs-site.md)). The docs site checks each file again and renders the pages. The snapshot reads only `ci.yml` today, in its CI, quality, flow and superseded sections, plus the agent proxies.

Story 0064 added the `E2E flows` workflow (`e2e.yml`, [ADR-0061](../decisions/0061-end-to-end-ui-tests-with-playwright-test-bound-to-the-architecture-flows.md)), which runs every night on `main` and on demand. A failed run on `main` comments on one open `bug` issue, "E2E flows: the nightly run failed on main", or opens it. The maintainer chose that alert on #737 (option C, 2026-11-14) and asked for a dashboard section as this follow-up. Today a failed night shows only as that issue, and run times and history are visible only in the Actions tab.

### Agreed scope

* **An E2E section in the snapshot:** each snapshot holds the newest completed runs of `e2e.yml` on `main`, both nightly and on-demand, up to 30. For each run it records the trigger, the time it was created, its conclusion and its run time. The run time is measured from the run starting to it finishing, or left empty when GitHub reports no start time.
* **Checked like every other section:** the snapshot tool and the docs site both check the section's shape, conclusions, ordering, counts and window. The existing privacy rules (no machine paths, handles, UUIDs or e-mail addresses) cover it too. A snapshot that breaks a rule is neither published nor rendered.
* **A new schema version that keeps old files valid:** the section arrives with snapshot schema version 4, required from that version (`null` when it was not sampled) and not allowed before it. Snapshots of versions 1 to 3 already on `dashboard-data` keep validating and rendering unchanged, the way version 3 added the superseded section. The product owner accepted this design on #892 (2026-11-16).
* **An "E2E flows" dashboard page:** it shows the latest run's result, and a failed latest run stands out with a link to the run. Below that come a summary of the sample (runs, failures, success rate, and the median, p90 and max run time of successful runs) and a table of the recent runs, each with its date, trigger, result, run time and run link. The page names the failure issue by its title, and every number says whether it is measured and over which window.
* **Honest empty states:** a snapshot older than version 4, one with no E2E section, and a window with no completed run each say so on the page. None of them implies a result.

### Not in this story

* **A new alert:** the one failure issue from #737 stays the alert for a failed night. The dashboard adds no threshold issue for E2E runs.
* **A run-time trend verdict for E2E:** ADR-0045's trend check of the E2E job against `.github/e2e-baseline.json` stays in `ci-trend.yml`. The page shows run times but no verdict.
* **Per-flow or per-test results:** the page shows whole runs, not which flow or test failed. The run's report and traces stay in the run's artifacts.
* **Pull request or branch runs:** `e2e.yml` never runs for a pull request, and the section reads `main` only.
* **Looking up the failure issue's number:** the snapshot does not read issues for this section, so the page names the issue by its title.

### Acceptance criteria

1. **Given** completed `e2e.yml` runs on `main`, **when** the daily snapshot is taken, **then** it holds an E2E section listing up to 30 of them, newest first, each with its trigger, creation time, conclusion and run time, and the run link is derived from the repository and the run id. Tests: [e2e_test.ts](../../tools/delivery-dashboard/tests/e2e_test.ts) (`E2E section lists completed main runs newest first with measured run times`, `E2E section keeps at most the cap and is empty, with no window, when nothing completed`, `E2E collector makes one run list call for e2e.yml on main`) and [cli_test.ts](../../tools/delivery-dashboard/tests/cli_test.ts) (`snapshot collector preserves job reuse, stable timestamps and validates before writing`, which now checks the version 4 E2E section end to end through the CLI). The link is checked on the page, in criterion 5.
2. **Given** an E2E section with a wrong shape (an unknown conclusion or trigger, runs out of order or duplicated, a run count that does not match the list or passes the cap, or a window that does not match the runs), **when** the snapshot is checked, **then** the check fails and names the field. Tests: [e2e_test.ts](../../tools/delivery-dashboard/tests/e2e_test.ts) (`bad E2E values fail at their schema paths`) for the tool, and [dashboard.test.ts](../../frontend/apps/docs/src/lib/dashboard.test.ts) (`rejects the section before version 4, a missing one in version 4 and a bad shape`) for the docs reader.
3. **Given** an E2E section holding an e-mail address, a machine path, a session handle or a UUID, **when** the snapshot is checked, **then** the privacy rules reject it. Tests: [e2e_test.ts](../../tools/delivery-dashboard/tests/e2e_test.ts) (`the privacy rules cover the E2E section`, for an e-mail address and a machine path) and the docs reader case above (an e-mail address). Handles and UUIDs go through the same scan of every string, which the existing tests in `snapshot_test.ts` and `dashboard.test.ts` cover; no E2E-specific test exists for them.
4. **Given** snapshots of schema versions 1 to 3 without an E2E section, **when** they are checked by the tool and by the docs site, **then** they still pass. **Given** a version 4 snapshot without the field, or a version 3 snapshot with it, **then** the check fails. Tests: [e2e_test.ts](../../tools/delivery-dashboard/tests/e2e_test.ts) (`versions 1 to 3 cannot carry the E2E section and version 4 requires it`) and the docs reader case above. The shared fixtures (versions 1, 2 and 4) pass both readers: [snapshot_test.ts](../../tools/delivery-dashboard/tests/snapshot_test.ts) (`all docs-site valid fixtures pass the same schema and privacy rules`) and [dashboard.test.ts](../../frontend/apps/docs/src/lib/dashboard.test.ts) (`reads every valid fixture, oldest first, and shows a version 1 file without the new sections`).
5. **Given** a snapshot whose latest E2E run failed, **when** the dashboard is built, **then** the E2E flows page shows that run as failed, with a link to the run. Test: [dashboard.test.ts](../../frontend/apps/docs/src/lib/dashboard.test.ts) (`shows a failed latest run as failed, with a link to the run and the failure issue`).
6. **Given** a snapshot whose latest E2E run succeeded, **when** the dashboard is built, **then** the page shows the summary and the table of recent runs, with the failures counted and each run linked. Tests: [dashboard.test.ts](../../frontend/apps/docs/src/lib/dashboard.test.ts) (`shows a passing latest run as passed`, `summarises the sample and lists every run, linked, with its trigger and run time`).
7. **Given** a snapshot older than version 4, or one whose E2E section is `null` or holds no runs, **when** the dashboard is built, **then** the page says that nothing was sampled and shows no result. Test: [dashboard.test.ts](../../frontend/apps/docs/src/lib/dashboard.test.ts) (`says so, and shows no result, when nothing completed, nothing was sampled or the snapshot is older`).
8. **Given** the change is complete, **when** I run `just check`, **then** it passes. The delivery PR records which suites ran locally and which ran only in CI.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0049](../decisions/0049-build-the-delivery-dashboard-from-daily-snapshots-on-the-docs-site.md) | The delivery dashboard is built from daily snapshots on the docs site | The E2E section is one more snapshot section. It is checked twice, once by the tool and once by the site, and it is published only on `dashboard-data`. |
| [0061](../decisions/0061-end-to-end-ui-tests-with-playwright-test-bound-to-the-architecture-flows.md) | End-to-end UI tests with Playwright, bound to the architecture flows | It defines the `E2E flows` workflow whose runs the section reads. |
| [0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md) | Run-time regression gates for CI jobs | The E2E trend verdict stays in that check. The page shows run times only. |
| [0058](../decisions/0058-typescript-on-deno-for-repository-tooling.md) | TypeScript on Deno for repository tooling | The collector and its rules are written in the Deno tool `tools/delivery-dashboard`. |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **The section's own page, not a block on "CI speed":** E2E runs are a separate workflow with a different cadence. The product owner chose this on 2026-11-16 (question 2 on #965), and also chose a new card over an amendment to story 0053 (question 1).
* **Whole runs, from one API call:** the run list holds everything the page needs (conclusion, creation, start and update times), so the snapshot makes no per-job calls. The run time is wall time from start to finish, so it includes any wait between jobs.
* **A link derived, not stored:** the snapshot stores the run id, and the page builds `https://github.com/<repository>/actions/runs/<id>`. The snapshot then holds no free-form URL to check.
* **Completed runs only:** a run still in progress at snapshot time has no conclusion yet, so it appears in the next snapshot.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| Collector, builder and rules of the E2E section | `tools/delivery-dashboard/e2e.ts`: `collectE2e`, `buildE2e`, `validateE2e` |
| Schema version 4 and the writer | `tools/delivery-dashboard/snapshot.ts` (`currentVersion`, `writeSnapshot`), `snapshot-rules.ts` (`validateSnapshot`), `delivery-dashboard.ts` (the `snapshot` command) |
| Tool tests | `tools/delivery-dashboard/tests/e2e_test.ts`, plus `cli_test.ts` and `snapshot_test.ts` |
| Docs reader and the **E2E flows** page | `frontend/apps/docs/src/lib/dashboard.ts` (`checkE2e`, `e2ePage`, the `e2e` entry of `dashboardPages`), with the `dashboard-verdict-failed` style in `src/styles/docs.css` |
| Shared fixture | `frontend/apps/docs/src/lib/fixtures/dashboard/valid/snapshots/2026-11-09.json`, now version 4 with three E2E runs, the newest one failed |
| Runbook | [Operate the delivery dashboard](../runbooks/delivery-dashboard.md), "When the E2E flows page shows a failure" |

### API

No changes. The calendar API and its contract are untouched.

### Snapshot schema

Version 4 adds the root field `e2e`. It is required from version 4 (`null` when not sampled) and rejected before it, the same way version 3 added `superseded`. The section is `{ workflow, basis, sample: { runs, cap, window }, runs: [{ id, event, createdAt, conclusion, runSeconds }] }`, with the runs newest first. Files of versions 1 to 3 on `dashboard-data` are read unchanged, and the page treats them as not sampled. The `Dashboard snapshot` workflow is unchanged: `actions: read` already covers the extra `gh run list` call, and this section makes no per-job calls.

### Testing

* Deno tests, using a stub `gh` runner, cover filtering (in progress, other branches, other triggers, duplicates), ordering, the cap, run times with and without a start time, the one collector call and its arguments, every rule, the privacy scan, and the version 1 to 4 compatibility.
* Vitest tests of the docs reader and the page cover a failed latest run, a passing one, the summary and table, no completed run, `e2e: null`, a version 2 snapshot, and the reader's rules.
* Negative control: the five new page and reader tests fail against the `dashboard.ts` on `main` and pass with this change. The new tool tests import `e2e.ts`, which does not exist on `main`.
* The builder was also run once by hand on the real `gh run list` output for `e2e.yml` (three runs, 2026-11-14 and 2026-11-15) to confirm that GitHub returns `startedAt` and `updatedAt`. The first published version 4 snapshot, after merge, was the real-data check of the whole pipeline (see the last item below).

### Lessons learned, known issues and follow-ups

* **Run time spans re-runs:** `runSeconds` is the run's `updatedAt` minus its `startedAt`, and GitHub moves `updatedAt` when a run is re-run, so a re-run includes the gap between attempts. The page says so. Nightly runs are rarely re-run, and timing per attempt would need one job call per run.
* **The failure issue is named, not linked by number:** the page links a GitHub search for its title, because this section reads no issues.
* **Statistics are computed on the page:** the median, p90 and max of the runs that passed use the tool's nearest-rank rule (`tools/ci-timings/statistics.ts`) over at most 30 runs. The snapshot stores only the runs.
* **First real snapshot (verified):** the `Dashboard snapshot` run dispatched by hand after merge, [run 43850396958](https://github.com/mgasca/calendar/actions/runs/43850396958) on 2026-11-16, passed all three jobs and published `snapshots/2026-11-16.json` on `dashboard-data` as version 4. Its E2E section holds three runs (2026-11-14 18:22 to 2026-11-15 11:01 UTC, one nightly and two by hand, all passed, in 220 s to 325 s), and the file passes the tool's `check` again. The scheduled run had not started that day, so it was dispatched by hand.

## User guide

### See how the nightly end-to-end runs are going

1. Open the docs site and choose **Delivery dashboard**, then **E2E flows**.
2. The top of the page shows the latest run. A note says **The latest run passed**. If the run failed, timed out or was cancelled, a caution says **The latest run did not pass**, names the result and links to the run, where the report, traces and screenshots are kept. The caution also links to the open issue "E2E flows: the nightly run failed on main", which holds the history of failed nights.
3. Under **Summary**, a table gives the number of runs in the sample, how many did not pass, the success rate, and the median, p90 and longest run time of the runs that passed.
4. Under **Recent runs**, each run shows its date and time, whether it ran **nightly** or was started **by hand**, its result (**passed**, or the result highlighted), its run time and a link.

The page shows the latest daily snapshot, not the current minute, so a run that ends after the morning snapshot appears the next day. A run that was re-run shows a run time that includes the wait between attempts. If the snapshot is older than this page, or holds no completed run, the page says so and shows no result.
