---
order: 5
---

# Operate the delivery dashboard

Use this runbook when the delivery dashboard on the documentation site looks stale, a docs build fails on a snapshot, a threshold issue opens, or the data branch nears its size limit. The decision is [ADR-0049](../decisions/0049-build-the-delivery-dashboard-from-daily-snapshots-on-the-docs-site.md) and the story is [0053](../stories/0053-show-how-fast-and-how-smoothly-changes-reach-main.md).

Terms used here:

- **Snapshot**: one JSON file of aggregates and public numbers (no paths, session handles, titles or people) for one day, `snapshots/YYYY-MM-DD.json`.
- **Data branch**: `dashboard-data`, a branch that is never merged. It holds a `README.md` and the snapshots, one commit per day.
- **Snapshot tool**: `tools/delivery-dashboard`, a .NET file-based app ([ADR-0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md)). Its commands are `snapshot`, `check`, `alerts` and `retention`.
- **Threshold issue**: the one open issue with the `performance` label that a daily run opens, or comments on, when a flow or quality number crosses its threshold.

## Before you start

- You need the GitHub CLI signed in (`gh auth status`) and the repository checked out. Run `just` commands from the repository root.
- Run `just doctor` once so the .NET SDK is the one the tools need.
- Know the three parts and where each runs:
  - **The daily workflow** (`.github/workflows/dashboard-snapshot.yml`, from `main`, daily at 06:47 UTC and on demand): job `snapshot` reads GitHub and checks the file, job `publish` commits it to the data branch, job `alert` opens or updates the threshold issues. It is never part of `CI result`, so it fails no pull request.
  - **The docs build** reads the data branch into the git-ignored `frontend/apps/docs/.dashboard-data/` (the `Read the dashboard data branch` step of the Docs site job in `ci.yml`, or `just docs dashboard-data` locally) and renders the pages at build time. Nothing in the browser calls GitHub.
  - **The pages** are under **Delivery dashboard** in the site's sidebar. They show the latest snapshot, not the current minute.

## Check that the refresh is working

1. Open the workflow's runs: `gh run list --workflow dashboard-snapshot.yml --limit 5`. The newest scheduled run should be from today, or yesterday before 06:47 UTC.
2. See what the data branch holds: `git fetch origin dashboard-data` and `git log --oneline -3 origin/dashboard-data`, then `git ls-tree --name-only origin/dashboard-data snapshots | tail -3`. The newest file should be today's or yesterday's date.
3. Open the CI speed page. It says `Snapshot of <date>`. The page is rebuilt on every production publication, so after a new snapshot it can lag by one publication.

## When the daily run fails

Read the failed step in `gh run view <run-id> --log-failed`, then match it:

| What the log says | Cause | What to do |
| --- | --- | --- |
| `... is not valid` or lines starting with `$.` in `Take the snapshot` or `Check the snapshot again` | The snapshot broke the schema or the privacy rules, so nothing was written | The message names the field. Fix the tool (a collector wrote something it must not, or a rule is too strict) in a pull request, then dispatch the workflow (see below). Never loosen a privacy rule to pass a run. |
| `the snapshot does not pass the rules` after a GitHub API error | A `gh` call failed | Re-run the workflow. If it repeats, run `dotnet run tools/delivery-dashboard/delivery-dashboard.cs -- snapshot --out /tmp/test.json` locally and read the error. |
| `Over the limit` in `Check that the data branch stays within its size limit` | `snapshots/` would pass 50 MB | Thin the data branch as in [Thin the data branch](#thin-the-data-branch), then re-run. |
| `Could not read the dashboard-data branch` | A git or network error, not a missing branch | Re-run. A missing branch is not an error: the first run creates it. |
| `Could not push the snapshot after three attempts` in `publish` | Another run pushed at the same time | Re-run the workflow; a second run on the same day replaces that day's file. |

Dispatch a run by hand with `gh workflow run dashboard-snapshot.yml --ref main`. A run for a day that already has a snapshot replaces that file.

## When the docs build fails on a snapshot

The message names the file and the rule, for example `Delivery dashboard: 2026-11-09.json is not a valid snapshot:` followed by `$.ci.jobs[0].path: must be one of check, publication`. The docs reader checks the shape and the privacy patterns again, because the data branch is outside the pull request flow.

1. Reproduce it: `just docs dashboard-data`, then `just docs test src/lib/dashboard.test.ts` and `just docs build`.
2. Run the tool's own check on the file: `dotnet run tools/delivery-dashboard/delivery-dashboard.cs -- check frontend/apps/docs/.dashboard-data/snapshots/<date>.json`. If the tool also fails, the file was published by a version of the tool that did not have the rule: replace or remove that day's file as below. If the tool accepts it and the docs reader does not, the two readers disagree: fix `frontend/apps/docs/src/lib/dashboard.ts` or `tools/delivery-dashboard/SnapshotRules.cs` and add the file as a fixture to `frontend/apps/docs/src/lib/fixtures/dashboard/valid/snapshots/`, which both test suites read.
3. To replace a bad day, dispatch the workflow the same day (it overwrites that file). To remove one, use a throwaway worktree of the data branch:

   ```sh
   git fetch origin dashboard-data
   git worktree add ../dashboard-data-fix -B dashboard-data-fix origin/dashboard-data
   cd ../dashboard-data-fix
   git rm snapshots/<date>.json
   git commit -m "Remove the invalid snapshot of <date>"
   git push origin HEAD:dashboard-data
   cd - && git worktree remove ../dashboard-data-fix
   ```

   Push normally: the data branch is never force-pushed, and history is kept.

A missing data branch or one with no snapshot is not a failure. The pages say `No snapshot yet`, which is what a fork, a fresh clone and the time before the first daily run see.

## When a threshold issue opens

Each day the `alert` job compares the snapshot with these thresholds (`tools/delivery-dashboard/Alerts.cs`, `AlertThresholds.Default`). A crossed threshold opens, or comments on, **one** issue per kind with the `performance` label, and no other issue:

| Kind and issue title | Threshold |
| --- | --- |
| Flow: `Delivery dashboard: flow thresholds breached` | The oldest pull request waiting for a first review has waited more than 14 days; or the median lead time to `main` is above 24 hours over at least 5 pull requests; or the deepest open stack is deeper than 4 pull requests |
| Quality: `Delivery dashboard: failure-rate thresholds breached on main` | A job with at least 20 attempts on `main` has a failure rate whose 95 % interval lies wholly above 10 % |

An inconclusive number (below its minimum sample) never breaches. The issue body names the number, its threshold and the page. Look at the page, decide whether the cause is real, and close the issue when it is resolved or the threshold is wrong. A later breach opens a new issue. Change a threshold in `Alerts.cs` with a test; the CI run-time gate itself stays with [ADR-0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md) and these alerts never gate CI.

## Thin the data branch

**Rule:** every daily snapshot is kept until `snapshots/` would pass **50 MB**. The daily run fails before it publishes the snapshot that would pass it, and warns from 80 %. At that point, thin the tree to one snapshot per week (Mondays) for everything older than 90 days.

**Evidence** (measured on 2026-11-09, with a synthetic year of 365 daily files made from a real snapshot of that day, 12 065 bytes, with every number of two digits or more changed by up to 10 % so each day differs; the numbers below are from a local `file://` remote, so network time is not included):

| Quantity | Measured |
| --- | --- |
| `snapshots/` tree, 365 files | 4.4 MB |
| Packed history of the branch, 365 commits | 0.59 MB |
| Shallow fetch of the branch tip (what the docs build does) | 0.43 MB, 0.04 s |
| Push of 365 commits | 0.5 s |

**Inferred:** the tree grows about 4.4 MB a year at 12 KB a day, so the limit is about 11 years away; with the agent-proxy section the file may reach 20 KB, which is about 7 years. A year of history is small for git because consecutive snapshots are nearly equal. The limit is on the tree because that is what the docs build copies and renders on every publication. Re-measure when the snapshot has grown by half.

To thin (this removes files from the tree; the history keeps them):

```sh
git fetch origin dashboard-data
git worktree add ../dashboard-data-thin -B dashboard-data-thin origin/dashboard-data
cd ../dashboard-data-thin
cutoff=$(date -u -d '-90 days' +%F)
for file in snapshots/*.json; do
  day=$(basename "$file" .json)
  if [[ "$day" < "$cutoff" && $(date -u -d "$day" +%u) -ne 1 ]]; then git rm -q "$file"; fi
done
git commit -m "Thin snapshots older than 90 days to Mondays"
git push origin HEAD:dashboard-data
cd - && git worktree remove ../dashboard-data-thin
```

Then check `gh api "repos/mgasca/calendar/git/trees/dashboard-data?recursive=1" | dotnet run tools/delivery-dashboard/delivery-dashboard.cs -- retention` and re-run the workflow. The history table on the CI speed page then has gaps of a week for old data, which it shows as it finds it.

## Change the schema

Fields are only ever added, with a new `version` in `Snapshot.cs` (`SnapshotJson.CurrentVersion`) that the tool and `dashboard.ts` both accept alongside every older version. A new section is optional at the root so older files stay valid. Add the rules, a fixture in `frontend/apps/docs/src/lib/fixtures/dashboard/valid/snapshots/`, and a page entry in the list at the end of `dashboard.ts`; the sidebar follows. Run `just tools test`, `just docs test` and `just docs build` with the real data branch read.

## Check your work

- `just tools test` and `just docs test` pass; `just docs build` builds with the real data branch (`just docs dashboard-data` first).
- `dotnet run tools/delivery-dashboard/delivery-dashboard.cs -- check` on every file under `frontend/apps/docs/.dashboard-data/snapshots/` prints `OK`.
- The CI speed page says the date you expect, and the architecture model validates (`just docs architecture`).
