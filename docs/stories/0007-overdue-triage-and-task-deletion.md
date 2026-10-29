---
status: in-progress
date: 2026-10-29
adrs: ["0015", "0018", "0020", "0021", "0026"]
---

# 0007 Overdue triage and task deletion

## Story

> As a user with a large backlog of overdue tasks, I need a triage view where I can work through all of them, so that the capped overdue list on my day and week views stays short and I still have a way to clear the backlog. I also need to delete tasks, completed or not, so that my lists only hold what still matters.

Tracked in issue #56. It comes from #51 (the agenda's overdue list is capped at 20, with a total count) and builds on #50 (the paginated, view-filtered `GET /api/tasks`, including `view=overdue`).

## Background

The day and week agendas show at most 20 overdue tasks and the total, with no way to reach the rest. Tasks can be created, completed and reopened, but not edited or deleted ([0003](0003-add-todo-tasks.md) left both out of scope). This story adds a triage view for the whole overdue backlog, bulk actions to clear it, and task deletion everywhere tasks are shown.

### Agreed scope

* A `/triage` view reached from a "View all N overdue" link on the day view and on the week view's overdue panel.
* It lists every open overdue task, paged through `GET /api/tasks?view=overdue` (ordered by local due date, then due instant, then id). Each row shows the title, due date or time, priority and how many days overdue it is. Notes are available on demand, because the agenda no longer carries them.
* Bulk actions on the selected tasks: complete, reschedule to a date, reschedule to an exact time (ADR-0018 rules), clear the deadline, and delete.
* Selection: tick rows, select all loaded rows, or select all N overdue tasks. "All N" is sent to the server as a filter (`view=overdue`, `today`, `timeZone`) with the expected total, and is rejected with a conflict if the backlog changed since the user saw the count.
* One bulk endpoint reports a result per task (applied, skipped or not found). Completing an already completed task counts as applied. The UI tells the user what was skipped.
* Deletion removes the row from the database (hard delete, no undo) for completed and open tasks. It is available in the triage view, in every view of My tasks, and on task items in the day and week agendas. It always asks for confirmation, and says how many tasks will be deleted.

### Not in this story

* Changing the agenda cap (N = 20) or its ordering.
* Recurring tasks and snoozing.
* Editing a task's other fields (title, priority, notes).
* Deleting events.

### Acceptance criteria

1. **Given** more than 20 overdue tasks, **when** I follow "View all N overdue" from the day or week view, **then** the triage view lists all of them, in pages, with no gaps or duplicates.
2. **Given** the triage view, **when** I complete, reschedule, clear the deadline of or delete tasks, **then** the agenda's overdue count and list update when I return.
3. **Given** selected tasks, **when** I reschedule them to a date or an exact time, **then** they get that deadline, and a nonexistent local time is rejected while an ambiguous one asks me to choose an occurrence.
4. **Given** I choose "select all N overdue", **when** the backlog changed since the count was shown, **then** nothing is changed and I'm asked to review the new count.
5. **Given** a bulk action where some tasks no longer exist or can't change, **when** it finishes, **then** the others are changed and I'm told which were skipped.
6. **Given** a task in My tasks (any view) or in the day or week agenda, completed or not, **when** I delete it and confirm, **then** it is removed from the database and from every view; cancelling changes nothing.
7. **Given** the triage view or its dialogs are used with a keyboard or assistive technology, **when** a bulk action is in progress, **then** controls have accessible labels and duplicate submission is prevented.
8. **Given** the change is complete, **when** I run `make check`, **then** it passes, with tests for paging, each bulk action, select-all and deletion.

## Design decisions

* [ADR-0015](../decisions/0015-ef-core-data-access.md): the app role has no migration rights; any grant a delete needs ships as a migration.
* [ADR-0018](../decisions/0018-time-representation-and-bcl-date-time-types.md): deadline representation and DST rules for rescheduling.
* [ADR-0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md): the agenda is the read model that must reflect the changes.
* [ADR-0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md): `today` and `timeZone` come from the client, including for select-all.
* [ADR-0026](../decisions/0026-client-side-routing-with-tanstack-router.md): `/triage` is a lazy-loaded route.
* One bulk endpoint with per-task results, rather than a client fan-out or all-or-nothing, so a stale selection doesn't block the rest.
* Select-all is a server-side filter with a count guard, rather than the client sending every id, so it scales to large backlogs.
* Hard delete with a confirmation and no undo, rather than a soft delete, to keep queries and indexes unchanged.

## Implementation notes

To be filled in when delivered.

## User guide

To be written when delivered.
