# Ledger: Calendar

Never published or stitched. The interview resumes from this file.

## Progress

| Act | State |
| --- | --- |
| Act 1: Setup | confirmed 2026-11-13 |
| Driving characteristics | confirmed 2026-11-13 |
| Act 2: Confrontation | confirmed 2026-11-13 |
| Act 3: Resolution | confirmed 2026-11-13 |

## Inputs (2026-11-13)

* System: Calendar, slug `calendar`. Rebuilt from scratch at the maintainer's request; the earlier narrative on `main` is not an input.
* Audience: new contributors, human and agent, who need to know why the system looks the way it does before changing it.
* Material: README.md, AGENTS.md, docs/decisions, docs/stories, docs/architecture/calendar.architecture.json.

## Gaps

| Id | Act | Gap | State | Answer or assumption |
| --- | --- | --- | --- | --- |
| S1 | 1 | Problem | closed | "Dependable AI-assisted engineering": agent-written software cannot yet be trusted; the planning app is the vehicle used to develop and test the practices (2026-11-13). |
| S2 | 1 | Context | closed | Material (README.md, AGENTS.md): a public monorepo with a Rust backend (axum, Diesel, PostgreSQL), a React web UI, a contract-first OpenAPI client, Google sign-in with a cookie session and allow-listed emails, a docs site on GitHub Pages and Azure infrastructure as Bicep. Deployment today: "Local only"; the Azure infrastructure (ADR-0029 to ADR-0035) is defined but not deployed. |
| S3 | 1 | Motive | closed | Outcomes: "a reusable method others adopt", "personal depth in agentic engineering", "fewer corrections per agent PR"; not "a planning app I use daily". Measures: "median of at most 2 rounds" of maintainer correction per agent PR; adopted means a copied skill works elsewhere, another repository adopts the set (guidance, skills, hooks), the maintainer reuses it in the next project, and readers engage publicly. |
| S4 | 1 | Why now | closed | "Agents became capable enough" (but the practices that make their output dependable are missing) and "my own skill gap" (without hands-on work now it widens). No team or employer need. |
| S5 | 1 | Stakeholders | closed | Maintainer (owner and only user: sets scope, accepts ADRs, authorizes every merge); delivery agents (design, implement, post on issues; propose only); reviewer and skeptic agents (report and try to refute findings before merge; propose only); public readers (need evidence the method works and pieces they can lift; decide whether and what to copy). "Agents propose, maintainer decides." |
| S6 | 1 | Users | closed | "Only me, occasionally": one allow-listed account, used to prove features, not relied on daily. |
| S7 | 1 | Scope | closed | In: today and week views, events, tasks with date or exact-time deadlines, overdue triage, Google sign-in, themes; the docs site, the delivery dashboard and the agent tooling. Out: sharing and invitations, sync with other calendars, native mobile apps. Recurring events: "future, not planned". |
| S8 | 1 | Vocabulary | closed | Seventeen terms proposed from the material and confirmed 2026-11-13; Bundle, Harness and Baseline added on confirmation of Act 3 (see 01-setup.md). |
| K1 | - | Candidates | closed | Eight candidates from the catalogue, each tied to an Act 1 statement: verifiability, auditability, portability of the method, delivery speed, security and privacy, correctness of time, evolvability, cost. |
| K2 | - | Driving set | closed | Five, confirmed 2026-11-13 (see "Driving characteristics"). |
| C1 | 2 | Business constraints | closed | One maintainer in "bursts, method first": near full-time bursts with gaps; if time runs short the method stays the priority and the application freezes. No employer, deadline, contract or regulator. |
| C2 | 2 | Technical constraints | closed | Binding: "agent rules" (agents propose and never decide; automation Claude Code first per ADR-0044 while guidance stays readable by any agent; hooks stop forbidden actions) and "contract rules" (generated contract consumed by every UI; the client supplies Today; every event and task query takes the owner). Not binding: the platform (GitHub, public repository, Linux/WSL, Docker) and the stack and pins. |
| C3 | 2 | Challenges | closed | Four: agents forget between sessions; one human decides, in bursts; time is subtle, in two forms; the method must leave as a bundle for a repository that shares none of this stack. |
| C4 | 2 | Characteristics | closed | The five driving characteristics with requirement and target. |
| C5 | 2 | Alternatives | closed | "Seven: drop 8 and 9": guidance and hooks (ADR-0042), harness (ADR-0044), records (ADR-0000, ADR-0028), contract (ADR-0004), the day (ADR-0021), CI time (ADR-0045, ADR-0046), review before merge (story 0035). Alternatives from the ADRs; for review before merge from the maintainer: maintainer review only, reviewers without skeptics, review in CI on every pull request. |
| R1 | 3 | Architecture | closed | The application (containers.mmd) and the method loop (method.mmd). |
| R2 | 3 | Decisions | closed | D1 to D7 as inline ADR summaries with links; D7 has no ADR (story 0035). |
| R3 | 3 | Characteristics met | closed | Per target, the decisions that meet it and the risks that cover the shortfall. |
| R4 | 3 | Risks | closed | Twelve risks after the review; first ten ratings proposed by the facilitator: "they hold" (2026-11-13). |
| R5 | 3 | Panel review | closed | End user signed off; six experts objected with 19 objections. Settled 2026-11-13: "apply all five" wording revisions; "adopt the checkpoint"; risk 1 impact to high and risk 6 impact to medium accepted, risk 7 likelihood kept low; "all: 2 risks, 4 open questions". Outcomes by role in 05-panel.md. |
| R6 | 3 | Open questions | closed | Seven after the review, decided by the maintainer "when it next blocks work", "no date". Portability verification: "next project is the test". |
| C6 | 2 | Panel verdicts | closed | Leading alternative won every decision on the panel's average (2.1 to 2.6 of 3). Settled with the maintainer: CI time "keep path-scoped, accept the risk"; hooks against portability "accepted trade-off"; records "minimal kit as direction" (open question); link and ADR-status check "open question: add a check". |
| P1 | 2 | Correction rounds: counting rule, sample and baseline (verifiability, auditability, business) | closed | "Not measured yet". Rule: any maintainer comment or review that forces a new push counts, CI-only fixes do not; first baseline over the last 30 merged agent pull requests. Shown as a risk. |
| P2 | 2 | Maintainer's time budget and what happens if it shrinks (business) | closed | See C1. |
| P3 | 2 | Portability: which skills are the test, harness scope, how it is verified (portability) | closed | "Bundle holds": the unit of portability is the bundle (guidance, skills and hooks copied together), on Claude Code. Verification not yet stated: carried to Act 3 as a risk or open question. |
| P4 | 2 | Delivery speed: baseline of full CI, what blocks a merge, what gives on a miss (delivery speed) | closed | "Measured, reviewers excluded": benchmark 0016 (before the Rust backend) measured a pull request run at median 1:38, p90 2:07, n = 40. Ceiling lowered to 5 minutes at p90. No record since Rust found: to state in the narrative. Reviewer and skeptic runs are outside CI. |
| P5 | 2 | Auditability: what enforces the PR link and ADR acceptance before merge; which records must survive a session (auditability) | closed | "Convention only": nothing blocks; it holds because the maintainer authorizes every merge. Carried to Act 3 as a risk. |
| P6 | 2 | Miss response: who notices a missed target and what follows (verifiability, delivery speed) | closed | "Issue, then guidance or hook": a miss becomes an issue; the fix carries a test that fails without it, and the lesson goes into guidance, a skill or a hook. |
| P7 | 2 | Time: what counts as the wrong day per item kind, the matrix contents, how domain and SQL forms are shown to agree, invalid or skewed client input (correctness of time) | closed | From the material: ADR-0021 defines inclusion per item kind and returns 400 for a missing or invalid date or zone; the domain tests cover DST days and check that the SQL forms agree with the domain rules; ADR-0057 records that the API's zone data and PostgreSQL's are updated separately (risk). |
| P8 | 2 | User-facing qualities given up because the only user is the maintainer; what a failed session shows (end user) | closed | Given up: availability and operations, accessibility beyond contrast, small screens. |
| P9 | 2 | Accepted lock-in and outcome risks (business) | open | Carries into Act 3 risks. |

## Contradictions

| Statements | Resolution |
| --- | --- |
| "Only me, occasionally" and no daily planning app as an outcome vs correctness of time driving with a zero-wrong-day target | "Both: time is the method's proof": it is the hardest correctness problem in the vehicle, so it is where the method is proven, whatever the usage (2026-11-13). |
| "A copied skill works elsewhere after only the edits its README lists" vs skills portable "bundle only" | "Bundle holds": the unit of portability is the bundle; Act 1 and the target reworded (2026-11-13). |
| Security and privacy first picked as a characteristic whose absence fails the project vs set aside when narrowing to five | Set aside: with one user and local-only running it is hygiene rather than a force on the design (the maintainer's choice when asked which to drop, 2026-11-13). |

## Assumptions

| Id | Statement | Agreed | Risk |
| --- | --- | --- | --- |

## Driving characteristics

| Characteristic | Requirement | Target | State |
| --- | --- | --- | --- |
| Verifiability | "Fewer corrections per agent PR": "median of at most 2 rounds" | The median pull request written by a delivery agent merges after at most 2 correction rounds | driving |
| Auditability | Public readers need "evidence the method works"; "agents propose, maintainer decides" | "Every change traceable": 100% of merged pull requests link an issue or story card, and every significant decision has an ADR accepted by the maintainer before its pull request merges | driving |
| Portability of the method | "A reusable method others adopt"; "bundle holds" | The bundle (guidance, skills and hooks copied together) runs in another repository after only the edits its documentation lists | driving |
| Delivery speed | One maintainer decides everything while agents wait on checks | No CI job slower than its pinned baseline (the ADR-0045 gate) and full CI under 5 minutes at p90 (lowered from 15 on 2026-11-13) | driving |
| Correctness of time | "Today" is the date and time zone the client supplies | Zero events or tasks on the wrong day; a fixed matrix of time zones and DST transitions passes for the day and week agendas, in the domain rules and in their SQL forms | driving |
| Security and privacy | A public repository, an allow-listed sign-in, an owner on every event and task | - | set aside: with one user and local-only running it is hygiene, not a force on the design |
| Evolvability | The application is a vehicle whose stacks can be replaced | - | set aside: not picked as a characteristic whose absence fails the project |
| Cost | One occasional user, local only | - | set aside: not picked; nothing is deployed, so run cost forces nothing |

## Panel

| Id | Role | Name |
| --- | --- | --- |
| verifiability | characteristic | Verifiability expert |
| auditability | characteristic | Auditability expert |
| portability | characteristic | Portability expert |
| delivery-speed | characteristic | Delivery speed expert |
| time-correctness | characteristic | Correctness of time expert |
| end-user | end-user | End-User expert |
| business | business | Business expert |

### Synergy/conflict map (confirmed 2026-11-13)

| Pair | Relation | Reason |
| --- | --- | --- |
| verifiability / auditability | synergy | A fix's failing test and check results are part of the trail a reader audits |
| verifiability / portability | conflict | The hooks and checks that enforce the method are tied to this repository's tools and to Claude Code, which a copied skill cannot assume |
| verifiability / delivery-speed | conflict | Each check, reviewer and skeptic adds waiting time |
| verifiability / time-correctness | synergy | Time rules need exhaustive tests in domain and SQL forms |
| verifiability / end-user | conflict | Rigour delays features the one user waits for |
| verifiability / business | synergy | At most 2 correction rounds is itself the business measure |
| auditability / portability | conflict | Record conventions (ADRs, story cards, issue trail) add to what an adopter must take on |
| auditability / delivery-speed | conflict | A card first, ADR acceptance and issue posts add steps before delivery |
| auditability / business | synergy | The records are the evidence public readers judge by |
| portability / business | synergy | Adoption elsewhere is the outcome wanted |
| delivery-speed / time-correctness | conflict | The zone and DST matrix plus database tests add CI minutes |
| delivery-speed / end-user | synergy | Faster delivery means features sooner |
| delivery-speed / business | synergy | Maintainer attention is the scarce resource |
| time-correctness / end-user | synergy | The user's day must be the right day |
| end-user / business | conflict | When they pull apart, the method wins over the product |

Neutral: auditability with time-correctness and end-user; portability with delivery-speed, time-correctness and end-user; time-correctness with business.

### Rounds

| Phase | Date | Answered | Returned nothing | What changed |
| --- | --- | --- | --- | --- |
| review | 2026-11-13 | 7 of 7, each with a rebuttal | none | One sign-off, six objections; Act 3 revised, risks 11 and 12, the checkpoint and four open questions added (R5). |
| alternatives | 2026-11-13 | 7 of 7, each with a rebuttal | none | 23 alternatives rated; four trade-offs settled (C6); evidence wanted carried to Act 3: post-Rust CI p90, domain and SQL parity, zone data drift, wait outside CI. |
| questions | 2026-11-13 | 7 of 7, each with a rebuttal where the map pairs it | none | New gaps P1 to P9, merged from 28 questions. |

## Accepted check failures

| Check | What failed | Accepted | The user's words |
| --- | --- | --- | --- |

## Options

Mode: keep-parts. Panel appendix: yes.
