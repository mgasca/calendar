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
| [XXXX](XXXX-create-events-and-tasks-from-week-view.md) | Create events and tasks from the week view | planned |
