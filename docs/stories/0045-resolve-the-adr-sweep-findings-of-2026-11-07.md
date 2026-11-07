---
status: in-progress
date: 2026-11-07
issue: https://github.com/mgasca/calendar/issues/474
pr: []
adrs: ["0000", "0002", "0003", "0011", "0014", "0019", "0021", "0025", "0026", "0029", "0030", "0031", "0032", "0035", "0037", "0045", "0048"]
---

# 0045 Resolve the ADR sweep findings of 2026-11-07

## Story

> As the maintainer, I need every finding of the 2026-11-07 ADR sweep to end in an explicit, evidenced disposition, so that the decision log says what the repository actually does without my decisions being changed or made implicitly.

Tracked in issue #474, part of epic #473.

## Background

The ADR sweep of 2026-11-07 (the `adr-sweep` skill) audited `origin/main` at `52c667e6586bf950f135f119cad9eb08477d36f0`. All 49 ADRs passed `just tools adr`. The titles and statuses in the architecture model matched. There were no `proposed` records and no ADR-number collisions between open PRs, and all 50 external More Information URLs returned HTTP 200. The judgement review was selective. Live cloud, account and pricing checks were not performed, so this story covers the reported findings. It does not claim that the whole decision log has been verified.

The sweep reported one finding to fix now, four grouped findings to decide (seven records) and four to watch. A Watch finding is a question that needs evidence, not a proven defect. Epic #473 tracks each finding to a disposition. The maintainer answered every question on the child issues on 2026-11-07. This card records those answers so that they outlive the issues.

The earlier mechanical sweep, epic #437, is closed. Its approved convention for inline, dated amendments is reused here and not reopened. [0010](0010-sweep-pending-adrs-to-a-decided-status.md) is the earlier story that swept `proposed` ADRs to a decided status. This story follows the same pattern: one PR per ADR, so that each record is reviewed and merged on its own.

### Agreed scope

* **This card first (PR 0):** a docs-only card with the scope, the dispositions and the delivery forecast, before any delivery PR of the epic (#474).
* **Dated amendments that retain the decision (#475 to #481):** each of ADR-0048, 0002, 0003, 0026, 0030, 0021 and 0045 gets a dated amendment under the amendment convention of #437. The decision is retained, and there is **no re-rating**, because no driver or weight changed. Status and title do not change, so the architecture model does not change either.
  * **ADR-0048 (#475):** correct the consequence that says Dependabot does not watch the frontend. `.github/dependabot.yml` has an npm entry for `/frontend`, and [ADR-0012](../decisions/0012-ci-and-dependency-updates.md) records that coverage. Fontsource is retained.
  * **ADR-0002, 0003, 0026 and 0030 (#476 to #479):** record the delivery of the single-container SPA hosting follow-up. The API serves static files and the SPA fallback (`backend/src/Calendar.Api/Program.cs`, `UseStaticFiles` and `MapFallback`), and container PR #114 has merged. Each amendment links the exact test and PR evidence. It keeps tests that were run apart from checks that only a deployment can make, and claims no live Azure verification. The decision-time context is kept as it was written.
  * **ADR-0021 (#480):** the "revisit when accounts exist" trigger has fired, because [ADR-0041](../decisions/0041-per-user-data-ownership.md) delivered per-user ownership. The amendment records that the trigger fired and that mandatory, explicit `today` and `timeZone` are retained, with **no stored preferred zone**. No product or API change.
  * **ADR-0045 (#481):** record the accepted exception to the 1 % false-failure budget. The back-test in [record 0014](../benchmarks/0014-ci-job-baseline.md) measured 5.5 % (4 of 73 runs, one-sided 95 % upper bound 12.1 %), which the maintainer accepted on 2026-11-07. The amendment links #421 and states that the review window ends at 2026-11-14 13:52Z. The method and the constants are unchanged.
* **Pages deployment collision (#429):** fixed within this epic, by its own worker and PR. The worker posts the design on #429 before implementing. #429 stays the one defect issue; no duplicate is opened.
* **Historical story citations (#484):** stories [0001](0001-today-view.md), [0003](0003-add-todo-tasks.md), [0004](0004-add-event-entries.md), [0005](0005-google-sign-in.md), [0011](0011-review-the-top-level-task-runner.md), [0014](0014-supersede-adr-0014-drop-sqlite-fallback.md) and [0017](0017-per-user-calendar-ownership.md) cite the superseded ADR-0011, 0014 or 0019. Each card gets one recorded disposition: historical, explicitly retained, or misleading as a current rule. History is preserved, and so are the engine rules of ADR-0014 that [ADR-0037](../decisions/0037-postgresql-only-no-sqlite-fallback.md) expressly retains. A card is clarified only where a citation reads as a current rule and is wrong. Old ADR numbers are not replaced mechanically.
* **Dispositions recorded in this card alone (#482 and #483):** these two need no ADR PR. Their whole scope is the disposition recorded under "Dispositions", so this card's PR closes them.
* **Existing work recorded, not redone (#468):** the ADR-0000 Confirmation correction was delivered by PR #469 before this card.
* **Close-out:** the Card worker of epic #473 owns the final update of this card: status, the `pr` list, the per-card dispositions of #484, the evidence links of each delivery PR, and the lessons learned.

### Not in this story

* **Changing any decision or its rating.** A changed decision is a new or superseding ADR (`adr-draft`) under its own issue, after the maintainer approves new drivers or weights.
* **Product, API or runtime hosting changes.** Neither a stored time zone (#480) nor any change to SPA hosting is in scope.
* **Measuring or recalibrating the CI run-time gate.** #421 keeps the week-later measurement and any recalibration. Nothing here dispatches CI, rewrites the baseline or changes the method before the review window ends.
* **Deployment work, cloud operations or spending.** These stay with #79 to #83 and the deployment plan #85.
* **Migrating the preview publisher, or creating a Cloudflare account** (#483).
* **Editing ADR-0025, 0029, 0031, 0032 or 0035** in this epic.
* **Rewriting decision history** in ADRs or story cards.
* **The rest of the decision log.** This story resolves the reported findings only.

### Dependencies

* Every delivery PR (#475 to #481, #484 and #429) opens after this card merges, as epic #473 orders.
* #421 keeps its own review date (2026-11-14) and does not gate this story.

### Acceptance criteria

1. **Given** this card's PR, **when** the maintainer reviews it, **then** it records the scope, the dispositions with evidence links and the delivery forecast, and `just docs test` and `just docs build` pass (#474).
2. **Given** ADR-0048 after its PR merges, **when** I read its Consequences, **then** a dated amendment says that Dependabot's npm entry covers `/frontend`, Fontsource is still the decision, and the rating table is unchanged (#475).
3. **Given** ADR-0002 after its PR merges, **when** I read it, **then** no sentence presents single-container SPA hosting as pending, and a dated amendment links the hosting tests and PRs, separates tests that ran from deployment-only checks, and claims no live Azure verification (#476).
4. **Given** ADR-0003 after its PR merges, **when** I read its Confirmation, **then** serving the built SPA from the API image is no longer conditional on an unfinished follow-up, and the amendment links the build and hosting evidence without claiming live Azure verification (#477).
5. **Given** ADR-0026 after its PR merges, **when** I read its Consequences and Confirmation, **then** each deep-link requirement is either linked to a test that covers it or named as a deployment-only check, and the router decision is unchanged (#478).
6. **Given** ADR-0030 after its PR merges, **when** I read its consequences, **then** the static-file fallback and the cache headers are recorded as delivered with links to their tests, the decision-time context is kept, and the outstanding operational checks are named (#479).
7. **Given** ADR-0021 after its PR merges, **when** I read its revisit trigger, **then** a dated amendment says that the account trigger fired with ADR-0041 and that explicit `today` and `timeZone` are retained with no stored preferred zone, and the API is unchanged (#480).
8. **Given** ADR-0045 after its PR merges, **when** I read its revisit trigger, **then** a dated amendment records the accepted 5.5 % rate (4 of 73, upper bound 12.1 %) against the 1 % budget, links #421 and gives the review window end of 2026-11-14 13:52Z, and the method and constants are unchanged (#481).
9. **Given** the ADR-0002, 0003, 0021, 0026, 0030, 0045 and 0048 PRs, **when** I compare their files, **then** each changes one ADR (and the architecture model only if a status or title changed), and `just tools adr` and `just docs build` pass on each (#475 to #481).
10. **Given** this card, **when** I read "Dispositions", **then** ADR-0029, 0031, 0032 and 0035 are recorded as assumptions not yet verified, to be revisited at the first deployment, linked to #79 to #83 and #85, and no ADR PR was opened for them (#482).
11. **Given** this card, **when** I read "Dispositions", **then** ADR-0025 is recorded as no change because its drivers still hold, and ADR-0025 itself is not edited (#483).
12. **Given** the seven story cards that cite superseded ADRs, **when** the citations PR merges, **then** this card holds one disposition per card, and only citations that read as a wrong current rule were clarified (#484).
13. **Given** #429, **when** its fix merges, **then** the cause found and the evidence that the fix works are linked from this card (#429).
14. **Given** the last delivery PR has merged, **when** I read this card, **then** its status is `implemented`, its `pr` list holds every PR of the epic in delivery order, each criterion above links its evidence or says plainly how it was checked, and #421 is still listed as the open follow-up.
15. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Dispositions

The maintainer's answers, each recorded as a comment on its issue on 2026-11-07.

| Finding | Records | Disposition | Evidence |
| --- | --- | --- | --- |
| J1, Fix now | 0000 | Done before this story: "and the index" removed from the Confirmation sentence | #468, PR #469 (merged 2026-11-07) |
| J1, Dependabot claim | 0048 | Approved: dated factual correction, no re-rating | [#475](https://github.com/mgasca/calendar/issues/475#issuecomment-6711967969) |
| J1/J2, SPA hosting delivered | 0002, 0003, 0026, 0030 | Approved: dated delivery amendment each, with exact test and PR evidence; tests kept apart from deployment-only checks; no live Azure claim; no re-rating | [#476](https://github.com/mgasca/calendar/issues/476#issuecomment-6711968178), [#477](https://github.com/mgasca/calendar/issues/477#issuecomment-6711968437), [#478](https://github.com/mgasca/calendar/issues/478#issuecomment-6711968650), [#479](https://github.com/mgasca/calendar/issues/479#issuecomment-6711968832) |
| J3, account trigger | 0021 | Retained: explicit `today` and `timeZone`, no stored zone; no driver or weight changed; dated amendment; no product or API work | [#480](https://github.com/mgasca/calendar/issues/480#issuecomment-6711968989) |
| J3, budget exceeded | 0045 | Approved: record the accepted 5.5 % exception, linked to #421, review window ends 2026-11-14 13:52Z; method and constants unchanged; no CI dispatch | [#481](https://github.com/mgasca/calendar/issues/481#issuecomment-6711969136), #421, [record 0014](../benchmarks/0014-ci-job-baseline.md) |
| J5, Azure assumptions | 0029, 0031, 0032, 0035 | Deferred to deployment: the cost, usage and cold-start assumptions are unverified, because Calendar is not deployed yet and no measured cost or latency exists. Revisit at the first deployment. No ADR PRs now | [#482](https://github.com/mgasca/calendar/issues/482#issuecomment-6711969327), #79 to #83, #85 |
| J5, preview-hosting constraint | 0025 | No change: the drivers still hold (no Cloudflare account; GitHub hosting preferred). ADR-0025 is not edited | [#483](https://github.com/mgasca/calendar/issues/483#issuecomment-6711969494) |
| J6, historical citations | 0011, 0014, 0019 (in stories 0001, 0003, 0004, 0005, 0011, 0014, 0017) | Follow the recommendation: preserve history and the retained engine rules; clarify only a citation that is misleading as a current rule; one disposition per card, added here at close-out | [#484](https://github.com/mgasca/calendar/issues/484#issuecomment-6711969687) |
| J7, Pages deploy collision | (none) | Fixed within this epic, under the existing defect issue | [#429](https://github.com/mgasca/calendar/issues/429#issuecomment-6711969998) |

The maintainer scheduled this card as story 0045 and assigned its final update to the Card worker ([#474](https://github.com/mgasca/calendar/issues/474#issuecomment-6711967790)).

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0000](../decisions/0000-use-markdown-architectural-decision-records.md) | MADR for Any Decision Records | Defines the record format and the statuses; its Confirmation was corrected by #469 |
| [0002](../decisions/0002-dotnet-10-minimal-api-backend.md) | .NET 10 with Minimal APIs | Gets a delivery amendment for single-container SPA hosting (#476) |
| [0003](../decisions/0003-react-vite-typescript-web-ui.md) | React, Vite and TypeScript SPA | Its Confirmation gets a delivery amendment (#477) |
| [0011](../decisions/0011-make-as-top-level-task-runner.md) | GNU Make as task runner (superseded by 0038) | Cited by historical stories (#484) |
| [0014](../decisions/0014-postgresql-database-engine.md) | PostgreSQL with a SQLite fallback (superseded by 0037) | Cited by historical stories; its engine rules are retained by ADR-0037 (#484) |
| [0019](../decisions/0019-single-user-mode-with-authentication-deferred.md) | Single-user mode (superseded by 0027) | Cited by historical stories (#484) |
| [0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md) | The client's date and time zone define the day | Account trigger fired; decision retained with an amendment (#480) |
| [0025](../decisions/0025-github-pages-pr-previews.md) | GitHub Pages PR previews | Watch: no change (#483) |
| [0026](../decisions/0026-client-side-routing-with-tanstack-router.md) | TanStack Router with code-based routes | Deep-link claims get a delivery amendment (#478) |
| [0029](../decisions/0029-azure-container-apps-compute-platform.md) | Azure Container Apps | Watch: cost and cold-start assumptions deferred to deployment (#482) |
| [0030](../decisions/0030-single-container-for-api-and-spa.md) | One container for the API and the SPA | Gets a delivery amendment for fallback and caching (#479) |
| [0031](../decisions/0031-azure-postgresql-flexible-server.md) | Azure PostgreSQL Flexible Server | Watch: assumptions deferred to deployment (#482) |
| [0032](../decisions/0032-azure-key-vault-for-secrets.md) | Azure Key Vault for secrets | Watch: assumptions deferred to deployment (#482) |
| [0035](../decisions/0035-separate-staging-and-production-environments.md) | Separate staging and production | Watch: assumptions deferred to deployment (#482) |
| [0037](../decisions/0037-postgresql-only-no-sqlite-fallback.md) | PostgreSQL only | Retains ADR-0014's engine rules, so those citations stay valid (#484) |
| [0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md) | CI run-time gates with a log-normal bound | Records the accepted budget exception (#481) |
| [0048](../decisions/0048-self-host-theme-fonts-with-fontsource-packages.md) | Self-hosted Fontsource fonts | Gets the Dependabot correction (#475) |

No new ADR is expected. Every changed record keeps its decision and its status, so the architecture model ([ADR-0039](../decisions/0039-architecture-model-and-visualization-tooling.md)) changes only if a PR changes a status or title.

### Other decisions (not ADR-worthy)

* **Amend in place, do not supersede:** the decisions still hold, and only their consequences, confirmations or revisit triggers are out of date. A dated amendment keeps the decision-time text readable and shows what changed and when, as epic #437 agreed.
* **No re-rating:** the maintainer confirmed that no driver or weight changed for any amended record. Ratings change only when drivers or weights do.
* **One PR per ADR:** each record is reviewed and merged on its own, so a contested amendment holds back no other.
* **Watch findings closed by this card:** #482 and #483 need no file change, so the evidence for their disposition lives here, and this card's PR closes them.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| This card | `docs/stories/0045-resolve-the-adr-sweep-findings-of-2026-11-07.md` |
| Amended records | `docs/decisions/0002-*.md`, `0003-*.md`, `0021-*.md`, `0026-*.md`, `0030-*.md`, `0045-*.md`, `0048-*.md` |
| SPA hosting evidence | `backend/src/Calendar.Api/Program.cs` (`UseStaticFiles`, `MapFallback`), the API hosting tests, container PR #114 |
| Dependabot evidence | `.github/dependabot.yml` (npm entry for `/frontend`) |
| Budget evidence | [record 0014](../benchmarks/0014-ci-job-baseline.md), #421 |
| Pages deployment | `.github/workflows/pages.yml` (#429) |
| Citation review | the seven story cards named under "Agreed scope" |

### API

No changes.

### Delivery forecast

One PR per record, all opened after this card merges and each based on fresh `origin/main`:

| PR | Issue | Change | Closes |
| --- | --- | --- | --- |
| PR 0 (this card) | #474 | The card | #482, #483 |
| ADR-0048 | #475 | Dependabot correction | #475 |
| ADR-0002 | #476 | Delivery amendment | #476 |
| ADR-0003 | #477 | Delivery amendment | #477 |
| ADR-0026 | #478 | Delivery amendment | #478 |
| ADR-0030 | #479 | Delivery amendment | #479 |
| ADR-0021 | #480 | Trigger fired, decision retained | #480 |
| ADR-0045 | #481 | Accepted budget exception | #481 |
| Citations | #484 | Clarifications, only if a card needs one | #484 |
| Pages deploy | #429 | Workflow fix, after a design on the issue | #429 |
| Close-out (Card worker) | #474, #473 | This card: status, `pr` list, evidence, per-card dispositions of #484 | #474 |

### Testing

* Every PR: `just tools adr` and `just docs build`. The card PRs also run the docs corpus tests (`just docs test`).
* The #429 fix needs evidence that a Publish run no longer fails on an in-progress deployment, posted on the issue.
* The amendments for #476 to #479 link the tests that cover each claim. A claim with no test is named as a deployment-only check, not marked delivered.

### Lessons learned, known issues and follow-ups

* **#421:** the week-later review of the CI run-time gate stays open, with its window ending 2026-11-14 13:52Z. It does not gate this story.
* **#482:** the Azure assumptions of ADR-0029, 0031, 0032 and 0035 are revisited at the first deployment (#79 to #83, #85).

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Reading an amended decision

This story changes no feature of the calendar. On the documentation site, an amended decision keeps its original text and adds a dated note that says what was delivered or corrected, and where the evidence is. The decision itself and its ratings stay the same.
