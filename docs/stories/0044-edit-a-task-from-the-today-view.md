---
status: implemented
date: 2026-11-07
issue: https://github.com/mgasca/calendar/issues/467
pr:
  - https://github.com/mgasca/calendar/pull/485
  - https://github.com/mgasca/calendar/pull/495
  - https://github.com/mgasca/calendar/pull/499
adrs: ["0014", "0015", "0018", "0020", "0021", "0041", "0043", "0047"]
---

# 0044 Edit a task from the Today view

## Story

> As a calendar editor, I need to open a task from the Today view to change its title, due date, priority or notes, so that I can correct or reschedule it.

Tracked in issue #467, part of the Today view epic #458.

## Background

Tasks can be added ([0003](0003-add-todo-tasks.md), in a dialog since [0006](0006-modal-dialogs-for-adding.md)), completed, reopened and deleted ([0007](0007-overdue-triage-and-task-deletion.md)), but not edited. The API has `GET`, `POST` and `DELETE` on `/api/tasks`, `complete`, `reopen` and `bulk`, and no update. The only way to fix a typo or move a single task to another day is to delete it and add it again; triage ([0007](0007-overdue-triage-and-task-deletion.md)) can reschedule overdue tasks in bulk, but nothing edits the title, priority or notes.

On the Today view, a task's title is part of its checkbox label, so selecting the title toggles completion. This story makes the title open the task for editing instead, and keeps the checkbox for completing.

It follows event editing ([#466](https://github.com/mgasca/calendar/issues/466), card [0043](0043-edit-and-delete-events-from-the-today-view.md)) and uses the same version check for changes made elsewhere. Both regenerate the API contract, so they are delivered one after the other.

### Agreed scope

* **Opening a task:** on the day page (`/` and `/day/:date`), the title of every task under **Overdue** and **Due today** (or **Due this day**) is a button. Selecting it, with the mouse or the keyboard, opens the task dialog titled **Edit task**, prefilled with the stored title, deadline (none, a date, or a date and time), priority and notes. The dialog loads the task first and says so while it loads; if the task no longer exists, it says that and the day refreshes.
* **Checkbox unchanged:** the checkbox still completes and reopens the task, with the same name for screen readers (the task's title). Opening the task for editing never toggles it.
* **Editing:** title, deadline, priority and notes can be changed, with the validation and daylight-saving handling of **Add task** ([0003](0003-add-todo-tasks.md), [ADR-0043](../decisions/0043-form-validation-red-borders-and-bubble.md)). **Save task** saves; **Cancel** and Escape close without saving and without a prompt, except while saving. Completion is not part of the form: editing an open task keeps it open, and editing a completed one keeps it completed.
* **After saving:** the dialog closes, the day and week agendas and the **My tasks** lists refresh, and a status message says "Task saved." A task moved to another day leaves the day's list. Focus returns to the task's title button, or to the day heading when the task has left the day.
* **Changed elsewhere:** the dialog saves against the version it loaded. If the task was changed in the meantime, including completed or reopened in another tab, the save is refused, the dialog says "This task was changed elsewhere. The latest version is shown; check it and save again.", and the form reloads with the latest values. If it was deleted in the meantime, the dialog says so and the day refreshes.
* **Failures:** a network or server error keeps the dialog open with what was typed and a message, and saving can be retried.
* **Ownership:** another user's task cannot be read or changed; the API answers as if it did not exist ([ADR-0041](../decisions/0041-per-user-data-ownership.md)).

### Not in this story

* Editing from **My tasks**, triage or the week view. The endpoint and dialog are reusable; the entry points are follow-up issues.
* Deleting from the dialog. Each row already has **Delete** ([0007](0007-overdue-triage-and-task-deletion.md)).
* Completing or reopening from the dialog; the checkbox does that.
* Events. That is #466, card [0043](0043-edit-and-delete-events-from-the-today-view.md).
* Merging the user's edits with changes made elsewhere. On a conflict the latest version replaces the form.
* A "Discard changes?" prompt on closing an edited dialog.
* The fading save notification of #463. If it has merged when this story's UI lands, the status message uses it; otherwise it uses the plain status message of **Add task**.

### Dependencies

* Builds on [0003](0003-add-todo-tasks.md), [0006](0006-modal-dialogs-for-adding.md) and [0007](0007-overdue-triage-and-task-deletion.md).
* Follows event editing ([#466](https://github.com/mgasca/calendar/issues/466), card [0043](0043-edit-and-delete-events-from-the-today-view.md)): both regenerate `contracts/openapi.json` and the TypeScript client, and this story reuses its version handling.
* The task row is also changed by #460 (delete errors) and #462 (phone layout); this story's row change comes after them.

### Acceptance criteria

1. **Given** a task due today on the Today view, **when** I select its title, change the due date to tomorrow and save, **then** the dialog closes, "Task saved." is announced, the task leaves today's list, and it is listed on tomorrow's. [Move to tomorrow from the day](../../frontend/apps/web/src/features/tasks/EditTaskFromDay.test.tsx) (`moves a task to tomorrow: it leaves the day, the save is confirmed, focus goes to the heading`); [API, both days' agendas](../../backend/tests/Calendar.Api.Tests/Endpoints/TaskEndpointsTests.cs) (`UpdateTask_ReplacesTheEditableFields_AndReturnsANewVersion`).
2. **Given** the edit dialog is open, **when** I change the title, priority or notes and save, **then** the row shows the new title, priority or notes indicator. [Title and priority in the row](../../frontend/apps/web/src/features/tasks/EditTaskFromDay.test.tsx) (`shows a new title and priority in the row and returns focus to the title`); [request](../../frontend/apps/web/src/features/tasks/EditTask.test.tsx) (`opens prefilled and saves a new due date with its version`). The notes indicator follows the same refetch and is not asserted separately.
3. **Given** a task with a due time, **when** I open it, **then** the deadline shows **Exact date and time** with its local date and time; changing it to **No deadline** and saving removes it from the day. [Timed prefill and clearing the deadline](../../frontend/apps/web/src/features/tasks/EditTask.test.tsx) (`opens a timed task with its local time, and clears the deadline`); [fromTask](../../frontend/apps/web/src/features/tasks/EditTask.test.tsx) (`shows each deadline kind`); [API](../../backend/tests/Calendar.Api.Tests/Endpoints/TaskEndpointsTests.cs) (`UpdateTask_SwitchesBetweenDeadlineKinds_AndClearsTheDeadline`). Leaving the day after clearing follows from the agenda refetch, as in criterion 1.
4. **Given** the edit dialog is open, **when** I clear the title and save, **then** nothing is sent and the field says what to fix, as in **Add task**. [Blank title](../../frontend/apps/web/src/features/tasks/EditTask.test.tsx) (`validates like Add task and sends nothing`); [API 400](../../backend/tests/Calendar.Api.Tests/Endpoints/TaskEndpointsTests.cs) (`UpdateTask_Invalid_Returns400WithTheField_AndLeavesTheTaskUnchanged`).
5. **Given** I opened a task and it was then changed elsewhere, **when** I save, **then** the dialog stays open, says the task was changed elsewhere, and shows the latest values; saving again succeeds. [Conflict reload](../../frontend/apps/web/src/features/tasks/EditTask.test.tsx) (`reloads the latest version when the task was changed elsewhere, then saves`).
6. **Given** I opened a task and it was then deleted elsewhere, **when** I save, **then** the dialog says the task no longer exists and the day no longer lists it. [Day view](../../frontend/apps/web/src/features/tasks/EditTaskFromDay.test.tsx) (`says so when the task was deleted elsewhere, and the day drops it`); [dialog](../../frontend/apps/web/src/features/tasks/EditTask.test.tsx) (`says so when the task was deleted elsewhere and stops saving`); [opening](../../frontend/apps/web/src/features/tasks/EditTask.test.tsx) (`says when the task can no longer be opened`).
7. **Given** a save fails with a network or server error (not 400, 404 or 409), **when** it fails, **then** the dialog stays open with my values and a message, and saving again succeeds. [Server error and retry](../../frontend/apps/web/src/features/tasks/EditTask.test.tsx) (`keeps the values after a server error and saves on retry`).
8. **Given** a task row, **when** I select its title, **then** the edit dialog opens and the checkbox is not toggled; **when** I select the checkbox, **then** the task is completed as before, and the checkbox is still named by the task's title. [Title opens without toggling; checkbox completes by its name](../../frontend/apps/web/src/features/tasks/EditTaskFromDay.test.tsx) (`opens from the title without toggling, and the checkbox still completes the task by its title`).
9. **Given** the Today view, **when** I use the keyboard alone, **then** each task title is a button I can reach with Tab and open with Enter or Space, and focus returns to it after **Cancel** or a save that keeps the task on the day. [Keyboard](../../frontend/apps/web/src/features/tasks/EditTaskFromDay.test.tsx) (`opens from the keyboard`); [after Cancel](../../frontend/apps/web/src/features/tasks/EditTaskFromDay.test.tsx) (`opens from the title without toggling, and the checkbox still completes the task by its title`); [after a save](../../frontend/apps/web/src/features/tasks/EditTaskFromDay.test.tsx) (`shows a new title and priority in the row and returns focus to the title`).
10. **Given** two users, **when** one requests or updates the other's task by id, **then** the API answers 404 and the task is unchanged (API tests). [Read](../../backend/tests/Calendar.Api.Tests/Endpoints/OwnershipTests.cs) (`AnotherUsersTask_IsNotFoundForReadCompleteReopenAndDelete_AndStaysUnchanged`); [update](../../backend/tests/Calendar.Api.Tests/Endpoints/OwnershipTests.cs) (`AnotherUsersTask_IsNotFoundForUpdate_AndStaysUnchanged`).
11. **Given** an update that sends a stale version, **when** the API handles it, **then** it answers 409 and the stored task is unchanged (API tests). [Stale version after a complete elsewhere](../../backend/tests/Calendar.Api.Tests/Endpoints/TaskEndpointsTests.cs) (`UpdateTask_AfterACompleteElsewhere_Returns409_AndLeavesTheTaskUnchanged`), which fails without the version check (negative control in PR #495).
12. **Given** the Light and Dark themes at desktop and phone widths, **when** I open and save a task, **then** the row and dialog are legible and usable in both (checked in the running app, with screenshots in the UI PR). Checked by hand in the running app; screenshots in [PR #499](https://github.com/mgasca/calendar/pull/499).
13. **Given** the change is complete, **when** I run `just check`, **then** it passes, including the regenerated contract. `just check` on the delivering revision of PR #499, and CI on each PR.

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

* **A version sent back on update:** the task response carries the same opaque `version` as events (#466, card [0043](0043-edit-and-delete-events-from-the-today-view.md)), and the update must send it. **Complete** and **reopen** only detect a race inside one request; an edit dialog stays open for a while, so it needs to detect a change made after it opened.
* **Full replacement of the editable fields:** the update takes title, priority, notes and the deadline, with the create rules. Completion is left alone, so an edit never completes or reopens a task by accident.
* **Completed tasks can be edited** (proposed in PR 0, [#485](https://github.com/mgasca/calendar/pull/485), which merged without changes): the Today view lists completed tasks under **Due today**, and correcting a title or notes of a done task is harmless. Rescheduling a completed task is allowed too; it stays completed.
* **The title is the button, the checkbox keeps its name:** the title moves out of the checkbox's `<label>` into a `<button>` styled as text, and the checkbox is named by that title, so assistive technology still announces "Buy milk, checkbox".
* **The dialog loads the task:** the agenda carries only `hasNotes` and no version, so opening a task fetches it by id.

## Implementation notes

Delivered after the card ([#485](https://github.com/mgasca/calendar/pull/485)) in two PRs: the API with the regenerated contract ([#495](https://github.com/mgasca/calendar/pull/495)), then the Today view and this card's completion ([#499](https://github.com/mgasca/calendar/pull/499), stacked on the event-editing UI of [0043](0043-edit-and-delete-events-from-the-today-view.md) because both change the same rows and styles). No migration.

### Where things live

| Area | Location |
| --- | --- |
| Endpoint | `backend/src/Calendar.Api/Endpoints/TaskEndpoints.cs`: `UpdateAsync` |
| Contracts | `backend/src/Calendar.Api/Contracts/TaskContracts.cs`: `UpdateTaskRequest`, `TaskResponse.Version`; `TaskResponse.From(task, version)` for tracked tasks, `Projection` reads the version with `EF.Property` and `RowVersion.PropertyName` |
| Version token | `backend/src/Calendar.Infrastructure/RowVersion.cs` (from 0043); `PropertyName` is public for query projections, so the column name stays in Infrastructure (ADR-0014) |
| Domain | `backend/src/Calendar.Domain/Tasks/TodoTask.cs`: `Update` applies the `Create` rules through a validated copy and leaves `CompletedAt` alone |
| Contract and client | `contracts/openapi.json`, `frontend/packages/api-client/src/schema.gen.ts` (by `just contracts`) |
| Dialog | `frontend/apps/web/src/features/tasks/TaskForm.tsx` (edit mode, conflict reload), `taskForm.ts` (`fromTask`; `SaveTaskError` carries the status), `EditTask.tsx` (loads the task), `useEditTask.ts` (`taskQuery`) |
| Row | `frontend/apps/web/src/features/agenda/TaskItem.tsx`: with `onOpen`, the title is a button and the checkbox is named by it (`aria-labelledby`, `taskTitleId` in `taskTitleId.ts`); without it (week view) the row is unchanged |
| Day view | `frontend/apps/web/src/features/day/DayView.tsx`: `openTask`, the **Task saved.** notification and `focusTitleOrHeading` (shared with event editing) |

### API

* `PUT /api/tasks/{id}` (`UpdateTask`): body `title`, `priority` (default medium), `notes`, `dueDate` or `dueAt` (neither clears the deadline), and the required `version`. 200 with the updated task and its new version; 400 with field errors (create's keys; a missing `version` is a binding 400); 404 when the task does not exist or belongs to another user; 409 when `version` is stale, with nothing written. A complete or reopen changes the version, so it makes an open edit stale.
* Every task response (`GET`, list, `POST`, `complete`, `reopen`, `PUT`) carries `version`. Like events, the generated TypeScript type is `number | string`; the client sends back what it got.

### Testing

* Domain: [TodoTaskTests](../../backend/tests/Calendar.Domain.Tests/Tasks/TodoTaskTests.cs) (`Update_ReplacesTheEditableFields_AndKeepsIdOwnerAndCompletion`, `Update_CanClearTheDeadline_AndKeepsAnOpenTaskOpen`, `Update_WithInvalidValues_Throws_AndChangesNothing`).
* API with Testcontainers: [TaskEndpointsTests](../../backend/tests/Calendar.Api.Tests/Endpoints/TaskEndpointsTests.cs) (fields and agenda move, deadline kinds, completed stays completed, stale version, invalid, unknown, version agreement across list, get and actions) and [OwnershipTests](../../backend/tests/Calendar.Api.Tests/Endpoints/OwnershipTests.cs).
* Vitest with MSW: [EditTask.test.tsx](../../frontend/apps/web/src/features/tasks/EditTask.test.tsx) for the dialog against a task store with the API's version check, and [EditTaskFromDay.test.tsx](../../frontend/apps/web/src/features/tasks/EditTaskFromDay.test.tsx) for the routed day view (move, row update, title versus checkbox, deleted elsewhere, keyboard).
* The running app (throwaway stack, Light and Dark, 1280×900 and 390×844): open a timed task, change title and priority, save; move a date-only task to tomorrow.

### Lessons learned, known issues and follow-ups

* **Stacking on the event UI.** Both stories add title buttons, dialog state and focus handling to `DayView.tsx` and the `.item-open` style, so the task UI was stacked on the event UI branch; the merge combined the two focus helpers into one (`focusTitleOrHeading`).
* **A replaced dialog element.** The loading dialog and the form's dialog are different elements, so a test that holds the first one and waits for the form inside it never finds it; the tests wait for the form's **Title** field and then take the dialog.
* **Week view and My tasks:** opening a task from them is not in this story; the row keeps the old label there. Follow-up: [#500](https://github.com/mgasca/calendar/issues/500).
* **Completed tasks** can be edited and stay completed, as proposed in PR 0.
* **Focus after a move raced the refetch ([#698](https://github.com/mgasca/calendar/issues/698)).** The save resolves once the refetched day is in the query cache, but TanStack Query hands it to React on a later `setTimeout(0)`. The `requestAnimationFrame` that chose the focus target could run first: it found the moved task's old title, focused it, and focus fell to `<body>` when the row went. In CI the move-to-tomorrow test then timed out at 5 s. Focus is now chosen in an effect after the render that closes the dialog (`useAfterRender` in `components/`), and that render already shows the refetched day. The regression test runs the frame at once, so it fails on the old code every time. Before the fix, a probe that delayed the notifications failed 32 of 180 runs; after it, 0 of 120. The week view, My tasks and event dialogs still pick their focus target on the next frame.

## User guide

### Changing a task

1. On the day page, select the task's title. The **Edit task** form opens with the task's details. (The checkbox beside it still marks the task done.)
2. Change the title, the deadline, the priority or the notes, then select **Save task**. The form closes, a message says **Task saved.**, and the day shows the change. A task moved to another day leaves this day's list.

If the task was changed somewhere else since you opened it, including being ticked off in another tab, the form tells you and shows the latest version: check it, make your change again and save. If it was deleted, the form says it no longer exists.

Tasks can be changed from the day page for now, not from the week or **My tasks**.
