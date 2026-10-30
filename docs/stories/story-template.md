---
status: planned
date: YYYY-MM-DD
issue: https://github.com/mgasca/calendar/issues/N
pr: []
adrs: []
---

# NNNN Short title

<!--
Copy this file to docs/stories/NNNN-short-title.md (or XXXX-short-title.md until the story is
scheduled) and add a row to the index in README.md. Delete these comments.

Front matter:
* status: planned, in-progress or implemented. Must match the index row.
* date: YYYY-MM-DD, the day the card was created.
* issue: URL of the GitHub issue the story started from. Delete the line if the story did not start as an issue.
* pr: a LIST of pull request URLs, in delivery order. A story generally takes more than one PR
  (the card, the code, the card update), so write `pr: []` while there are none and add each PR as
  it is opened, e.g. a block list of URLs.
* adrs: quoted four-digit ADR numbers, e.g. ["0018", "0021"].
-->

## Story

> As a {role}, I need {capability}, so that {benefit}.

Tracked in issue #N. <!-- If the story began as a GitHub issue; the card is the source of truth from here on. -->

## Background

Why the story exists and what it builds on.

### Agreed scope

* ...

### Not in this story

* ...

### Acceptance criteria

1. **Given** ..., **when** ..., **then** ... . <!-- Link tests as they land, noting what is not directly tested. -->

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [NNNN](../decisions/NNNN-title.md) | The decision in a few words | How it constrains this story |

No new ADR is expected. <!-- Or name the decision that needs one, and draft it with the adr-draft skill. -->

### Other decisions (not ADR-worthy)

* **Name:** a small choice and its reason. <!-- Hard to reverse, shared across stories, or a new dependency? Write an ADR instead. -->

## Implementation notes

*Planned. This section is completed as the story is built.*

<!-- When delivered, replace the italic line and keep the subsections that apply. -->

### Where things live

| Area | Location |
| --- | --- |
| Area | `path/to/code` |

### API

New or changed endpoints and status codes, or "No changes."

### Testing

* The layers and cases that matter. <!-- Link tests from the acceptance criteria too. -->

### Lessons learned, known issues and follow-ups

* Measurements (say whether measured or inferred), limits, and deferred scope with the story or issue that owns it.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### The task the user performs

Steps and outcomes in end-user language: UI labels in **bold**, no code paths.
