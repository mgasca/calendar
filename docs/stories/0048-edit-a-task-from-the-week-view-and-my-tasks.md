---
status: implemented
date: 2026-11-08
issue: https://github.com/mgasca/calendar/issues/500
pr:
  - https://github.com/mgasca/calendar/pull/535
  - https://github.com/mgasca/calendar/pull/536
adrs: ["0020", "0021", "0041", "0043", "0047"]
---

# 0048 Edit a task from the Week view and My tasks

## Story

> As a calendar user, I need to open a task from the Week view or My tasks to change its title, due date, priority or notes, so that I can correct or reschedule it where I found it, as I can from the Today view.

Tracked in issue #500, a follow-up of [0044](0044-edit-a-task-from-the-today-view.md) (#467).

## Background

[0044](0044-edit-a-task-from-the-today-view.md) added the **Edit task** dialog (`EditTask`, backed by `PUT /api/tasks/{id}` with a version check) and opened it from the Today view. It left the other entry points as follow-ups. `TaskItem` takes an optional `onOpen`; the Week view (`TaskStrip`, `OverduePanel`) and **My tasks** (`TaskList`) do not pass it, so there the title still labels the checkbox and a task cannot be edited.

Events already open from the Week view ([0047](0047-edit-and-delete-events-from-the-week-view.md)).

### Agreed scope

* **Week view:** the title of every task in a day's strip and in the **Overdue** panel is a button. Selecting it, with the mouse or the keyboard, opens the **Edit task** dialog, prefilled and loaded as on the Today view.
* **My tasks:** the title of every task in every view (Upcoming and the others) is a button that opens the same dialog.
* **Checkbox unchanged:** it still completes and reopens the task and is still named by the title. Opening the dialog never toggles the task.
* **After saving:** the dialog closes, the agendas and task lists refresh (the dialog already invalidates them), and "Task saved." is announced. Focus returns to the task's title button, or to the page heading (week heading, **My tasks** heading) when the task has left the list.
* **Everything else is the dialog of 0044:** validation, conflict reload, deleted-elsewhere and failure handling.

### Not in this story

* Triage, and deleting or completing from the dialog.
* Week events (done in 0047) and creating items from the week.
* Any API or contract change.

### Acceptance criteria

1. **Given** a task in a day of the Week view, **when** I select its title, change the due date and save, **then** the dialog closes, "Task saved." is announced and the task is in its new day.
2. **Given** a task in the Week view's **Overdue** panel, **when** I select its title and save a new date, **then** it leaves the panel (or moves) as the refetched week says.
3. **Given** My tasks in any view, **when** I select a task's title, change it and save, **then** the list shows the new title.
4. **Given** a task row in either view, **when** I select the title, **then** the dialog opens and the checkbox is not toggled; **when** I select the checkbox, **then** the task completes and the checkbox is named by the title.
5. **Given** the keyboard alone, **when** I Tab to a title and press Enter or Space, **then** the dialog opens, and after Cancel or a save that keeps the task in the list focus returns to the title; after a save that removes it, focus goes to the page heading.
6. **Given** the task was changed or deleted elsewhere, **when** I save, **then** the dialog behaves as in 0044.
7. **Given** the Light and Dark themes at desktop and phone widths, **when** I open and save a task from either view, **then** rows and dialog are legible and usable (checked in the running app).
8. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md) | Resource endpoints for writes, the agenda as a read model | The edit goes to `/api/tasks/{id}`; the week agenda and lists are refetched afterwards |
| [0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md) | The client's date and zone define the day | The dialog resolves due times in the browser's zone |
| [0041](../decisions/0041-per-user-data-ownership.md) | Per-user ownership | Unchanged: another user's task answers 404 |
| [0043](../decisions/0043-form-validation-red-borders-and-bubble.md) | Red borders and a bubble for validation | The dialog reuses the task form's validation display |
| [0047](../decisions/0047-semantic-css-tokens-selected-by-a-data-theme-attribute.md) | Semantic tokens and a `data-theme` attribute | The title button uses shared classes in both themes |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **Reuse, no new dialog:** `EditTask`, `TaskForm` and `taskTitleId` are reused; each view holds the open task id and renders `EditTask`, as the Today view does.
* **One delivery PR:** the Week view and My tasks change the same small set of components, so they ship together after this card.

## Implementation notes

Delivered after the card ([#535](https://github.com/mgasca/calendar/pull/535)) in one PR ([#536](https://github.com/mgasca/calendar/pull/536)), stacked on it. No API change.

### Where things live

| Area | Location |
| --- | --- |
| Week view | `frontend/apps/web/src/features/week/WeekView.tsx` (`openTask`, `EditTask`), `TaskStrip.tsx` and `OverduePanel.tsx` (`onOpen` on `TaskToggleProps`) |
| My tasks | `frontend/apps/web/src/features/tasks/TaskList.tsx` (title button, `EditTask`, `focusTitleOrHeading`) |
| Reused | `EditTask`, `TaskForm`, `TaskItem` (`onOpen`), `taskTitleId` |

### Testing

* Week: [WeekView.test.tsx](../../frontend/apps/web/src/features/week/WeekView.test.tsx) (`editing a task from the week (story 0048)`: day task and Overdue panel, checkbox unchanged, focus on Cancel, save confirmed). Both fail with `onOpen` not passed (negative control run locally).
* My tasks: [Tasks.test.tsx](../../frontend/apps/web/src/features/tasks/Tasks.test.tsx) (`opens a task from its title in My tasks, saves it and shows the new title`).
* Not checked in the running app: criterion 7 (themes and widths) has no screenshots yet.
* Test fixtures that used a task title as its id were changed to space-free ids: `aria-labelledby` splits ids on spaces, which real ids never contain.

## User guide

### Changing a task from the week or My tasks

In the Week view (a day or the **Overdue** panel) or in **My tasks**, select a task's title. The **Edit task** form opens; change the title, deadline, priority or notes and select **Save task**. A message says **Task saved.** The checkbox beside the title still marks the task done.
