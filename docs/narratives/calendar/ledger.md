# Ledger: Calendar

Never published or stitched. The interview resumes from this file.

## Progress

| Act | State |
| --- | --- |
| Act 1: Setup | drafted 2026-11-13; review in its pull request (the maintainer asked for each act to be reviewed as a PR) |
| Driving characteristics | open |
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

## Panel

| Id | Role | Name |
| --- | --- | --- |

### Synergy/conflict map

| Pair | Relation | Reason |
| --- | --- | --- |

### Rounds

| Phase | Date | Answered | Returned nothing | What changed |
| --- | --- | --- | --- | --- |

## Options

Mode: keep-parts. Panel appendix: yes.
