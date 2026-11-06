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

## Publishing

The site discovers documents from this directory and lists them in the sidebar. README files hold conventions, not inventories. Numbered documents sort by filename; runbooks sort by their `order` field. Titles and metadata come from each document. Invalid metadata, duplicate identifiers and broken publication links fail the build.
