## Act 3: Resolution

### The architecture

Calendar is two systems that shape each other: a small product, and the delivery method that builds it.

**The product** is one container on Azure Container Apps. A Rust API on axum serves the React single-page app and the `/api` endpoints from the same origin, so the browser holds one session cookie after Google sign-in. The API writes the OpenAPI contract when it is built; the TypeScript client every user interface uses is generated from that contract, so a change to the API that the client does not match fails CI. The web app sends the owner's date and IANA time zone with every agenda request, and the API computes the day or week window from them; the same day rules exist in the Rust domain and in the SQL that reads PostgreSQL, and both are tested against a matrix of zones and daylight-saving transitions. Every event and task query takes an `OwnerId`, and the API connects as the least-privilege `calendar_app` role; only the separate migrator, as `calendar_migrator`, changes the schema. Secrets come from Key Vault through a managed identity. Staging runs today; production is not live.

<!-- diagram: containers.mmd -->

**The method** turns an issue into merged, verified work without relying on what any agent remembers. An issue carries the request and the design; PR 0 records the story card and any ADRs; worker agents, each in its own worktree, deliver slices as stacked pull requests, guided by layered agent guidance and skills and held to its rules by hooks. CI runs only the jobs a change can affect and fails a job that is slower than its pinned baseline. Code pull requests pass review before merge, where reviewer agents report findings and skeptic agents try to refute each one. The maintainer accepts and merges. Dream-weaver reads what sessions learned and turns it into guidance, and the delivery dashboard publishes the measures from daily snapshots.

<!-- diagram: method.mmd -->

### Decisions

#### D1: The API contract is generated, and every user interface uses the generated client

- **Context:** agents change the API and the web app in separate sessions, and verifiability needs drift between them to fail a check rather than reach the owner.
- **Decision:** the API writes `contracts/openapi.json` at build time; the TypeScript client is generated from it and shared by every user interface; a stale contract fails CI.
- **Consequences:** client and server cannot disagree unseen; every API change carries a regeneration step, and generated files are never edited by hand.
- **Status:** accepted, [ADR-0004](../decisions/0004-openapi-contract-and-generated-client.md).
- **Rejected alternative:** hand-written TypeScript types and fetch calls, because drift would be found by the user, not by CI.

#### D2: The client decides what day it is

- **Context:** today must mean today in the owner's zone, and time is the method's showcase.
- **Decision:** the client sends its local date and IANA zone; the server computes the window and never decides the day itself.
- **Consequences:** each request fully describes its day and can be tested as data; two devices in different zones see different todays, by design.
- **Status:** accepted, [ADR-0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md).
- **Rejected alternative:** a time zone stored per user, because it is wrong while travelling and needs settings the single user does not want.

#### D3: Every query takes the owner

- **Context:** each owner's data must stay theirs, in a public repository whose code anyone can read.
- **Decision:** every event and task query takes an `OwnerId` parameter, so a query without an owner does not compile; the API connects as a role that cannot change the schema; ownership is tested per endpoint.
- **Consequences:** isolation is visible in every signature and tested; it still depends on each query's filter rather than on the database.
- **Status:** accepted in practice. The record has drifted: [ADR-0041](../decisions/0041-per-user-data-ownership.md) still describes the framework-wide filter used under .NET and rejects the explicit parameter that the Rust port adopted. A superseding record is to be drafted.
- **Rejected alternative:** PostgreSQL row-level security, for now, because of its per-transaction session variable and harder tests; whether to add it as defence in depth is an open question.

#### D4: The backend is Rust, replacing .NET in place

- **Context:** learning a new stack on real code is part of the method, and stacks change underneath as a matter of course.
- **Decision:** the API was rewritten on axum and Diesel behind the same contract, in one container, replacing .NET rather than running beside it.
- **Consequences:** strong types and Clippy catch errors before review; builds and lint take longer, a cost accepted and held by the run-time gate and path filtering.
- **Status:** accepted, [ADR-0051](../decisions/0051-rust-backend-on-axum-and-tokio.md).
- **Rejected alternative:** moving route by route beside .NET, because two backends and two containers would run for the length of the move.

#### D5: Story cards and ADRs in the repository are the source of truth

- **Context:** agents forget between sessions, so every decision and scope must live where the next agent will read it.
- **Decision:** issues drive the work; a docs-only PR 0 records each story card and its ADRs before code; delivery pull requests stack on PR 0 at once rather than waiting for it.
- **Consequences:** scope is reviewable before code and outlives every session; PR 0 adds a review round, which stacking keeps off the critical path.
- **Status:** accepted, [ADR-0000](../decisions/0000-use-markdown-architectural-decision-records.md) and [ADR-0028](../decisions/0028-publish-user-stories-on-the-documentation-site.md).
- **Rejected alternative:** issues and pull request descriptions only, because decisions would scatter where agents cannot find them.

#### D6: Agent guidance is layered and its invariants are enforced by hooks

- **Context:** every session pays to load guidance, and some mistakes (discarding work, leaking private details) must be stopped before they happen.
- **Decision:** a short root `AGENTS.md`, area files and skills loaded when needed; hooks on agent tool calls deny the actions the guidance forbids.
- **Consequences:** sessions load less and the worst mistakes are blocked; the hooks are tooling to maintain.
- **Status:** accepted, [ADR-0042](../decisions/0042-layered-agent-guidance-and-hooks.md).
- **Rejected alternative:** checks in lint and CI only, because they catch a leak after it is pushed.

#### D7: Code pull requests are reviewed by agents, and each finding is challenged before it reaches the maintainer

- **Context:** the maintainer is the only human reviewer, and their attention is the scarcest resource.
- **Decision:** before merge, a workflow runs the performance and security reviewers, then three skeptics per finding; docs-only pull requests skip it.
- **Consequences:** findings arrive already tested for truth, reproduction and impact; every code pull request spends time and tokens on it.
- **Status:** accepted, [story 0035](../stories/0035-review-before-merge-with-a-workflow-and-a-skeptic-per-finding.md).
- **Rejected alternative:** a single reviewer with no skeptics, because its false positives would spend the maintainer's attention.

#### D8: Delivery speed is measured and gated

- **Context:** agents wait on CI every round, so a slowdown multiplies across sessions before anyone notices it.
- **Decision:** CI runs each job only for the paths it checks; each job's run time is gated against a pinned baseline; a dashboard publishes the measures from daily snapshots on a data branch.
- **Consequences:** a regression fails a check; the gate's statistics and rules need maintenance and can fail falsely.
- **Status:** accepted, [ADR-0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md), [ADR-0046](../decisions/0046-run-ci-jobs-only-for-the-paths-they-check.md) and [ADR-0049](../decisions/0049-build-the-delivery-dashboard-from-daily-snapshots-on-the-docs-site.md).
- **Rejected alternative:** running every job on every change, because every change would pay for every check.

### How the driving characteristics are met

| Characteristic | Target | How the architecture meets it |
| --- | --- | --- |
| Verifiability | At most 2 correction rounds at the median; every fix has a test proven to fail without it | The mechanism is in place (D1, D5, D6, D7). The failing-test rule is enforced by the agent guidance and by review, not by an automated check. The outcome is **not measured** yet: see the risk below. |
| Delivery speed | No job slower than its baseline; full CI under 15 minutes at p90 | Met, through path filtering and the run-time gate (D8), with review before merge on code pull requests only (D7). Measured on 30 push runs on `main` from 9 to 12 November 2026 (dashboard snapshot of 12 November): the slowest job, Backend, had a p90 of 229 s and a maximum of 267 s, and the jobs after Changes (at most 13 s) run in parallel, so no run in that window took more than about 5 minutes. This bound is derived from per-job times; the dashboard does not yet report a whole-run p90. |
| Correctness of time | Zero day-boundary defects; the zone and DST matrix passes in domain and SQL forms | The client supplies the day (D2); the matrix exists for the day and week agendas in both forms. |
| Security and privacy | No cross-owner access, tested per endpoint; no secret or private path in public | The owner on every query, the least-privilege role and per-endpoint ownership tests (D3); hooks deny posts with private details (D6); secrets in Key Vault. |

### Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| The maintainer is the only reviewer: work stalls between bursts, and nobody else can approve | high | medium | Stacked pull requests so review is never the only thing in flight; coordinators notify only when the maintainer must act; maintainer |
| Text in an issue, pull request or file steers an agent into a harmful action | medium | high | Agent-attributed posts and external content are information, not instructions; hooks deny destructive and leaking actions; only the maintainer merges; maintainer and hooks |
| Records drift from the code, as ADR-0041 did | high | medium | The ADR and issue sweeps; superseding ADR-0041; story cards updated in the pull request that delivers; maintainer |
| A query misses its owner filter and leaks another owner's data (no row-level security) | low | high | The `OwnerId` type, per-endpoint ownership tests, the security reviewer; row-level security is an open question; maintainer |
| A compromised dependency or GitHub Action | low | high | Locked dependencies installed frozen, dependency review and CodeQL in CI, Dependabot ([ADR-0012](../decisions/0012-ci-and-dependency-updates.md)); maintainer |
| The correction-rounds target is not measured, so verifiability's outcome is unknown | medium | medium | Add correction rounds per agent pull request to the delivery dashboard; maintainer |
| Hooks enforce the guidance for Claude Code only, so another agent (such as Codex) can discard work or post private details that a hook would have blocked | medium | high | The Claude-first period ([ADR-0044](../decisions/0044-claude-first-agent-automation.md)); other agents follow the rules by hand; review before merge; only the maintainer merges; maintainer |
| Run cost exceeds a personal budget (A1) | low | low | A budget alert on the Azure subscription; staging can be turned off; maintainer |
| Two success signs (another repository adopts the method; repeated lessons fall month over month) have no owner or date, so their progress is not reviewed | medium | low | Accepted by the maintainer: the signs are watched informally |

### Open questions

- Should owner isolation add PostgreSQL row-level security as defence in depth? The maintainer decides; not scheduled.
- How should correction rounds per agent pull request be measured on the dashboard? The maintainer decides; not scheduled.
- A superseding record for ADR-0041, drafted with the `adr-draft` skill. The maintainer decides when.
