---
status: implemented
date: 2026-10-29
pr: https://github.com/mgasca/calendar/pull/124
adrs: ["0015", "0018", "0020", "0021", "0026"]
---

# 0007 Overdue triage and task deletion

## Story

> As a user with a large backlog of overdue tasks, I need a triage view where I can work through all of them, so that the capped overdue list on my day and week views stays short and I still have a way to clear the backlog. I also need to delete tasks, completed or not, so that my lists only hold what still matters.

Tracked in issue #56 and delivered across [story-card PR #124](https://github.com/mgasca/calendar/pull/124), [backend PR #125](https://github.com/mgasca/calendar/pull/125) and [web PR #126](https://github.com/mgasca/calendar/pull/126).

## Background

The day and week agendas show at most 20 overdue tasks and the total, with no way to reach the rest. Tasks can be created, completed and reopened, but not edited or deleted ([0003](0003-add-todo-tasks.md) left editing out of scope and deletion to this story). This story adds a triage view for the whole overdue backlog, bulk actions to clear it, and task deletion everywhere tasks are shown.

### Agreed scope

* A `/triage` view reached from a "View all N overdue" link on the day view and on the week view's overdue panel.
* It lists every open overdue task, paged through `GET /api/tasks?view=overdue` (ordered by local due date, then due instant, then id). Each row shows the title, due date or time, priority and how many days overdue it is. Notes are available on demand, because the agenda no longer carries them.
* Bulk actions on selected tasks: complete, reschedule to a date, reschedule to an exact time (ADR-0018 rules), clear the deadline, and delete.
* Selection: tick rows, select all loaded rows, or select all N overdue tasks. "All N" is sent to the server as a filter (`view=overdue`, `today`, `timeZone`) with the expected total, and is rejected with a conflict if the backlog count changed since the user saw it.
* One bulk endpoint reports a result per task (applied, skipped or not found). Completing an already completed task counts as applied. The UI tells the user what was skipped.
* Deletion removes the row from the database (hard delete, no undo) for completed and open tasks. It is available in triage, every view of My tasks, and day and week agendas. It always asks for confirmation and says how many tasks will be deleted.

### Not in this story

* Changing the agenda cap (N = 20) or its ordering.
* Recurring tasks and snoozing.
* Editing a task's other fields (title, priority, notes).
* Deleting events.

### Acceptance criteria

1. **Given** more than 20 overdue tasks, **when** I follow "View all N overdue" from the day or week view, **then** triage lists all of them in pages, with no gaps or duplicates. [Day navigation and count](../../frontend/apps/web/src/features/day/DayView.test.tsx#L230), [week navigation and count](../../frontend/apps/web/src/features/week/WeekView.test.tsx#L580), [triage paging](../../frontend/apps/web/src/features/triage/Triage.test.tsx#L48), [API paging and overdue list](../../backend/tests/Calendar.Api.Tests/Endpoints/TaskEndpointsTests.cs#L215).
2. **Given** the triage view, **when** I complete, reschedule, clear the deadline of or delete tasks, **then** the agenda's overdue count and list update when I return. [Triage actions and agenda invalidation](../../frontend/apps/web/src/features/triage/Triage.test.tsx#L92), [day count and deletion](../../frontend/apps/web/src/features/day/DayView.test.tsx#L243), [week deletion](../../frontend/apps/web/src/features/week/WeekView.test.tsx#L606); browser navigation across a live backend is not tested.
3. **Given** selected tasks, **when** I reschedule them to a date or exact time, **then** they get that deadline, nonexistent local times are rejected, and ambiguous times ask me to choose an occurrence. [Date and instant reschedule requests](../../frontend/apps/web/src/features/triage/Triage.test.tsx#L92), [deadline resolver including DST cases](../../frontend/apps/web/src/features/agenda/deadline.test.ts#L11), [API bulk actions](../../backend/tests/Calendar.Api.Tests/Endpoints/TaskEndpointsTests.cs#L355); the triage dialog's complete browser DST interaction is not directly exercised.
4. **Given** I choose "select all N overdue", **when** the backlog count changed since it was shown, **then** nothing is changed and I'm asked to review the new count. [First-page total and filter target](../../frontend/apps/web/src/features/triage/Triage.test.tsx#L124), [API count conflict](../../backend/tests/Calendar.Api.Tests/Endpoints/TaskEndpointsTests.cs#L421); the test does not induce a same-count swap.
5. **Given** a bulk action where some tasks no longer exist or can't change, **when** it finishes, **then** others are changed and I'm told which were skipped. [Partial outcomes and 409 messaging](../../frontend/apps/web/src/features/triage/Triage.test.tsx#L221), [per-id outcomes](../../backend/tests/Calendar.Api.Tests/Endpoints/TaskEndpointsTests.cs#L355); a real database serialization-failure race is not induced (the SQL error classifier has unit coverage at [TaskEndpointsTests.cs](../../backend/tests/Calendar.Api.Tests/Endpoints/TaskEndpointsTests.cs#L17)).
6. **Given** a task in My tasks or the day or week agenda, completed or not, **when** I delete it and confirm, **then** it is removed; cancelling changes nothing. [My tasks confirm and cancel](../../frontend/apps/web/src/features/tasks/Tasks.test.tsx#L163), [day deletion](../../frontend/apps/web/src/features/day/DayView.test.tsx#L243), [week deletion](../../frontend/apps/web/src/features/week/WeekView.test.tsx#L606), [DELETE endpoint](../../backend/tests/Calendar.Api.Tests/Endpoints/TaskEndpointsTests.cs#L318). The browser test checks request behavior rather than database state; endpoint integration coverage checks persistence and missing ids.
7. **Given** triage or its dialogs are used with a keyboard or assistive technology, **when** a bulk action is in progress, **then** controls have accessible labels and duplicate submission is prevented. [Keyboard accessible delete confirmation](../../frontend/apps/web/src/features/triage/Triage.test.tsx#L242), [pending action lock](../../frontend/apps/web/src/features/triage/Triage.test.tsx#L269); keyboard operation is partly tested, but assistive-technology usability is not, and no real-browser run was performed.
8. **Given** the change is complete, **when** I run the repository checks, **then** they pass with tests for paging, bulk actions, select-all and deletion. [Triage coverage](../../frontend/apps/web/src/features/triage/Triage.test.tsx#L47), [API tests](../../backend/tests/Calendar.Api.Tests/Endpoints/TaskEndpointsTests.cs#L17); verification status is recorded in this delivery report.

## Design decisions

* [ADR-0015](../decisions/0015-ef-core-data-access.md): app role permissions and delete migration.
* [ADR-0018](../decisions/0018-time-representation-and-bcl-date-time-types.md): deadline representation and DST rules.
* [ADR-0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md): agenda reflects task changes.
* [ADR-0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md): `today` and `timeZone` come from the client.
* [ADR-0026](../decisions/0026-client-side-routing-with-tanstack-router.md): `/triage` is a lazy-loaded route.
* One bulk endpoint reports per-task results; a stale selected item does not block other items.
* Select-all sends a server-side filter with a count guard rather than every id.
* Hard delete with confirmation and no undo keeps queries and indexes unchanged.

## Implementation notes

### Code and API

* The triage interface and selection live in `frontend/apps/web/src/features/triage/Triage.tsx`; shared `ConfirmDialog` provides deletion confirmation, and `useDeleteTask` handles single-task deletion. Triage batches loaded ids through its bulk-action hook in sequential chunks of at most 500.
* `POST /api/tasks/bulk` applies complete, set-date, set-instant, clear-deadline or delete. Explicit-id targets return one result per distinct id; filter targets are set-based and return aggregate results without one row per matched task. Filter targets include `view=overdue`, client `today` and `timeZone`, plus `expectedTotal`.
* `DELETE /api/tasks/{id}` deletes a single task; missing tasks return 404, treated by the UI as already deleted.
* `TaskEndpoints.cs` implements bulk and delete. `TodoTask` owns deadline changes; `TaskListQueries.OpenOverdueFor` supplies the shared overdue predicate. The first overdue page carries `total`, used by triage's select-all count guard.
* Completed tasks are skipped for deadline edits. Count drift or a database serialization/deadlock conflict returns 409. The UI reports skipped results and asks users to review the count after a conflict.
* Delivery PRs: [story docs #124](https://github.com/mgasca/calendar/pull/124), [backend #125](https://github.com/mgasca/calendar/pull/125), [web #126](https://github.com/mgasca/calendar/pull/126).

### Validation and measurements

* Backend API tests cover paging, bulk action outcomes, count mismatch, deletion and missing tasks. Domain deadline validation has domain tests; frontend triage tests cover pagination, selection, actions, batching, errors and query refresh.
* Recorded scale measurements for 50,000 tasks: completing individually took 40 s and bulk completion 1.5 s; deleting individually took 11 s and bulk deletion 0.1 s. Deadline resolver time was 10 ms. These are implementation measurements, not a production workload guarantee.
* Production entry bundle: 369.28 kB before and 370.83 kB after; triage route chunk: 5.54 kB.

### Lessons and limits

* Week agenda overdue count and the overdue list/filter count can differ because the week panel is limited to items due before the week's Monday. The task-list endpoint's first-page `total` is therefore the count used for selecting all overdue tasks.
* Per-entity saves were too slow at scale; set-based filter operations and bounded id batches reduce round trips.
* The docs test's previously hard-coded story list is now derived from the repository story index.
* The count guard can miss same-count swaps between the displayed count and action. Deletion is hard and has no undo or soft-delete recovery. Other task fields cannot be edited here. Memory use was not measured, and no real-browser end-to-end run was performed.

## User guide

Open triage with **View all N overdue** from the day view or the week view's overdue panel. Rows show the title, deadline, priority and how late the task is; expand **Notes** to read its notes. Use a row checkbox to select one task, **Select all loaded** for the current pages, or **Select all N overdue** to target the full server-side overdue set.

Choose **Complete**, **Reschedule**, **Clear deadline** or **Delete** for the selection. Rescheduling offers a date or an exact time. For a nonexistent local time, choose another time; if the time occurs twice during a daylight-saving transition, choose which occurrence. Delete opens a confirmation showing the number of tasks and cannot be undone.

A result message reports how many tasks were changed and which were skipped. A count-changed message means the overdue set changed since it was loaded; reload and review the new count before trying again. Delete a single task from **My tasks** or from a task in the day or week agenda using its **Delete** action, then confirm. Cancelling a confirmation makes no change.
