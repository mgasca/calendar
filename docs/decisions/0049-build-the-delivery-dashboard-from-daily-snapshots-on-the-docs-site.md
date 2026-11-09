---
status: accepted
date: 2026-11-09
decision-makers: mgasca, Claude (AI assistant)
---

# Build the delivery dashboard from daily JSON snapshots on a data branch, rendered by the documentation site

## Context and Problem Statement

Delivery data is scattered. `ci-timings` and the daily trend check watch CI job run times ([ADR-0045](0045-run-time-regression-gates-for-ci-jobs.md)), `handover-watch` follows one issue at a time, the benchmark records hold one-off measurements, and GitHub keeps workflow run data only for a limited time, so long trends are lost. Nobody can see run times, PR age, failure rates and agent activity in one place. The repository is public, so whatever a dashboard publishes is public too. Epic #595 asks for a delivery dashboard that answers four questions: CI speed and regressions, flow of PRs and issues, quality and failures, and agent cost. Which product or approach should provide it?

## Decision Drivers

* **D1 No new service or language**: nothing new to host, patch or monitor, and tooling stays in .NET ([ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)). The maintainer is one person plus agents.
* **D2 Public-safe data**: the repository is public. The dashboard shows aggregates and public links only, and a test can enforce that. Data must not leave the maintainer's control without a decision.
* **D3 Reuses existing delivery data**: the pinned CI baseline, the trend verdicts and the run samples already exist ([ADR-0045](0045-run-time-regression-gates-for-ci-jobs.md)). A new view should build on them, not re-collect and disagree with them.
* **D4 History beyond GitHub's retention**: trends over months need stored snapshots.
* **D5 Low maintenance**: the cost of keeping the dashboard working when GitHub, the tool or a dependency changes.
* **D6 Covers all four questions**: CI speed, flow, quality, and agent cost from GitHub-only proxies, which the maintainer chose over local transcript data.

## Considered Options

* Daily snapshot tool, data branch and a documentation-site page
* GitHub-native views only (Projects, Insights, job summaries)
* Apache DevLake with Grafana, self-hosted
* Metabase or Superset over a copy of the GitHub data
* A SaaS engineering-analytics product on a free tier
* Four Keys (Google, open source)

## Decision Outcome

Chosen option: "Daily snapshot tool, data branch and a documentation-site page", because it is the only option that adds no service (D1), keeps data public-safe by a schema and a test (D2), reuses the baseline and trend data that exist (D3), stores history on a branch (D4) and can show all four question areas (D6). It costs us the maintenance of a small tool (D5), which the other self-built or self-hosted options share and which we accept for the rest.

| Driver | **Daily snapshot tool, data branch and a documentation-site page (chosen)** | GitHub-native views only | Apache DevLake with Grafana | Metabase or Superset over copied data | SaaS free tier | Four Keys |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| D1 No new service or language | ★★★ | ★★★ | ☆☆☆ | ☆☆☆ | ★★★ | ☆☆☆ |
| D2 Public-safe data | ★★★ | ★★★ | ★★☆ | ★★☆ | ☆☆☆ | ★☆☆ |
| D3 Reuses existing delivery data | ★★★ | ☆☆☆ | ☆☆☆ | ★☆☆ | ☆☆☆ | ☆☆☆ |
| D4 History beyond GitHub's retention | ★★★ | ★☆☆ | ★★★ | ★★★ | ★★☆ | ★★★ |
| D5 Low maintenance | ★★☆ | ★★★ | ★☆☆ | ★☆☆ | ★★★ | ☆☆☆ |
| D6 Covers all four questions | ★★★ | ★☆☆ | ★★☆ | ★★☆ | ★★☆ | ★☆☆ |

### How it fits together

* **Snapshot tool:** a .NET file-based app under `tools/` ([ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)) gathers data into one versioned JSON document per day. It reuses `ci-timings` parsing and `.github/ci-baseline.json`, and calls the GitHub API through `gh`.
* **Data branch:** a daily and on-demand workflow, modelled on `ci-trend.yml`, commits the snapshot to a never-merged data branch, like the `screenshots` branch. `main` and its protection are untouched.
* **Page:** the documentation site renders the page at build time from the snapshots. How the build obtains them (a checkout of the data branch into a git-ignored folder, or an artifact) is settled in slice 2 (#597), within the Pages permission split of [ADR-0025](0025-github-pages-pr-previews.md).
* **Public-safe by schema:** a snapshot holds aggregates, counts and public PR and issue numbers and titles. A test fails on a path, a session or task handle, or any field outside the schema.
* **Alerts:** a breach reuses the existing `performance` trend issue. No new alert channel.
* **Agent cost:** GitHub-only proxies (the count comments of the `issue-handover` skill, activity per issue, PR counts). Local transcript aggregates are a revisit trigger below.

### Consequences

* Good, because no service, database or new language is added, and the page ships with the site that already publishes.
* Good, because the CI view uses the same baseline and verdicts as the gate, so the two cannot disagree.
* Good, because a schema and a test decide what becomes public.
* Bad, because we own and maintain the tool, the workflow and the page, which a SaaS tool or a vendor-maintained product would carry for us.
* Bad, because snapshots are daily, not live, and the history starts the day the workflow first runs.
* Neutral, because the data branch needs a size and retention rule (slice 6, #601).

### Confirmation

* A test over the snapshot schema fails on a machine path, a session or task handle, or a field outside the schema (#596).
* The docs build fails with a message when the latest snapshot is missing or invalid (#597).
* Review of any change that publishes a new field checks it against the schema.
* `just tools adr` validates this record and the architecture model entry.

## Pros and Cons of the Options

### Daily snapshot tool, data branch and a documentation-site page

* Good, because **D1 No new service or language**: a .NET tool, a workflow and a page in the existing site.
* Good, because **D2 Public-safe data**: the schema and its test decide what is published.
* Good, because **D3 Reuses existing delivery data**: it reads the pinned baseline and the trend inputs that `ci-timings` already defines.
* Good, because **D4 History beyond GitHub's retention**: one file per day on a data branch.
* Bad, because **D5 Low maintenance**: we maintain the tool, the schema and the page.
* Good, because **D6 Covers all four questions**: any metric GitHub exposes can be added, including the agent proxies.

### GitHub-native views only

* Good, because **D1 No new service or language**: nothing to build or host.
* Good, because **D2 Public-safe data**: nothing new is published.
* Bad, because **D3 Reuses existing delivery data**: it cannot show the pinned baseline or the trend verdicts.
* Bad, because **D4 History beyond GitHub's retention**: it shows what GitHub keeps, no more.
* Good, because **D5 Low maintenance**: GitHub maintains it.
* Bad, because **D6 Covers all four questions**: Projects and Insights do not give CI step times or agent proxies, and job summaries are per run.

### Apache DevLake with Grafana

* Bad, because **D1 No new service or language**: several containers and a database to host, in Go and Docker.
* Neutral, because **D2 Public-safe data**: a private instance keeps data private, but there is no public view without extra work.
* Bad, because **D3 Reuses existing delivery data**: it re-collects GitHub data and would disagree with the baseline unless rebuilt on it.
* Good, because **D4 History beyond GitHub's retention**: it stores history in its database.
* Bad, because **D5 Low maintenance**: a service to run and upgrade. Its releases checked on 2026-11-09 were still betas.
* Neutral, because **D6 Covers all four questions**: DORA and flow dashboards come ready, agent proxies and the CI baseline do not.

### Metabase or Superset over copied data

* Bad, because **D1 No new service or language**: a BI server plus an ETL job we would write.
* Neutral, because **D2 Public-safe data**: private by default, no public view without extra work.
* Neutral, because **D3 Reuses existing delivery data**: the baseline could be loaded, but the loading is the work.
* Good, because **D4 History beyond GitHub's retention**: a database keeps history.
* Bad, because **D5 Low maintenance**: a server and an ETL to keep running.
* Neutral, because **D6 Covers all four questions**: the charts are easy, the data collection is the same work as in the chosen option.

### A SaaS engineering-analytics product on a free tier

* Good, because **D1 No new service or language**: hosted by the vendor.
* Bad, because **D2 Public-safe data**: delivery data goes to a third party, and free-tier terms change.
* Bad, because **D3 Reuses existing delivery data**: the vendor computes its own metrics and cannot read our baseline.
* Neutral, because **D4 History beyond GitHub's retention**: the vendor keeps history, for as long as the plan allows.
* Good, because **D5 Low maintenance**: the vendor maintains it.
* Neutral, because **D6 Covers all four questions**: DORA and flow are covered, but not our CI baseline or the agent proxies.

### Four Keys

* Bad, because **D1 No new service or language**: needs Google Cloud services and its own pipeline.
* Bad, because **D2 Public-safe data**: webhook data goes into a cloud project we would also have to secure.
* Bad, because **D3 Reuses existing delivery data**: it collects its own events.
* Good, because **D4 History beyond GitHub's retention**: BigQuery keeps history.
* Bad, because **D5 Low maintenance**: a search on 2026-11-09 indicated the upstream repository is archived; this was not confirmed on the repository itself.
* Bad, because **D6 Covers all four questions**: it reports the four DORA keys, not CI step times, flow detail or agent cost.

## More Information

* Epic #595 and its slices #596 to #601 track delivery. Story [0053](../stories/0053-show-how-fast-and-how-smoothly-changes-reach-main.md) holds the scope.
* Related decisions: [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md) (tooling in .NET), [ADR-0045](0045-run-time-regression-gates-for-ci-jobs.md) (baseline and trend), [ADR-0046](0046-run-ci-jobs-only-for-the-paths-they-check.md) (new workflows stay outside the required checks), [ADR-0025](0025-github-pages-pr-previews.md) (Pages permissions), [ADR-0039](0039-architecture-model-and-visualization-tooling.md) (model update).
* Facts checked on 2026-11-09 by web search, not on vendor pages: Four Keys appears archived; DevLake releases are betas; SaaS free tiers differ between sources. No prices are quoted. Verify before relying on any of them.
* **Revisit triggers** (recorded here and in the story card's "Not in this story"): move to DevLake with Grafana when history across several repositories is needed; add local transcript aggregates when the GitHub proxies prove too coarse; reconsider a SaaS tool if the maintainer accepts data leaving the organisation.
* **Accepted 2026-11-09** by the maintainer with the recommended answers to the four review questions (#603): the docs build reads the `dashboard-data` branch into a git-ignored folder in the Pages `assemble` job and for local builds; the branch keeps everything until it passes a size limit chosen in #601, then thins to weekly files; the agent proxies are the `issue-handover` count comments, activity per issue and PRs per issue, and issues without them show no cost data; the public page shows numbers and links only, no titles.
