---
status: planned
date: 2026-10-28
pr: https://github.com/mgasca/calendar/pull/40
adrs: [0021, 0026]
---

# 0005 Add tasks and events in a modal dialog

## Story

> As a calendar editor I need adding a task and adding an event to work the same way, in a modal dialog, so that I can add either without losing my place on the page.

Issue: [#39](https://github.com/mgasca/calendar/issues/39).

## Background

[0004](0004-add-event-entries.md) deliberately made **Add event** a modal dialog and left **Add task** as an inline form, so the product owner could compare the two in usability testing. That testing is done: the dialog is preferred. 0004's [Follow-ups](0004-add-event-entries.md#follow-ups) already reserved a separate story for making both forms use it. This is that story.

Today **Add event** opens a native `<dialog>` (`features/events/EventForm.tsx`), while **Add task** (`features/tasks/AddTask.tsx`, `TaskForm.tsx`) reveals an inline `<section>`. The dialog behaviour (opening with `showModal()`, Escape, Cancel, blocking close while saving, focus handling) lives in the event form only.

### Scope

* **Add task opens a modal dialog,** on the day page and on **My tasks**. The inline task form goes away.
* **One shared dialog behaviour** for both forms: modal, labelled by its heading, focus on the first field when it opens, Escape and **Cancel** close it without a confirmation and without saving, neither works while a save is in progress, and focus returns to the button that opened it.
* **The forms' content does not change.** Fields, defaults, validation, daylight-saving handling, error messages and the data each form sends are as they are today.
* **After saving a task,** the dialog closes, the task lists and agenda refresh, and the existing confirmation ("Task added. You can find it in My tasks.") is shown. After saving an event, the existing confirmation and **Show day** are unchanged.
* **Prefill:** **Add task** keeps starting with the viewed date on the day page and with no deadline on **My tasks**. **Add event** keeps its initial values, so the week view can still open it prefilled ([XXXX](XXXX-create-events-and-tasks-from-week-view.md)).

### Not in this story

* Changing what either form asks for, or its validation.
* A "Discard?" prompt when closing an edited dialog. Still not needed for now ([0004](0004-add-event-entries.md#follow-ups)).
* Editing and deleting tasks or events.
* Creating from the week view. That is [XXXX](XXXX-create-events-and-tasks-from-week-view.md); it should open these dialogs.
* Moving the confirmations or restyling the dialogs beyond what is needed to share them.

### Acceptance criteria

1. **Given** the day view is open, **when** I choose **Add task**, **then** a modal dialog named "Add task" opens, the due date is the day being viewed, and no inline task form is shown.
2. **Given** **My tasks** is open, **when** I choose **Add task**, **then** the same dialog opens with no deadline.
3. **Given** the task dialog is filled in, **when** I save, **then** the dialog closes, "Task added. You can find it in My tasks." is shown, and the task appears in the task list and, if dated, in the agenda.
4. **Given** the task dialog is open and I have typed values, **when** I select **Cancel** or press Escape, **then** the dialog closes without asking for confirmation, nothing is saved, and focus returns to **Add task**.
5. **Given** a task is being saved, **when** the request is in progress, **then** the task dialog's controls are disabled, and **Cancel** and Escape do nothing.
6. **Given** a task save fails (validation, network or server error), **when** the dialog is still open, **then** the message is shown in the dialog, what I typed is kept, and I can submit again.
7. **Given** the task dialog is open, **when** I enter a deadline time that doesn't exist or occurs twice because clocks change, **then** the form rejects it or asks which occurrence is meant, as before.
8. **Given** either dialog is open, **when** I use the keyboard alone, **then** all controls are labelled and operable, focus starts on the title, focus stays inside while the dialog is open, and focus returns to the button that opened it when it closes.
9. **Given** the event dialog is open, **when** I save, cancel, press Escape, or a save fails or is pending, **then** it behaves exactly as in [0004](0004-add-event-entries.md) (its acceptance criteria and tests still pass unchanged).
10. **Given** either button has been used and the dialog closed, **when** I use the button again, **then** the dialog opens fresh, without the previous values.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md) | The client's local date and zone define "today" | The task dialog's default date and its deadline times use the browser's zone, as before |
| [0026](../decisions/0026-client-side-routing-with-tanstack-router.md) | Client-side routing with TanStack Router | The dialogs are opened from the `/day/:date` and `/tasks` routes; **Show day** still navigates |

No new ADR is expected. Using a dialog library would need its own ADR first; the native `<dialog>` is enough.

### Other decisions (not ADR-worthy)

* **Extract, don't copy:** the dialog behaviour moves out of `EventForm` into one shared component (`ModalDialog`) that both forms render inside. It owns opening with `showModal()` (guarding against StrictMode's double effect), Escape, the pending lock and the `<dialog>` markup; each form keeps its own fields, mutation and error handling. This keeps the two dialogs from drifting apart, which is the point of the story.
* **Pending lock:** the shared dialog ignores Escape and **Cancel** while the form says a save is pending, as 0004 does for events, because the request can't be cancelled and closing would hide its result.
* **Task errors stay in one message:** the task form keeps its single `role="alert"` message ([0003](0003-add-todo-tasks.md)). Per-field errors for tasks are not part of this story.
* **Confirmation and focus stay with the button:** as in 0004, the button component owns the confirmation message and moves focus back to the button after close. Only the form is inside the dialog.
* **No change to the API or the generated client.**

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| Shared dialog | `frontend/apps/web/src/components/ModalDialog.tsx` (new) |
| Task dialog | `features/tasks/TaskForm.tsx` rendered inside the shared dialog; `AddTask.tsx` keeps the button, confirmation and focus return |
| Event dialog | `features/events/EventForm.tsx` switches to the shared dialog; behaviour unchanged |
| Entry points | `features/day/DayPage.tsx` and the `/tasks` route in `router.tsx` (no change expected) |
| Styles | `index.css`: shared dialog styles replace `.task-form` and `.event-dialog` |

### API

No changes.

### Testing

Vitest with Testing Library and MSW. The existing event dialog tests continue to pass unchanged. New or updated tests cover the task dialog: opening from both entry points, saving, **Cancel**, Escape, pending lock, failure and retry, and focus. jsdom has no modal dialogs, so `test/setup.ts` keeps stubbing `showModal()` and `close()`; the browser's focus trap and inert background are not tested.

### Delivery plan

1. The story (this PR).
2. The shared dialog, the task form in it, the event form moved onto it, tests and styles.

### Follow-ups

* **Week view creation** ([XXXX](XXXX-create-events-and-tasks-from-week-view.md)) opens these dialogs from slots and the all-day band.
* **Discard prompt:** revisit if people lose typed text by closing a dialog.

## User guide

### Adding a task or an event

1. Select **Add task** or **Add event**. A form opens over the page.
2. Fill it in and select **Save task** or **Save event**.
3. The form closes and a message confirms what was added.

To leave without saving, select **Cancel** or press Escape. What you typed is discarded without asking. You can't close the form while it is saving. If saving fails, the form stays open with what you typed so you can fix it and try again.
