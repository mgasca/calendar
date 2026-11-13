## Act 1: Setup

### The problem

Software written by AI coding agents cannot yet be trusted without close human checking. Calendar exists to develop and test the practices that make agent delivery dependable: the method. The planning application (one place to see the events and tasks of today and of the week) is the vehicle: a real product, small enough for one person to own, on which the method is exercised and its results recorded.

The maintainer wants three outcomes:

* **A reusable method others adopt.** The guidance, skills and hooks, copied together into another repository, work there; another repository adopts them, the maintainer reuses the method in the next project, and public readers engage with it.
* **Fewer corrections.** The median pull request written by a delivery agent merges after at most 2 correction rounds.
* **Personal depth** in agentic engineering, gained by doing the work.

A planning application relied on every day is not one of the outcomes.

### Why now

Coding agents became capable enough to deliver real changes, but the practices that make their output dependable are missing. If nothing is done, agent output stays something to distrust and recheck by hand, and the maintainer's own skill gap widens while the practice moves on. No team or employer need drives the work.

### Stakeholders

Agents propose; the maintainer decides.

| Role | Needs | Decides |
| --- | --- | --- |
| Maintainer | A method that produces changes worth merging with few correction rounds | Scope, the acceptance of every ADR, and the authorization of every merge |
| Delivery agent | Guidance, skills and hooks that say what to do and what is forbidden; records that outlive a session | Nothing: it designs, implements and posts on issues, and proposes |
| Reviewer and skeptic | A branch to review and findings to test | Nothing: they report findings and try to refute them before merge |
| Public reader | Evidence that the method works, and pieces that can be lifted out | Whether to copy the method, and which pieces |

### Users and scale

The application has one user, the maintainer, who signs in with one allow-listed Google account and uses it occasionally, to prove features rather than to plan every day. It runs locally only: the Azure infrastructure is defined in the repository but not deployed.

### Scope

In scope: the today and week views, events, tasks with a date or exact-time deadline, overdue triage, Google sign-in and the light and dark themes; and around the application, the docs site, the delivery dashboard and the agent tooling.

Out of scope: sharing and invitations, sync with other calendars, and native mobile apps. Recurring events are a possible future with no plan.

### Vocabulary

| Term | Meaning |
| --- | --- |
| Method | The guidance, skills, hooks and records that make agent delivery dependable |
| Maintainer | The repository's owner and only user |
| Delivery agent | An AI coding agent that designs and implements a change |
| Reviewer | An agent that reviews a branch for performance or security |
| Skeptic | An agent that tries to refute one review finding |
| Correction round | One maintainer request for changes on a delivery agent's pull request before it merges |
| ADR | A decision record in `docs/decisions` |
| Story card | The durable record of a story in `docs/stories` |
| Skill | A packaged procedure an agent follows |
| Harness | The program that runs an agent, such as Claude Code |
| Hook | A check the harness runs on an agent's actions |
| Bundle | The guidance, skills and hooks copied together into another repository |
| Baseline | The pinned run time a CI job is compared against |
| Event | A calendar entry with a time span or a whole day |
| Task | A todo with an optional date or exact-time deadline |
| Overdue | Said of a task whose deadline has passed and that is not completed |
| Day agenda, week agenda | The events and tasks of one day or one week, read as one snapshot |
| Today | The date and time zone the client supplies; the server never decides it |
| Owner | The signed-in account that events and tasks belong to |
| Contract | `contracts/openapi.json`, generated from the API and consumed by every UI |

<!-- diagram: context.mmd -->
