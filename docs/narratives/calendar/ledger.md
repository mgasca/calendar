# Ledger: Calendar

Never published or stitched. The interview resumes from this file.

## Progress

| Act | State |
| --- | --- |
| Act 1: Setup | drafted 2026-11-13; review in its pull request (the maintainer asked for each act to be reviewed as a PR) |
| Driving characteristics | confirmed 2026-11-13 |
| Act 2: Confrontation | open |
| Act 3: Resolution | open |

## Inputs (2026-11-13)

* System: Calendar, slug `calendar`.
* Audience: new contributors, human and agent, who need to know why the system looks the way it does before changing it.
* Material: README.md, AGENTS.md, docs/decisions, docs/stories, docs/architecture/calendar.architecture.json.

## Gaps

| Id | Act | Gap | State | Answer or assumption |
| --- | --- | --- | --- | --- |
| S1 | 1 | Problem | closed | "Both, equally": a useful personal planning product (one view of today's events and tasks, including overdue, in the user's own time zone) and a deliberate exploration of how to make AI-assisted software engineering dependable (README, agent thought 0001). |
| S2 | 1 | Context | closed | Monorepo; Rust backend (axum, Diesel, PostgreSQL); React SPA; contract-first OpenAPI client; Google sign-in, cookie session, allow-listed emails; docs site on GitHub Pages. Staging runs on Azure Container Apps; production is not live (#85). |
| S3 | 1 | Motive | closed | "Share a reusable method". Measures: a copied skill works in another repo; another repo adopts the guidance, skills and hooks; repeated lessons fall month over month (dream-weaver reports); the median agent PR merges after at most 2 maintainer correction rounds. |
| S4 | 1 | Why now | closed | Both: agentic coding crossed a usefulness threshold in 2026 but practices that make its output dependable do not exist yet; and the maintainer needs hands-on depth now. If nothing is done, agent output stays untrustworthy and the skill gap widens. |
| S5 | 1 | Stakeholders | closed | Maintainer (owner: scope, accepts ADRs, performs every merge); delivery agents (Claude Code, Codex: design, implement, post on issues, decide nothing without acceptance); reviewer and skeptic agents (find and refute findings before merge); public readers (decide whether the method is worth copying). |
| S6 | 1 | Users | closed | Just the maintainer, through an allow-listed Google account. |
| S7 | 1 | Scope | closed | In: today and week views, events, tasks with date or exact-time deadlines, overdue triage, sign-in, themes; docs site, delivery dashboard, agent tooling. Out: sharing and invitations, sync with other calendars, native mobile apps. Future, not planned: recurring events. |
| S8 | 1 | Vocabulary | closed | Product, delivery, agent-method and contract terms (see 01-setup.md). |

## Contradictions

| Statements | Resolution |
| --- | --- |
| Problem is product and method "both, equally" vs success is "share a reusable method" | Method wins when they pull apart; the product is the vehicle (2026-11-13). |

## Assumptions

| Id | Statement | Agreed | Risk |
| --- | --- | --- | --- |

## Driving characteristics

| Characteristic | Requirement | Target | State |
| --- | --- | --- | --- |
| Verifiability | "The median agent pull request merges after at most 2 maintainer correction rounds" | Median agent PR merges after at most 2 correction rounds (outcome); every fix carries a test proven to fail without it, and `just check` runs what CI runs (mechanism) | driving |
| Delivery speed | Agents wait on checks every round, so slow CI multiplies across sessions; the maintainer reviews in bursts, so a PR must be checkable in one sitting | No CI job slower than its pinned baseline (ADR-0045 gate); full CI under 15 minutes at p90 | driving |
| Correctness of time | "Today has to mean today in the owner's own time zone" | Zero day-boundary defects (no event or task on the wrong day, across DST and time-zone changes) as the outcome; a fixed matrix of zones and DST transitions passing for the day and week agendas, in domain and SQL forms, as the evidence | driving |
| Security and privacy | Every read and write is scoped to one owner, in a public repository | No owner can read or change another owner's data, tested per endpoint; no secret or private path reaches the public repository or a post, enforced by hooks | driving |
| Evolvability | "Method wins; the product is the vehicle" | - | set aside: falls out of verifiability (the stack migrations were safe because of tests and the contract) |
| Portability | "A copied skill works in another repository" | - | set aside: a property of the agent tooling, not of the system's architecture |
| Cost | One user on Azure | - | set aside: with one user it never forced a design choice |

## Panel

| Id | Role | Name |
| --- | --- | --- |
| verifiability | characteristic | Verifiability expert |
| delivery-speed | characteristic | Delivery speed expert |
| time-correctness | characteristic | Correctness of time expert |
| security | characteristic | Security and privacy expert |
| end-user | end-user | End-User expert |
| business | business | Business expert |

### Synergy/conflict map (confirmed 2026-11-13)

| Pair | Relation | Reason |
| --- | --- | --- |
| verifiability / delivery-speed | conflict | Each check, reviewer and skeptic adds feedback time |
| verifiability / time-correctness | synergy | Time rules need exhaustive tests in domain and SQL forms |
| verifiability / security | synergy | Owner isolation is proven by per-endpoint tests and leaks are blocked by hooks |
| verifiability / end-user | conflict | Rigour delays features the user is waiting for |
| verifiability / business | synergy | At most 2 correction rounds is itself a business measure of the method |
| delivery-speed / time-correctness | conflict | The DST and zone matrix plus database tests add CI minutes |
| delivery-speed / security | conflict | Security review, CodeQL and dependency review lengthen CI |
| delivery-speed / end-user | synergy | Faster delivery means features sooner |
| delivery-speed / business | synergy | Maintainer attention and agent run time are the scarce resources |
| time-correctness / security | neutral | No shared trade-off |
| time-correctness / end-user | synergy | The user's day must be the right day |
| time-correctness / business | neutral | No shared trade-off |
| security / end-user | conflict | The allow-list and sign-in add friction for a single user |
| security / business | synergy | The public repository is how the method is shared; a leak would destroy trust in it |
| end-user / business | conflict | When they pull apart, the method wins over the product |

### Rounds

| Phase | Date | Answered | Returned nothing | What changed |
| --- | --- | --- | --- | --- |
| questions | 2026-11-13 | 0 | all six | Nothing: the session that ran it started before `narrative-expert` merged, so the agent type was not registered and every agent failed before starting (the workflow's result did not say why). Rerun from a session started after the merge. |

## Options

Mode: keep-parts. Panel appendix: yes.
