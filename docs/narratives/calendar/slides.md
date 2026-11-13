---
title: Calendar architecture narrative
---

# Calendar

Architecture narrative for new contributors, human and agent

---

# Act 1: The problem

- Software written by AI coding agents cannot yet be trusted without close human checking
- Calendar develops and tests the **method** that makes agent delivery dependable
- The planning application is the **vehicle**: real, and small enough for one person to own
- **Why now:** agents became capable enough, but the practices are missing, and the maintainer's skill gap widens without hands-on work

---

# Outcomes, and who decides

- A reusable method others adopt: the bundle works in another repository
- The median pull request by a delivery agent merges after **at most 2 correction rounds**
- Personal depth in agentic engineering

| Role | Decides |
| --- | --- |
| Maintainer | Scope, every ADR, every merge |
| Delivery agent | Nothing: it proposes |
| Reviewer and skeptic | Nothing: they report and refute findings |
| Public reader | Whether to copy the method, and which pieces |

---

# Context

```mermaid
flowchart LR
    maintainer([Maintainer])
    agents([Delivery agents, reviewers and skeptics])
    readers([Public readers])
    subgraph repo[Calendar repository]
        app[Calendar application<br/>web UI, API, PostgreSQL]
        method[Method<br/>guidance, skills, hooks, ADRs, story cards]
        site[Docs site]
    end
    google[Google sign-in]
    github[GitHub<br/>issues, pull requests, CI, Pages]
    maintainer -->|plans the day and week| app
    maintainer -->|sets scope, accepts ADRs, authorizes merges| github
    agents -->|follow| method
    agents -->|propose changes as pull requests| github
    app -->|signs the owner in with| google
    github -->|checks and publishes| repo
    readers -->|read the evidence, lift pieces| site
```

One user, the maintainer, occasionally. Local only. Out of scope: sharing, sync with other calendars, native mobile apps.

---

# Act 2: Constraints and challenges

**Binding rules**

- Agent rules: agents propose and never decide; automation for Claude Code first; hooks stop forbidden actions
- Contract rules: a generated contract; the client supplies Today; every query takes the owner

**Challenges**

- Agents forget between sessions
- One human decides, in bursts
- Time is subtle, in two forms: domain and SQL
- The method must leave, as a bundle

---

# Driving characteristics

| Characteristic | Target |
| --- | --- |
| Verifiability | Median of at most 2 correction rounds |
| Auditability | Every merged pull request links an issue or story card; every significant decision has an accepted ADR first |
| Portability of the method | The bundle runs elsewhere after only its documented edits |
| Delivery speed | No CI job over its baseline; full CI under 5 minutes at p90 |
| Correctness of time | No event or task on the wrong day; the matrix passes in domain and SQL forms |

Set aside: security and privacy, evolvability, cost.

---

# The closest calls

- **CI time:** path-scoped jobs with run-time gates (2.1 of 3) against every job on every change (2.0). A skipped job is a check not run; the risk is accepted
- **Hooks against portability:** hooks cut correction rounds but tie the bundle to Claude Code and to this repository's paths; accepted
- **Records against portability:** the records are the evidence, and weight for an adopter; the direction is a minimal record kit

---

# Act 3: The application

```mermaid
flowchart TB
    maintainer([Maintainer])
    subgraph app[Calendar application]
        web[Web UI<br/>React, generated typed client]
        api[API<br/>Rust, axum]
        db[(PostgreSQL)]
    end
    contract[[Contract<br/>contracts/openapi.json]]
    google[Google sign-in]
    maintainer -->|"Today: local date and time zone"| web
    web -->|"day agenda, week agenda, events, tasks"| api
    api -->|"every query takes the owner"| db
    api -->|signs the owner in with| google
    api -.->|generates| contract
    contract -.->|generates the client of| web
```

---

# Act 3: The method

```mermaid
flowchart LR
    issue[Issue] --> card[Story card]
    card --> adr[ADR<br/>accepted by the maintainer]
    adr --> change[Change by a delivery agent<br/>guidance, skills, hooks]
    change --> ci[CI<br/>path-scoped jobs, run-time gates]
    change --> review[Reviewers and skeptics<br/>on request]
    ci --> merge{Maintainer<br/>authorizes the merge}
    review --> merge
    merge -->|correction round| change
    merge --> main[main and the docs site]
    main -->|lesson from a miss| guidance[Guidance, skill or hook]
    guidance --> change
```

---

# Decisions

- **D1** Layered guidance with hooks, over prose in one file
- **D2** Claude Code first for automation, over a twin of every automation
- **D3** ADRs and story cards in the repository, over no formal records
- **D4** A contract generated from the API, over a hand-written one
- **D5** The client defines the day, over a UTC range or a stored zone
- **D6** Run-time gates and path-scoped jobs, over every job on every change
- **D7** Review before merge with a skeptic per finding, over maintainer review only

---

# Where the targets stand

- Correction rounds: **not measured yet**
- Links and ADR acceptance: **by convention only**; review before merge has no ADR
- The bundle: **never copied**; the next project is the test
- Full CI: p90 of 2:07 **before the Rust backend**, not measured since

**The checkpoint:** before the next story card opens, sample the last 30 merged pull requests by delivery agents and measure full CI. A median above 2 or a p90 above 5 minutes opens an issue first.

---

# Top risks and open questions

| Risk | Likelihood | Impact |
| --- | --- | --- |
| Portability is unproven | high | high |
| Correction rounds are unmeasured | high | high |
| Enforcement depends on Claude Code | medium | high |
| The maintainer's time stops | medium | high |
| A skipped job hides a regression | low | high |

Open: a link and ADR check in CI, the minimal record kit, an ADR for review before merge, the size of the time matrix, what counts as the bundle running, what makes a decision significant, what the method costs.
