# Stories

One Markdown file per user story, named `NNNN-short-title.md` like the [ADRs](../decisions/README.md), so stories sort in delivery order and can be linked by number.

Each story records:

* **Story**: the user story as written.
* **Background**: the context, the agreed scope and the acceptance criteria.
* **Design decisions**: links to the ADRs it relies on, plus a list of smaller decisions that don't warrant an ADR.
* **Implementation notes**: where the code lives, the API surface, testing, lessons learned, known issues and follow-ups.
* **User guide**: how to use the feature, written for end users. These sections will be mined to generate user documentation.

Front matter: `status` (`planned`, `in-progress` or `implemented`), `date`, `pr` and `adrs`.

| Story | Title | Status |
| --- | --- | --- |
| [0001](0001-today-view.md) | Today view: see everything for today in one place | implemented |
| [0002](0002-week-view.md) | Week view: plan and track the whole week in one place | planned |
| [0003](0003-create-events-and-tasks.md) | Create events and tasks from the day and week views | planned |
