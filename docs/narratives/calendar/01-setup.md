## Act 1: Setup

### The problem

Calendar has two problems to solve, and its owner treats them as one project.

The first is a planning problem. One person needs a single place that shows what today and this week hold: the events with fixed times, and the tasks with their deadlines, including tasks that are already overdue. "Today" has to mean today in that person's own time zone.

The second is an engineering problem. AI agents can now write and change software, but there is no established practice that makes their output dependable: work that is decided before it is built, checked before it merges, and that improves when something goes wrong. Calendar is where that practice is developed and tested, on a real product with real constraints.

When the two pull apart, the method wins. The product is the vehicle; a feature is worth building when it exercises the method, and time goes to the method when both cannot be done.

The outcome the owner wants is a **reusable method**. Success is measured by four signs:

| Sign | Measure |
| --- | --- |
| A skill travels | A skill folder copied into another repository works without this repository's tooling. |
| The method is adopted | Another repository adopts the agent guidance, skills and hooks. |
| Lessons stick | Repeated lessons, as counted in dream-weaver reports, fall month over month. |
| Agent work merges clean | The median agent pull request merges after at most 2 maintainer correction rounds. |

### Why now

Agentic coding crossed a usefulness threshold in 2026, and the practices that make it dependable do not exist yet. The owner also needs hands-on depth in this way of working now, not later. If nothing is done, agent output stays something to inspect line by line rather than trust, and the gap between what the tools can do and what the owner can do with them widens.

### Stakeholders

| Role | Needs | Decides |
| --- | --- | --- |
| Maintainer | A planner that works, and a method that makes agent work trustworthy | Scope, which ADRs are accepted, and every merge |
| Delivery agents (Claude Code, Codex) | Clear issues, story cards, ADRs and guidance to work from | Nothing on their own: they propose designs, implement and report on issues and pull requests for the maintainer to accept |
| Reviewer and skeptic agents | A branch or a finding to examine | Whether a finding stands: reviewers report findings, skeptics try to refute them before they reach the maintainer |
| Public readers | A method they can inspect and copy | Whether the method is worth adopting |

### Users and scale

The product has one user: the maintainer, signing in with an allow-listed Google account. A staging environment runs on Azure; production is not live yet. With one user, load is not what shapes the product. The method's users are the agents and the maintainer, every working day.

### Scope

**In scope:** the today and week views, events, tasks with a date or exact-time deadline, overdue triage, sign-in, and light and dark themes; and around the product, the documentation site, the delivery dashboard and the agent tooling (guidance, skills, hooks and workflows).

**Out of scope:** sharing calendars and inviting attendees, sync with other calendars such as Google or Outlook, and native mobile apps. **Future, not yet planned:** recurring events.

### Vocabulary

| Term | Meaning |
| --- | --- |
| Event | Something that happens at a set time: a start and an end, in a time zone. |
| Task | Something to do, optionally with a deadline; it is open until completed. |
| Deadline | When a task is due: either a date with no time, or an exact time. |
| Floating date | A calendar date with no time zone, such as a date-only deadline; it means the same day wherever the owner is. |
| Today | The owner's current date in the owner's time zone, as the client states it; the server never decides it. |
| Agenda | What a day or a week holds: its events and the tasks due in it. |
| Overdue | An open task whose deadline is before today. |
| Owner | The signed-in user whose events and tasks they are; every read and write is scoped to one owner. |
| Contract | `contracts/openapi.json`, generated from the API: the only thing a user interface may depend on. |
| Generated client | The TypeScript client generated from the contract and shared by every user interface. |
| Read model | An endpoint shaped for one view (the day or week agenda), read from one consistent snapshot. |
| Issue | A GitHub issue: where work is requested, designed and discussed. |
| Story card | The lasting record of a feature in `docs/stories/`: scope, acceptance criteria, decisions and how it was built. |
| ADR | Any Decision Record in `docs/decisions/`: one significant decision, its options and its reasons. |
| Slice | One deliverable piece of a story, with its own issue and pull request. |
| Epic | An issue that groups the slices of a larger outcome. |
| PR 0 | The first, docs-only pull request of a story: its card, and any ADRs. |
| Worker | An agent session delivering one or more slices. |
| Coordinator | The agent session that steers the workers of an epic. |
| Agent guidance | The layered instructions agents read: the root `AGENTS.md` and the area files under it. |
| Skill | A packaged procedure an agent loads for one kind of task, such as drafting an ADR. |
| Hook | A check that runs on an agent's tool calls and enforces a rule from the guidance. |
| Workflow | A saved script that runs several agents in a fixed pattern, such as review before merge. |
| Skeptic | An agent that tries to refute one finding before it reaches the maintainer. |
| Sweep | A periodic check of records (ADRs, issues) for drift that validation cannot catch. |
| Dream-weaver | The skill that reads recent sessions and turns their lessons into lasting guidance. |
| Snapshot | A daily JSON record of delivery measures that the dashboard renders. |

<!-- diagram: context.mmd -->
