---
status: planned
date: YYYY-MM-DD
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

* [ADR-NNNN](../decisions/NNNN-title.md): why it matters here.
* Smaller decisions that don't warrant an ADR.

## Implementation notes

To be filled in when delivered: where the code lives, API surface, testing, measurements, lessons learned, known issues and follow-ups.

## User guide

To be written when delivered: how to use the feature, written for end users.
