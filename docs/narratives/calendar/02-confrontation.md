## Act 2: Confrontation

### Constraints

**Business.** One maintainer is the whole human team, working in near full-time bursts with gaps between them; their attention is the scarcest resource, because every merge goes through them. Run cost is not tracked: the narrative assumes it stays within a personal budget and never forces a design choice (assumption A1). The project has no external deadline, contract or regulator; the deadline that matters is the field's, since practices for agents are being invented now.

**Technical.** Two sets of rules bind every change:

* **Agent rules.** Automation targets Claude Code first ([ADR-0044](../decisions/0044-claude-first-agent-automation.md)); hooks enforce the guidance's invariants ([ADR-0042](../decisions/0042-layered-agent-guidance-and-hooks.md)); agents decide nothing without the maintainer's acceptance.
* **Contract rules.** The API contract is generated from the backend and every user interface consumes it ([ADR-0004](../decisions/0004-openapi-contract-and-generated-client.md)); the client supplies today and its time zone ([ADR-0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md)); every event and task query takes the owner.

The hosting stack (GitHub, Azure, Google sign-in) and the toolchain pins are choices, not constraints: they have been changed before and can be again.

### Challenges

* **Agents forget between sessions.** A lesson that is not written into guidance, a skill, a hook or a story card is lost when the session ends. This follows from Act 1's measure that lessons must stop repeating.
* **One human reviewer.** Many agents can work in parallel, but one maintainer reviews and merges, in bursts. Work that waits on review waits for the maintainer's next burst.
* **Time is subtle.** A date-only deadline has no time zone; an event has an exact time; today is the owner's date in the owner's zone, and daylight saving moves the day's length. The same rules must hold in the Rust domain and in the SQL that reads the database.
* **Stacks change underneath.** The backend moved from .NET to Rust and the repository tooling from .NET to Deno while features kept shipping. A change of stack is a normal event, not an exception.

### Driving characteristics

| Characteristic | Business requirement | Target |
| --- | --- | --- |
| Verifiability | The median agent pull request merges after at most 2 maintainer correction rounds | At most 2 correction rounds at the median (the outcome); every fix carries a test proven to fail without it, and `just check` runs what CI runs (the mechanism) |
| Delivery speed | Agents wait on checks every round, so slow CI multiplies across sessions; the maintainer reviews in bursts, so a pull request must be checkable in one sitting | No CI job slower than its pinned baseline ([ADR-0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md)); the full CI run under 15 minutes at p90 |
| Correctness of time | Today has to mean today in the owner's own time zone; time is the method's showcase, the hardest correctness problem in the product | Zero day-boundary defects across daylight-saving and time-zone changes (the outcome); a fixed matrix of zones and transitions passing for the day and week agendas, in domain and SQL forms (the evidence) |
| Security and privacy | Every read and write belongs to one owner, in a public repository | No owner can read or change another owner's data, tested per endpoint; no secret or private path reaches the public repository or a post, enforced by hooks |

Correctness of time drives the design although the owner does not yet rely on Calendar every day: it is where the method has to prove it can get subtle rules provably right.

The threats that matter for security and privacy are leaked secrets and private details, a compromised dependency or GitHub Action, and text in issues, pull requests or files that tries to steer an agent.

Candidates considered and set aside: **evolvability**, because it follows from verifiability (the stack migrations were safe because of the tests and the contract); **portability**, because it is a property of the agent tooling rather than of the system's architecture; **cost**, because with one user it never forced a design choice.

### Alternatives

Each decision below lists what was chosen first, then the alternatives weighed against the driving characteristics. The panel's disagreements, and how they were settled, follow each table.

#### How user interfaces learn the API

| Alternative | Strengths | Weaknesses against the driving characteristics |
| --- | --- | --- |
| **OpenAPI generated from the code, typed client generated from it** (chosen) | A stale contract fails CI, so client and server cannot drift unseen (verifiability) | A regeneration step in every API change (delivery speed, small) |
| Hand-written OpenAPI with generated server stubs | The contract is designed first | The document and the code can disagree until a stub is regenerated (verifiability) |
| Hand-written TypeScript types and fetch calls | Nothing to generate | Drift is found by users, not by CI (verifiability) |
| gRPC or GraphQL | Strong schemas | Tooling and runtime the rest of the stack does not need; a browser needs a gateway (delivery speed) |

#### Who decides what day it is

| Alternative | Strengths | Weaknesses against the driving characteristics |
| --- | --- | --- |
| **The client sends its local date and IANA zone; the server computes the window** (chosen) | Uses the zone of the device in hand; every request is a complete, testable description (correctness of time, verifiability) | Two clients in different zones can see different todays, by design |
| The client sends a UTC range | Simple for the server | Day rules live in every client, untested against the SQL forms (correctness of time) |
| A time zone stored per user | One place to change | Wrong while travelling; needs settings the single user does not want (correctness of time, end user) |
| A server-defined UTC day | Simplest | Wrong for every owner outside UTC (correctness of time) |

#### How each owner's data stays theirs

| Alternative | Strengths | Weaknesses against the driving characteristics |
| --- | --- | --- |
| **An explicit owner parameter on every query, typed as `OwnerId`, plus a least-privilege database role** (chosen) | A query without an owner does not compile; isolation is tested per endpoint (security, verifiability) | Isolation depends on each query's filter, not on the database (security) |
| A framework-wide query filter | Isolation by default | Chosen under .NET ([ADR-0041](../decisions/0041-per-user-data-ownership.md)); there is no equivalent in Diesel, so the Rust port replaced it with the explicit parameter, which ADR-0041 had rejected. The record has not caught up yet |
| PostgreSQL row-level security | Defence in depth: the database refuses another owner's rows | A session variable per transaction, harder tests and debugging (delivery speed, verifiability) |

The Security expert asked for row-level security as defence in depth; the Delivery speed and Verifiability experts held that the `OwnerId` type and the per-endpoint ownership tests already make a missing filter hard to write. Not settled: row-level security is an open question.

#### Which backend stack

| Alternative | Strengths | Weaknesses against the driving characteristics |
| --- | --- | --- |
| **Rust on axum, replacing the .NET API in place** ([ADR-0051](../decisions/0051-rust-backend-on-axum-and-tokio.md)) (chosen) | Learning a new stack on real code is part of the method; strong types and Clippy catch errors before review (verifiability) | Longer builds and lint in CI (delivery speed) |
| Rust beside .NET, moved route by route | Lower risk per step | Two backends and two containers for the length of the move (delivery speed, verifiability) |
| Stay on .NET | No migration | The learning goal is not met (business) |

The Delivery speed expert objected that Rust builds, Clippy and database tests lengthen CI against the 15-minute target. Settled: an accepted cost, held in check by the run-time gate and by running each job only for the paths it checks.

#### Where decisions and scope are recorded

| Alternative | Strengths | Weaknesses against the driving characteristics |
| --- | --- | --- |
| **Story cards and ADRs in the repository, with a docs-only first pull request (PR 0) per story** (chosen; [ADR-0000](../decisions/0000-use-markdown-architectural-decision-records.md), [ADR-0028](../decisions/0028-publish-user-stories-on-the-documentation-site.md)) | Agents read the same records they change; scope is reviewable before code (verifiability); the records outlive sessions (agents forget) | PR 0 adds a review round to every story (delivery speed) |
| Issues, commit messages and PR descriptions only | No extra files | Decisions scatter and agents cannot find them (verifiability) |
| An external wiki | Easy editing | Not reviewed with the code, not visible to agents in the repository (verifiability) |

The Delivery speed expert objected to the extra round. Settled: PR 0 stays, and delivery pull requests stack on it at once, so nothing waits for acceptance.

#### How agents are guided

| Alternative | Strengths | Weaknesses against the driving characteristics |
| --- | --- | --- |
| **Layered guidance (a short root `AGENTS.md`, area files and skills) with hooks that enforce its invariants** ([ADR-0042](../decisions/0042-layered-agent-guidance-and-hooks.md)) (chosen) | Each session loads only what it needs; hooks stop a destructive or leaking action before it happens (verifiability, security) | Hooks are tooling to maintain, and add a little latency to tool calls |
| One long prose file | Simple | Costly to load every session and nothing enforces it (verifiability) |
| Checks in lint and CI only | No agent-specific tooling | Catches a leak after it is pushed, not before (security) |

#### How changes are reviewed before merge

| Alternative | Strengths | Weaknesses against the driving characteristics |
| --- | --- | --- |
| **Performance and security reviewers, then three skeptics per finding, as a workflow on code pull requests** (chosen) | Findings reach the maintainer already tested for truth, reproduction and impact (verifiability) | Time and tokens on every code pull request (delivery speed) |
| A single reviewer with no skeptics | Cheaper | False positives spend the maintainer's attention (business) |
| Human review only | No agent cost | The maintainer becomes the only check, and the bottleneck (delivery speed, verifiability) |
| Reviewers as a CI job on every push | Automatic | Runs on every push, not just before merge (delivery speed) |

The Delivery speed expert objected to the cost; the Verifiability and Business experts held that it protects the correction-rounds target. Settled: worth it on code pull requests only; docs-only pull requests skip it.

#### How delivery is measured

| Alternative | Strengths | Weaknesses against the driving characteristics |
| --- | --- | --- |
| **Path-filtered CI jobs, a run-time gate per job against a pinned baseline, and a dashboard built from daily snapshots** ([ADR-0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md), [ADR-0046](../decisions/0046-run-ci-jobs-only-for-the-paths-they-check.md), [ADR-0049](../decisions/0049-build-the-delivery-dashboard-from-daily-snapshots-on-the-docs-site.md)) (chosen) | A regression in CI time fails a check; skipped jobs cost nothing; the history is public and needs no service (delivery speed) | Statistics and rules to maintain; a gate can fail falsely |
| Run every job on every change | Simplest | Every change pays for every check (delivery speed) |
| A hosted analytics service | Rich dashboards | Another service and its data outside the repository (security, business) |
| No timing gate | No false failures | Slowdowns are noticed late, after they multiply (delivery speed) |
