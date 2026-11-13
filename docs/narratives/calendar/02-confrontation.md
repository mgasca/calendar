## Act 2: Confrontation

### Constraints

Business:

* One maintainer, working in near full-time bursts with gaps. If time runs short, the method stays the priority and the application freezes.
* No employer, deadline, contract or regulator.

Technical, binding on any solution:

* **Agent rules.** Agents propose and never decide. Automation is written for Claude Code first ([ADR-0044](../decisions/0044-claude-first-agent-automation.md)) while the guidance stays readable by any agent. A hook stops a forbidden action before it happens.
* **Contract rules.** The contract is generated from the API and every UI consumes it. The client supplies Today. Every query for an event or a task takes the owner.

Not binding: the platform (GitHub, a public repository, Linux or WSL, Docker) and the stack with its version pins are choices, open to change; the backend has already moved from .NET to Rust.

Given up on purpose, because the only user is the maintainer and nothing is deployed: availability and operations, accessibility beyond readable contrast in both themes, and small screens.

### Challenges

* **Agents forget.** A delivery agent keeps nothing between sessions, so whatever it must know has to live in guidance, records or a hook.
* **One human decides.** The maintainer is the only reviewer and decider, and works in bursts. Every correction round spends the scarcest resource.
* **Time is subtle.** Day boundaries, time zones and daylight-saving changes are easy to get wrong in ways tests miss, and each rule exists in two forms: in the domain and in SQL.
* **The method must leave.** Practices proven here must work, as a bundle of guidance, skills and hooks, in a repository that shares none of this one's stack.

### Driving characteristics

| Characteristic | Business requirement | Target |
| --- | --- | --- |
| Verifiability | Fewer corrections: an agent's change is proven right by checks before the maintainer reads it | The median pull request written by a delivery agent merges after at most 2 correction rounds |
| Auditability | Public readers need evidence that the method works; agents propose and the maintainer decides | Every merged pull request links an issue or story card, and every significant decision has an ADR the maintainer accepted before its pull request merged |
| Portability of the method | A reusable method others adopt | The bundle of guidance, skills and hooks runs in another repository after only the edits its documentation lists |
| Delivery speed | One maintainer decides everything while agents wait on checks | No CI job slower than its pinned baseline, and full CI under 5 minutes at p90 |
| Correctness of time | Today is the date and time zone the client supplies | No event or task on the wrong day; a fixed matrix of time zones and daylight-saving transitions passes for the day agenda and week agenda, in the domain rules and in their SQL forms |

Where the targets stand: correction rounds are not measured yet (the counting rule is that any maintainer comment or review that forces a new push counts, and a fix for CI alone does not; the first baseline is the last 30 merged pull requests by delivery agents). The links and the ADR acceptance hold by convention only, because the maintainer authorizes every merge. Full CI was last measured before the Rust backend, at a median of 1:38 and a p90 of 2:07 over 40 pull request runs ([benchmark 0016](../benchmarks/0016-ci-jobs-by-changed-paths.md)); reviewer and skeptic runs happen outside CI. A missed target becomes an issue, its fix carries a test that fails without it, and the lesson goes into guidance, a skill or a hook.

Time correctness drives the design although the application is used only occasionally: it is the hardest correctness problem in the vehicle, so it is where the method is proven.

Candidates considered and set aside: security and privacy (with one user and nothing deployed it is hygiene, not a force on the design), evolvability (not a characteristic whose absence fails the project) and cost (nothing is deployed, so run cost forces nothing).

### Alternatives

#### How agents learn and are held to the rules

| Alternative | Strengths | Weaknesses against the driving characteristics |
| --- | --- | --- |
| Layered guidance (root and per-area files, skills) with hooks | Little text loaded in every session; a hook stops a forbidden action before it happens | Hooks run only under Claude Code, which narrows portability; more pieces for an adopter to take |
| Prose only in one root file | Simplest to copy; any agent reads it | Nothing is enforced, so the same mistakes return as correction rounds; the file grows with every lesson |
| Layered guidance with checks in lint and CI only | Works for every harness | A mistake is found after the work is done, at the cost of a CI round; a destructive local action is never stopped |

Trade-off, verifiability against portability: hooks cut correction rounds but tie the bundle to Claude Code and to this repository's paths. The panel suggested making each hook a thin wrapper over a check that CI also runs. The maintainer accepts the trade-off as it stands: the edits an adopter makes to each hook are a known cost.

#### Which agent harness the automation targets

| Alternative | Strengths | Weaknesses against the driving characteristics |
| --- | --- | --- |
| Claude Code first for automation; guidance neutral | Uses native hooks, skills and workflows; no twin of each automation to keep in step | An adopter on another harness follows the guidance by hand |
| Full neutrality: a hand-followable twin of every automation | Portable to any harness | Twice the text to maintain and verify; twins drift |
| A neutral automation layer of recipes and tools with an adapter per harness | Portable automation | An extra layer to build and test before any adopter exists |

Trade-off: the neutral layer is the strongest design for portability and the weakest use of the maintainer's time before any adopter exists. Adoption is therefore claimed for Claude Code adopters only.

#### Where decisions and stories are recorded

| Alternative | Strengths | Weaknesses against the driving characteristics |
| --- | --- | --- |
| ADRs and story cards as Markdown in the repository, published on the docs site | Records sit beside the code, are validated by tools, change in the same pull request and are public evidence | A card before delivery and an ADR acceptance add steps; an adopter takes the conventions too |
| No formal records: commit messages, pull request descriptions, README | No extra steps | An agent in a new session cannot find why; a reader has no evidence trail |
| An external wiki | Easy to edit | Outside the review and the checks; drifts from the code; not copied with the bundle |

Trade-off, auditability against portability: the record conventions are what the auditability target requires, and they add to what an adopter takes on. The direction is a minimal record kit in the bundle (the ADR and story card conventions with their validators), with the docs site and the architecture model optional. It is not built yet.

#### How the UI and the API agree

| Alternative | Strengths | Weaknesses against the driving characteristics |
| --- | --- | --- |
| A contract generated from the API and committed, with a generated typed client | A stale contract fails CI; a breaking change shows as a type error in every consumer | The contract follows the code rather than leading it |
| A hand-written contract with generated server stubs | The design is reviewed first | A second source to keep true; drift is found late |
| No contract: hand-written types and fetch calls | Nothing to generate | Nothing verifies that the two sides agree |

#### Who defines the day

| Alternative | Strengths | Weaknesses against the driving characteristics |
| --- | --- | --- |
| The client sends its local date and time zone; the server computes the window | The day is the user's wall-clock day; daylight-saving logic exists once, on the server, with tests | The client is trusted to send a truthful zone; the API's zone data and PostgreSQL's are updated separately |
| The client sends a UTC range | Simple for the server | Each client redoes the daylight-saving logic; whole-day items lose their local date |
| A time zone stored per user | Safe input | Wrong when the user travels; needs a setting before first use |
| The server's UTC day | Nothing to send | The wrong day for most zones |

#### How CI time is kept in check

| Alternative | Strengths | Weaknesses against the driving characteristics |
| --- | --- | --- |
| A run-time gate per job against a pinned baseline, with jobs run only for the paths they check | A regression fails the run that caused it; unaffected jobs do not run | Baselines must be re-pinned; a small regression under the margin passes; a skipped job is a check not run |
| No timing gate: benchmark records only | No false failures | Slowdowns accumulate unnoticed until someone measures |
| Every job on every change, with a fixed ceiling | Simple; everything is always checked | Waiting on jobs a change cannot affect; a ceiling catches only gross regressions |

Trade-off, delivery speed against verifiability and correctness of time: this was the panel's closest call. A job skipped for its paths is a check not run, for example when time-zone data or an image changes with no code path. The maintainer keeps path-scoped jobs and accepts the risk; the CI result job tells a skip by design from a missing job ([ADR-0046](../decisions/0046-run-ci-jobs-only-for-the-paths-they-check.md)).

#### How a change is reviewed before merge

| Alternative | Strengths | Weaknesses against the driving characteristics |
| --- | --- | --- |
| Reviewer agents on request, with a skeptic trying to refute each finding | Findings reach the maintainer already tested; false ones are dropped | Adds waiting time and token cost; runs only when asked |
| Maintainer review only | No waiting on agents | Every missed defect becomes a correction round |
| Reviewers without skeptics | Faster | Unrefuted findings include false ones, which waste the maintainer's attention |
| Review in CI on every pull request | Never forgotten | Lengthens every run and costs tokens on changes that do not need it |

Trade-off, verifiability against delivery speed: reviewers and skeptics add waiting outside CI, which the 5-minute target does not count.
