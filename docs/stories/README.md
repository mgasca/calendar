# Stories

One Markdown file per user story, named `NNNN-short-title.md` like the [ADRs](../decisions/README.md), so stories sort in delivery order and can be linked by number.

## Source of truth

GitHub issues help people manage and drive the work. The long-lived truth about a story is its card here. When a story starts as an issue, its first PR ("PR 0") adds the card, written from the issue and any further input from the people involved. A later PR updates the card with what was built and learned (implementation notes, test links, user guide, status, `pr` list). That update can be its own PR or part of another one, but a story isn't done until its card is.

A planned story that isn't scheduled yet is named `XXXX-short-title.md`, and gets the next number when it is scheduled, so numbers keep matching delivery order.

Each story records:

* **Story**: the user story as written.
* **Background**: the context, the agreed scope and the acceptance criteria.
* **Design decisions**: links to the ADRs it relies on, plus a list of smaller decisions that don't warrant an ADR.
* **Implementation notes**: where the code lives, the API surface, testing, lessons learned, known issues and follow-ups.
* **User guide**: how to use the feature, written for end users. These sections will be mined to generate user documentation.

Start from [story-template.md](story-template.md).

Front matter: `status` (`planned`, `in-progress` or `implemented`), `date` (`YYYY-MM-DD`), `issue` (the GitHub issue URL, when the story started as one), `adrs` and `pr`. `pr` is a list of pull request URLs in delivery order (`[]` until there is one), because a story generally takes several PRs. Quote the ADR numbers in `adrs` (`["0004", "0016"]`): YAML reads a bare `0016` as a different number.

| Story | Title | Status |
| --- | --- | --- |
| [0001](0001-today-view.md) | Today view: see everything for today in one place | implemented |
| [0002](0002-week-view.md) | Week view: plan and track the whole week in one place | implemented |
| [0003](0003-add-todo-tasks.md) | Add todo tasks | implemented |
| [0004](0004-add-event-entries.md) | Add event entries so I know when my appointments are | implemented |
| [0005](0005-google-sign-in.md) | Google sign-in | implemented |
| [0006](0006-modal-dialogs-for-adding.md) | Add tasks and events in a modal dialog | implemented |
| [0007](0007-overdue-triage-and-task-deletion.md) | Overdue triage and task deletion | implemented |
| [0008](0008-review-runbooks-for-clarity-and-simplicity.md) | Review the runbooks for clarity and simplicity | implemented |
| [0009](0009-review-drafting-skills-for-clarity-and-simplicity.md) | Review the adr-draft and story-draft skills for clarity and simplicity | planned |
| [0010](0010-sweep-pending-adrs-to-a-decided-status.md) | Sweep pending ADRs to a decided status | implemented |
| [0011](0011-review-the-top-level-task-runner.md) | Review the top-level task runner | implemented |
| [0012](0012-architecture-visualization-on-the-documentation-site.md) | Architecture visualization on the documentation site | implemented |
| [0013](0013-derive-the-decision-log-from-the-adr-files.md) | Derive the decision log from the ADR files | implemented |
| [0014](0014-supersede-adr-0014-drop-sqlite-fallback.md) | Supersede ADR-0014: drop the SQLite fallback | implemented |
| [0015](0015-backend-performance-review-closeout.md) | Close out the backend performance review | implemented |
| [0016](0016-colour-the-architecture-flow-diagrams-by-ownership.md) | Colour the architecture flow diagrams by ownership, with the legend | implemented |
| [0017](0017-per-user-calendar-ownership.md) | Per-user calendar ownership: my events and tasks are mine alone | implemented |
| [0018](0018-preserve-transcript-insights.md) | Preserve transcript insights in agent guidance | implemented |
| [0019](0019-split-the-justfile-into-modules.md) | Split the justfile into modules | implemented |
| [0020](0020-restructure-agent-guidance.md) | Restructure agent guidance: a short root AGENTS.md, nested area files, a skill and hooks | implemented |
| [0021](0021-sign-in-locally-without-google.md) | Sign in to the local web app without Google | implemented |
| [0022](0022-make-the-architecture-diagrams-easier-to-read.md) | Make the architecture diagrams easier to read: rounded, shadowed boxes and labels off the arrows | implemented |
| [0023](0023-chain-a-modules-recipes-in-one-command.md) | Chain a module's recipes in one command | implemented |
| [0024](0024-one-way-to-show-what-to-fix-in-add-task-and-add-event.md) | One way to show what to fix in Add task and Add event | implemented |
| [0025](0025-consolidate-what-agent-sessions-learned-into-guidance.md) | Consolidate what agent sessions learned into guidance | in-progress |
| [0026](0026-read-module-recipe-chains-with-run.md) | Read module recipe chains with run | implemented |
| [0027](0027-focus-agent-guidance-on-claude-code-for-a-while.md) | Focus agent guidance on Claude Code for a while | planned |
| [0028](0028-coordinate-epic-delivery-across-agent-sessions.md) | Coordinate epic delivery across agent sessions | implemented |
| [0029](0029-preserve-independent-perspectives-on-our-work.md) | Preserve independent perspectives on our work | implemented |
| [0030](0030-docs-only-pr-previews.md) | Publish a docs-site preview only for docs-only pull requests | implemented |
| [0031](0031-open-the-docs-site-on-why-the-repository-exists.md) | Open the docs site on why the repository exists | implemented |
| [0032](0032-unique-pages-publication-versions.md) | Give each Pages publication attempt a distinct build version | in-progress |
| [XXXX](XXXX-create-events-and-tasks-from-week-view.md) | Create events and tasks from the week view | planned |
