---
status: planned
date: 2026-11-07
issue: https://github.com/mgasca/calendar/issues/467
pr:
  - https://github.com/mgasca/calendar/pull/485
adrs: ["0014", "0015", "0018", "0020", "0021", "0041", "0043", "0047"]
---

# 0044 Edit a task from the Today view

## Story

> As a calendar editor, I need to open a task from the Today view to change its title, due date, priority or notes, so that I can correct or reschedule it.

Tracked in issue #467, part of the Today view epic #458.

## Background

Tasks can be added ([0003](0003-add-todo-tasks.md), in a dialog since [0006](0006-modal-dialogs-for-adding.md)), completed, reopened and deleted ([0007](0007-overdue-triage-and-task-deletion.md)), but not edited. The API has `GET`, `POST` and `DELETE` on `/api/tasks`, `complete`, `reopen` and `bulk`, and no update. The only way to fix a typo or move a single task to another day is to delete it and add it again; triage ([0007](0007-overdue-triage-and-task-deletion.md)) can reschedule overdue tasks in bulk, but nothing edits the title, priority or notes.

On the Today view, a task's title is part of its checkbox label, so selecting the title toggles completion. This story makes the title open the task for editing instead, and keeps the checkbox for completing.

It follows event editing ([#466](https://github.com/mgasca/calendar/issues/466), card 0043) and uses the same version check for changes made elsewhere. Both regenerate the API contract, so they are delivered one after the other.

### Agreed scope

* **Opening a task:** on the day page (`/` and `/day/:date`), the title of every task under **Overdue** and **Due today** (or **Due this day**) is a button. Selecting it, with the mouse or the keyboard, opens the task dialog titled **Edit task**, prefilled with the stored title, deadline (none, a date, or a date and time), priority and notes. The dialog loads the task first and says so while it loads; if the task no longer exists, it says that and the day refreshes.
* **Checkbox unchanged:** the checkbox still completes and reopens the task, with the same name for screen readers (the task's title). Opening the task for editing never toggles it.
* **Editing:** title, deadline, priority and notes can be changed, with the validation and daylight-saving handling of **Add task** ([0003](0003-add-todo-tasks.md), [ADR-0043](../decisions/0043-form-validation-red-borders-and-bubble.md)). **Save task** saves; **Cancel** and Escape close without saving and without a prompt, except while saving. Completion is not part of the form: editing an open task keeps it open, and editing a completed one keeps it completed (proposed).
* **After saving:** the dialog closes, the day and week agendas and the **My tasks** lists refresh, and a status message says "Task saved." A task moved to another day leaves the day's list. Focus returns to the task's title button, or to the day heading when the task has left the day.
* **Changed elsewhere:** the dialog saves against the version it loaded. If the task was changed in the meantime, including completed or reopened in another tab, the save is refused, the dialog says "This task was changed elsewhere. The latest version is shown; check it and save again.", and the form reloads with the latest values. If it was deleted in the meantime, the dialog says so and the day refreshes.
* **Failures:** a network or server error keeps the dialog open with what was typed and a message, and saving can be retried.
* **Ownership:** another user's task cannot be read or changed; the API answers as if it did not exist ([ADR-0041](../decisions/0041-per-user-data-ownership.md)).

### Not in this story

* Editing from **My tasks**, triage or the week view. The endpoint and dialog are reusable; the entry points are follow-up issues.
* Deleting from the dialog. Each row already has **Delete** ([0007](0007-overdue-triage-and-task-deletion.md)).
* Completing or reopening from the dialog; the checkbox does that.
* Events. That is #466, card 0043.
* Merging the user's edits with changes made elsewhere. On a conflict the latest version replaces the form.
* A "Discard changes?" prompt on closing an edited dialog.
* The fading save notification of #463. If it has merged when this story's UI lands, the status message uses it; otherwise it uses the plain status message of **Add task**.

### Dependencies

* Builds on [0003](0003-add-todo-tasks.md), [0006](0006-modal-dialogs-for-adding.md) and [0007](0007-overdue-triage-and-task-deletion.md).
* Follows event editing ([#466](https://github.com/mgasca/calendar/issues/466), card 0043): both regenerate `contracts/openapi.json` and the TypeScript client, and this story reuses its version handling.
* The task row is also changed by #460 (delete errors) and #462 (phone layout); this story's row change comes after them.

### Acceptance criteria

1. **Given** a task due today on the Today view, **when** I select its title, change the due date to tomorrow and save, **then** the dialog closes, "Task saved." is announced, the task leaves today's list, and it is listed on tomorrow's.
2. **Given** the edit dialog is open, **when** I change the title, priority or notes and save, **then** the row shows the new title, priority or notes indicator.
3. **Given** a task with a due time, **when** I open it, **then** the deadline shows **Date and time** with its local date and time; changing it to **No deadline** and saving removes it from the day.
4. **Given** the edit dialog is open, **when** I clear the title and save, **then** nothing is sent and the field says what to fix, as in **Add task**.
5. **Given** I opened a task and it was then changed elsewhere, **when** I save, **then** the dialog stays open, says the task was changed elsewhere, and shows the latest values; saving again succeeds.
6. **Given** I opened a task and it was then deleted elsewhere, **when** I save, **then** the dialog says the task no longer exists and the day no longer lists it.
7. **Given** a save fails with a network or server error (not 400, 404 or 409), **when** it fails, **then** the dialog stays open with my values and a message, and saving again succeeds.
8. **Given** a task row, **when** I select its title, **then** the edit dialog opens and the checkbox is not toggled; **when** I select the checkbox, **then** the task is completed as before, and the checkbox is still named by the task's title.
9. **Given** the Today view, **when** I use the keyboard alone, **then** each task title is a button I can reach with Tab and open with Enter or Space, and focus returns to it after **Cancel** or a save that keeps the task on the day.
10. **Given** two users, **when** one requests or updates the other's task by id, **then** the API answers 404 and the task is unchanged (API tests).
11. **Given** an update that sends a stale version, **when** the API handles it, **then** it answers 409 and the stored task is unchanged (API tests).
12. **Given** the Light and Dark themes at desktop and phone widths, **when** I open and save a task, **then** the row and dialog are legible and usable in both (checked in the running app, with screenshots in the UI PR).
13. **Given** the change is complete, **when** I run `just check`, **then** it passes, including the regenerated contract.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0014](../decisions/0014-postgresql-database-engine.md) | PostgreSQL, with its specific features contained in Infrastructure | The `xmin` version is read and checked in `Calendar.Infrastructure`, never named in API code |
| [0015](../decisions/0015-ef-core-data-access.md) | EF Core code-first, `xmin` as the optimistic-concurrency token | Updates are checked against the version the client loaded; no migration is needed |
| [0018](../decisions/0018-time-representation-and-bcl-date-time-types.md) | UTC instants and floating dates | A deadline is a floating `dueDate` or a `dueAt` instant, never both, as on create |
| [0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md) | Resource endpoints for writes, the agenda as a read model | The edit goes to `/api/tasks/{id}`; agendas and lists are refetched afterwards |
| [0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md) | The client's local date and zone define the day | The dialog shows and resolves due times in the browser's zone |
| [0041](../decisions/0041-per-user-data-ownership.md) | Per-user ownership, not found rather than forbidden | Another user's task answers 404 on read and update |
| [0043](../decisions/0043-form-validation-red-borders-and-bubble.md) | Red borders and a bubble for form validation | Edit mode reuses the task form's validation display |
| [0047](../decisions/0047-semantic-css-tokens-selected-by-a-data-theme-attribute.md) | Semantic tokens and a `data-theme` attribute | The title button uses shared classes and tokens in both themes |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **A version sent back on update:** the task response carries the same opaque `version` as events (#466, card 0043), and the update must send it. **Complete** and **reopen** only detect a race inside one request; an edit dialog stays open for a while, so it needs to detect a change made after it opened.
* **Full replacement of the editable fields:** the update takes title, priority, notes and the deadline, with the create rules. Completion is left alone, so an edit never completes or reopens a task by accident.
* **Completed tasks can be edited (proposed):** the Today view lists completed tasks under **Due today**, and correcting a title or notes of a done task is harmless. Rescheduling a completed task is allowed too; it stays completed.
* **The title is the button, the checkbox keeps its name:** the title moves out of the checkbox's `<label>` into a `<button>` styled as text, and the checkbox is named by that title, so assistive technology still announces "Buy milk, checkbox".
* **The dialog loads the task:** the agenda carries only `hasNotes` and no version, so opening a task fetches it by id.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| Endpoint | `backend/src/Calendar.Api/Endpoints/TaskEndpoints.cs` (update route) |
| Contracts | `backend/src/Calendar.Api/Contracts/TaskContracts.cs` (`UpdateTaskRequest`, `version` on `TaskResponse`) |
| Domain | `backend/src/Calendar.Domain/Tasks/TodoTask.cs` (an update method with the create rules) |
| Contract and client | `contracts/openapi.json`, `frontend/packages/api-client` (generated by `just contracts`) |
| Form | `frontend/apps/web/src/features/tasks/TaskForm.tsx`, `taskForm.ts` (edit mode) |
| Row | `frontend/apps/web/src/features/agenda/TaskItem.tsx` (title button) |

### API

Planned:

* `GET /api/tasks/{id}` and the other task responses gain `version`.
* `PUT /api/tasks/{id}`: body `title`, `priority`, `notes`, `dueDate` or `dueAt` (not both), and the required `version`. 200 with the updated task and its new version; 400 with field errors; 404 when the task does not exist or belongs to another user; 409 when `version` is stale.

### Testing

* Domain tests for the update rules.
* API tests with Testcontainers: update of title, priority, notes and each deadline kind, validation, a completed task staying completed, stale version (409, unchanged row), and another user's task (404, unchanged) in `OwnershipTests`.
* Vitest with MSW: edit mode prefill for each deadline kind, save and refresh, validation, conflict reload, not found, title opens without toggling, checkbox name, keyboard focus.
* The running app in both themes at desktop and phone widths.

### Lessons learned, known issues and follow-ups

* To be filled in on delivery.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Changing a task

1. On the day page, select the task's title. The **Edit task** form opens with the task's details. (The checkbox beside it still marks the task done.)
2. Change the title, the deadline, the priority or the notes, then select **Save task**. The form closes and the day shows the change. A task moved to another day leaves this day's list.

If the task was changed somewhere else since you opened it, the form tells you and shows the latest version: check it, make your change again and save.
