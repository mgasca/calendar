---
status: implemented
date: 2026-11-01
issue: https://github.com/mgasca/calendar/issues/86
pr: []
adrs: ["0015", "0020", "0021"]
---

# 0013 Close out the backend performance review

## Story

> As the maintainer, I need the backend performance review recorded as finished, so that its tracking issue shows the real state and can be closed.

Tracked in issue #86. This card records work that was already delivered, so the card PR closes the issue.

## Background

Issue #86 tracks a review of the backend API (`backend/src/**`) that raised one issue per defect (#50–#56). Each was fixed on its own branch and PR, with the design recorded on the issue first. The lessons are in `AGENTS.md` ("Backend practices").

### Agreed scope

* Check every child issue and its PR against `main`.
* Correct the stale row in the issue's Outcome table: #56 was listed as "open, deferred".

### Not in this story

* Any code change. The #51 follow-up (merge the two overdue count queries into one scan) is not part of this card.
* Frontend performance issues #48 and #49, which belong to #87.

### Acceptance criteria

1. **Given** the children #50–#56, **when** I list their state, **then** all are closed, each fixed by a merged PR: #50 by #63, #52 by #66, #53 by #69, #54 by #67, #55 by #68, #51 by #72. Checked by hand with `gh issue view` and `gh pr view`.
2. **Given** #56 (the overdue triage view), **when** I read story [0007](0007-overdue-triage-and-task-deletion.md), **then** it is `implemented` with PRs #124–#127 merged. #56 is therefore closed, not deferred.
3. **Given** the Outcome table in issue #86, **when** I read it, **then** the #56 row says "closed, story 0007" and the follow-up lines no longer call #56 deferred. Done by editing the issue body; this is not tracked in the repo, so it is checked by hand.
4. **Given** the lessons learned, **when** I read `AGENTS.md`, **then** the backend practices section holds them. Checked by hand.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0015](../decisions/0015-ef-core-data-access.md) | EF Core code-first on Npgsql | The query and index changes build on it. |
| [0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md) | Aggregate day agenda endpoint as a read model | Constrained the agenda query changes. |
| [0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md) | Client-supplied date and time zone define the day | Constrained the overdue and upcoming queries. |

No new ADR is needed.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| Lessons | `AGENTS.md` ("Backend practices") |
| Triage view story | `docs/stories/0007-overdue-triage-and-task-deletion.md` |

### API

No changes.

### Testing

* No code changed. The children's own tests and measurements are in their PRs and are summarised in the issue's Outcome table.

### Lessons learned, known issues and follow-ups

* **Open follow-up:** merging the two overdue count queries into one scan (from #51). Nothing owns it yet; raise an issue if it is wanted.
* The Outcome table had gone stale after #56 was delivered as its own story. Update a tracker's table when a deferred child ships.

## User guide

Not applicable: this story has no user-facing behaviour.
