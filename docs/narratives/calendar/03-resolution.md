## Act 3: Resolution

### The architecture

Calendar has two architectures that answer the same problem: the application, and the method that delivers it.

**The application** is small on purpose. The web UI calls the API through a typed client generated from the contract, and the API reads and writes PostgreSQL. The web UI sends Today, its local date and time zone, with every agenda request; the API computes the day's window and returns the day agenda or week agenda as one snapshot. The API signs the owner in with Google, and every query for an event or a task takes the owner. It runs locally only.

<!-- diagram: containers.mmd -->

**The method** is a loop around every change. An issue becomes a story card; a significant decision becomes an ADR that the maintainer accepts. A delivery agent makes the change under layered guidance, skills and hooks. CI checks it, running only the jobs for the paths it touches and failing a job that runs slower than its baseline. On request, reviewers examine the branch and a skeptic tries to refute each finding. The maintainer authorizes the merge or asks for a correction round. A missed target becomes an issue, and its lesson goes back into guidance, a skill or a hook.

<!-- diagram: method.mmd -->

### Decisions

#### D1: Layered guidance with hooks

- **Context:** agents forget between sessions, and every repeated mistake is a correction round for the one human who decides.
- **Decision:** guidance in layers (a root file, one file per area, skills loaded when needed) and hooks that stop a forbidden action before it happens.
- **Consequences:** little text is loaded in every session, and a lesson can be enforced instead of restated. Hooks run only under Claude Code and name this repository's paths, so an adopter edits each one; the maintainer accepts that cost.
- **Status:** accepted ([ADR-0042](../decisions/0042-layered-agent-guidance-and-hooks.md)).
- **Rejected alternative:** prose only in one root file, because nothing is enforced and the file grows with every lesson; checks in lint and CI only, because a mistake is found after the work is done and a destructive local action is never stopped.

#### D2: Claude Code first for automation

- **Context:** the method must leave as a bundle, but one maintainer cannot keep every automation in two forms.
- **Decision:** new automation may target Claude Code only; the guidance files stay readable by any agent; the decision has a revisit trigger.
- **Consequences:** native hooks, skills and workflows, with no twins to drift. Only the guidance is neutral: the adoption claim covers Claude Code users only, and an agent on another harness follows the guidance by hand, without the hooks.
- **Status:** accepted ([ADR-0044](../decisions/0044-claude-first-agent-automation.md)).
- **Rejected alternative:** a hand-followable twin of every automation, because twins double the text and drift; a neutral automation layer with an adapter per harness, because it is an extra layer to build before any adopter exists.

#### D3: ADRs and story cards in the repository

- **Context:** public readers need evidence, an agent in a new session needs the reasons, and agents propose while the maintainer decides.
- **Decision:** every significant decision is an ADR and every story a story card, as Markdown in the repository, validated by tools and published on the docs site. The story card is the source of truth for a story.
- **Consequences:** records change in the same pull request as the code and are public. A card before delivery and an ADR acceptance add steps, and an adopter takes the conventions too.
- **Status:** accepted ([ADR-0000](../decisions/0000-use-markdown-architectural-decision-records.md), [ADR-0028](../decisions/0028-publish-user-stories-on-the-documentation-site.md)).
- **Rejected alternative:** no formal records, because a new session cannot find why and a reader has no trail; an external wiki, because it sits outside the review and the checks and is not copied with the bundle.

#### D4: A contract generated from the API

- **Context:** a change by a delivery agent must be proven right by checks before the maintainer reads it.
- **Decision:** the API generates the contract, which is committed; the web UI's typed client is generated from it.
- **Consequences:** a stale contract fails CI and a breaking change is a type error in every consumer. The contract follows the code rather than leading it.
- **Status:** accepted ([ADR-0004](../decisions/0004-openapi-contract-and-generated-client.md)).
- **Rejected alternative:** a hand-written contract with generated server stubs, because a second source drifts and the drift is found late; no contract, because nothing verifies that the two sides agree.

#### D5: The client defines the day

- **Context:** time is subtle, and it is where the method is proven.
- **Decision:** the client sends its local date and time zone; the API computes the window once and applies the same inclusion rules to the day agenda and the week agenda. The server never decides what day it is. A missing or invalid date or zone is rejected.
- **Consequences:** the day is the user's wall-clock day, and the daylight-saving logic exists once, with tests; domain tests check that the SQL forms agree with the domain rules. The client is trusted to send a truthful zone, and the API's time-zone data and PostgreSQL's are updated separately.
- **Status:** accepted ([ADR-0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md), [ADR-0024](../decisions/0024-week-agenda-endpoint-on-range-based-internals.md), [ADR-0057](../decisions/0057-chrono-time-types-for-the-rust-backend.md)).
- **Rejected alternative:** a UTC range from the client, because each client redoes the daylight-saving logic and whole-day items lose their local date; a stored time zone, because it is wrong when the user travels; the server's UTC day, because it is the wrong day for most zones.

#### D6: Run-time gates and path-scoped jobs in CI

- **Context:** agents wait on checks in every round, and the maintainer's attention is the scarce resource.
- **Decision:** each CI job is gated against a pinned run-time baseline, and a job runs only for the paths it checks; a CI result job runs on every change and tells a skip by design from a missing job.
- **Consequences:** a regression fails the run that caused it, and unaffected jobs cost nothing. A skipped job is a check not run, baselines must be re-pinned, and a regression smaller than the margin passes. A gate per job does not bound the total: full CI can grow while every job passes. The maintainer accepts the risk of a wrong skip.
- **Status:** accepted ([ADR-0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md), [ADR-0046](../decisions/0046-run-ci-jobs-only-for-the-paths-they-check.md)).
- **Rejected alternative:** no gate, because slowdowns accumulate unnoticed; every job on every change with a fixed ceiling, because of the waiting on jobs a change cannot affect. The panel rated this last one almost level with the decision.

#### D7: Review before merge, with a skeptic per finding

- **Context:** every defect the maintainer finds is a correction round; every false finding wastes the same attention.
- **Decision:** on request, reviewers examine a branch for performance and for security, and a skeptic tries to refute each finding before it reaches the maintainer.
- **Consequences:** findings arrive already tested and refuted ones stay visible. The review adds waiting and token cost outside CI. It runs only when asked, so it proves nothing on a pull request where nobody asked.
- **Status:** implemented, with no ADR, which is a known exception to the auditability target ([story 0035](../stories/0035-review-before-merge-with-a-workflow-and-a-skeptic-per-finding.md)).
- **Rejected alternative:** maintainer review only, because every missed defect becomes a correction round; reviewers without skeptics, because false findings reach the maintainer; review in CI on every pull request, because it lengthens every run and costs tokens on changes that do not need it.

### How the driving characteristics are met

| Characteristic | Target | How the architecture meets it |
| --- | --- | --- |
| Verifiability | The median pull request written by a delivery agent merges after at most 2 correction rounds | D1 and D4 check every change before the maintainer reads it, and D7 checks the changes it is requested for. What causes correction rounds today is not known, so whether these decisions address the main cause is not known either, and the outcome is not measured yet: risk 1 and the checkpoint. |
| Auditability | Every merged pull request links an issue or story card; every significant decision has an ADR accepted before its pull request merged | D3 gives the records and the loop gives the order. A hook checks the closing keyword on the pull request that completes a story card; nothing checks a link on every pull request or the status of an ADR at merge. The target is already missed once: D7 merged without an ADR. Risk 2 and the checkpoint. |
| Portability of the method | The bundle runs in another repository after only the edits its documentation lists | D2 makes only the guidance neutral to the harness. The skills and hooks of D1 run under Claude Code and need edits for another repository, and those edits are not listed yet. The bundle has never been copied; the next project is the test: risks 3, 4 and 11. |
| Delivery speed | No CI job slower than its pinned baseline; full CI under 5 minutes at p90 | D6 gates each job, which does not bound the total. The last measurement of full CI, before the Rust backend, was a p90 of 2:07; it has not been repeated since: risk 6 and the checkpoint. |
| Correctness of time | No event or task on the wrong day; the matrix passes in the domain rules and their SQL forms | D5, with tests for daylight-saving days and for agreement between the two forms. The size of the matrix is an open question. Risks 5, 7 and 12 cover what the tests do not. |

### Risks

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| 1 | Correction rounds are not measured, so the main target cannot be shown met or missed | high | high | The checkpoint, owned by the maintainer |
| 2 | A pull request merges without a link, or with an ADR still proposed, because both hold by convention only | medium | medium | The maintainer authorizes every merge; the ADR and issue sweeps find drift afterwards; the checkpoint measures the link rate; a check is an open question |
| 3 | Hooks and workflows run only under Claude Code, so a change in that harness or an adopter on another one loses the enforcement | medium | high | The guidance stays readable by any agent; ADR-0044 has a revisit trigger |
| 4 | The bundle has never been copied into another repository, and the record kit is not built, so portability is unproven | high | high | The maintainer's reuse of the bundle in the next project is the test; every edit made there is listed. Nothing verifies it before that |
| 5 | A job skipped for its paths hides a regression, for example a change of time-zone data or of an image | low | high | The CI result job tells a skip by design from a missing job; accepted by the maintainer |
| 6 | Full CI has not been measured since the Rust backend and may already exceed 5 minutes at p90 | medium | medium | The checkpoint; a p90 above 5 minutes opens a `performance` issue before any baseline is re-pinned |
| 7 | The API's time-zone data and PostgreSQL's diverge, so a domain rule and its SQL form disagree | low | medium | The agreement tests; update both together |
| 8 | The wait for reviewers and skeptics, outside CI, grows unmeasured, or the review is not requested | medium | medium | Measure it with the CI figures; the handover asks for the review before a merge |
| 9 | The maintainer's time stops, and with it every decision | medium | high | The method comes first and the application freezes; the records are public and complete enough to resume from |
| 10 | No public reader engages or adopts, so the first outcome is never observed | high | medium | The maintainer's reuse in the next project is the adoption that can be controlled |
| 11 | What the bundle needs (the tools' runtimes, the task runner, the version pins) is not documented for an adopter, so the edits its documentation lists are incomplete | high | medium | List the prerequisites when the minimal record kit is decided; the next project shows what was missed |
| 12 | A wrong client clock, a Today gone stale across midnight or a zone the API does not know gives the wrong day view with no signal | medium | medium | The API rejects an invalid zone; the web UI recomputes Today at local midnight and on focus ([ADR-0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md)); a truthful client is otherwise trusted |

#### The checkpoint

Before the next story card opens, the maintainer samples the last 30 merged pull requests by delivery agents once, for the median of correction rounds and for the share that link an issue or story card, and measures the p90 of full CI. A median above 2 or a p90 above 5 minutes opens an issue before any other work starts, and its lesson goes into guidance, a skill or a hook. The sample is repeated every 30 merged pull requests by delivery agents.

### Open questions

The maintainer decides each of these when it next blocks work; none has a date.

- Should a CI check fail a pull request without an issue or story card link, and stop a proposed ADR from merging?
- Which records form the minimal record kit of the bundle, with the docs site and the architecture model optional?
- Does review before merge deserve an ADR of its own?
- How large is the time matrix (zones, daylight-saving transitions, kinds of event and task, day agenda and week agenda), and should the time tests run on every change instead of only for their paths?
- What counts as the bundle running in another repository: which prerequisites, how many edits, and which task proves it?
- What makes a decision significant enough to need an ADR?
- What does the method cost: the wait and the tokens for each reviewed pull request, and the maintainer's minutes for each correction round?
