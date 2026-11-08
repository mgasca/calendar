---
status: implemented
date: 2026-11-08
issue: https://github.com/mgasca/calendar/issues/492
pr:
  - https://github.com/mgasca/calendar/pull/530
adrs: ["0018", "0020", "0021", "0041", "0043", "0047"]
---

# 0047 Edit and delete events from the Week view

## Story

> As a calendar user, I want to open an event from the Week view to change or delete it, as I can from the Today view.

Tracked in issue #492, a follow-up of [0043](0043-edit-and-delete-events-from-the-today-view.md) (issue #466), which left the week view out of scope.

## Background

Story [0043](0043-edit-and-delete-events-from-the-today-view.md) lets the Today view open an event in the **Edit event** dialog, backed by `PUT` and `DELETE /api/events/{id}` with a version check. The Week view's events (the time grid and the all-day band in `frontend/apps/web/src/features/week/`) are not interactive. The endpoints, the dialog and its save, conflict and delete behaviour are reusable as they are. This story adds the week view's entry points and checks that the dialog's invalidations refresh the week.

No API change is expected.

### Agreed scope

- **Opening an event:** in the week view, the title of every timed event in the time grid and of every all-day event in the all-day band is a button, as on the Today view. Selecting it, with the mouse or the keyboard, opens the event in the same **Edit event** dialog, prefilled from the stored event.
- **Editing and deleting:** the dialog's behaviour is the one in 0043: validation, time-zone handling, **Save event**, **Cancel**, **Delete event** with confirmation, conflict and not-found messages, and failure retry.
- **After saving or deleting:** the dialog closes, every agenda query refreshes (day and week), and the same status message appears. Focus returns to the event's title button after a save, or to the week heading after a delete, because the event may have moved or gone.
- **Week refresh:** after a save that moves an event to another day or into the all-day band, the week shows it in its new place.

### Not in this story

- Creating events from the week view ([XXXX](XXXX-create-events-and-tasks-from-week-view.md)).
- Editing or deleting tasks from the week view. Tasks in the week already have their own toggle and are not part of #492.
- Drag to move or resize an event in the grid.
- Any change to the dialog's behaviour, the API or the contract.

### Dependencies

- [0043](0043-edit-and-delete-events-from-the-today-view.md): the dialog, the endpoints and the version check.
- [0002](0002-week-view.md): the week view.

### Acceptance criteria

1. **Given** a timed event on the week view, **when** I select its title, change the start and save, **then** the dialog closes, the status message says the event was saved, and the week lists the event at its new time.
2. **Given** an all-day event in the week's all-day band, **when** I select its title, **then** the dialog opens with **All day** checked, and saving a changed last day moves it across the week.
3. **Given** the edit dialog is open from the week view, **when** I select **Delete event**, then **Delete**, **then** the dialog closes, the status message says the event was deleted, and the week no longer lists it.
4. **Given** the week view, **when** I use the keyboard alone, **then** each event title is a button I can reach with Tab and open with Enter or Space, and focus returns to it after a save or **Cancel**.
5. **Given** an event that another user owns or that was deleted elsewhere, **when** it is opened from the week, **then** the dialog says it can no longer be opened and the week drops it (as on the Today view).
6. **Given** the change is complete, **when** I run `just check`, **then** it passes. Checked on the delivering revision of each PR and in CI.

## Design decisions

### Any Decision Records

| ADR                                                                                 | Decision                                                  | Why it matters for this story                                                             |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md)            | Resource endpoints for writes, the agenda as a read model | Edits and deletes still go to `/api/events/{id}`; the week agenda is refetched afterwards |
| [0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md)      | The client's local date and zone define the day           | The week's zone and today come from the client, as the dialog already expects             |
| [0043](../decisions/0043-form-validation-red-borders-and-bubble.md)                 | Red borders and a bubble for form validation              | Unchanged; the same dialog is reused                                                      |
| [0047](../decisions/0047-semantic-css-tokens-selected-by-a-data-theme-attribute.md) | Semantic tokens and a `data-theme` attribute              | The title button in the week uses the shared classes and tokens in both themes            |

No new ADR is expected.

### Other decisions (not ADR-worthy)

- **The same dialog and title button:** the week reuses 0043's `EditEvent` and its title-button pattern rather than a second editor, so the behaviour cannot drift between the two views.
- **The title is the button:** as in 0043, the time-grid block and the band chip keep their layout; only the title is a button, so the target is explicit and keyboard use matches the Today view.

## Implementation notes

Delivered in a PR stacked on the card ([#530](https://github.com/mgasca/calendar/pull/530)). No API or contract change; the dialog from [0043](0043-edit-and-delete-events-from-the-today-view.md) is reused as it is.

### Where things live

| Area             | Location                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry points     | `frontend/apps/web/src/features/week/TimeGrid.tsx` (timed event titles, `OpenEvent`) and `AllDayBand.tsx` (all-day bar titles): each title is an `item-open` button                                                 |
| Dialog and focus | `frontend/apps/web/src/features/week/WeekView.tsx`: opens `EditEvent`, shows the status message, and focuses the opening title or, after a delete or when it has left the week, the week heading (`focusAfterEdit`) |

### API

No changes.

### Testing

- [WeekView.test.tsx](../../frontend/apps/web/src/features/week/WeekView.test.tsx), `editing from the week`: opens a timed event and returns focus to its title on **Cancel**; opens an all-day event with **All day** checked; deletes from the dialog, drops the event from the week, and moves focus to the heading.
- The save path and the conflict, not-found and failure cases are the dialog's, tested in [EditEvent.test.tsx](../../frontend/apps/web/src/features/events/EditEvent.test.tsx) by 0043.
- Not run in the running app or checked in Light and Dark; the entry points reuse the Today view's button, and the styling was not reviewed on screen.

## User guide

### Changing or deleting an event from the week

In the week view, select an event's title, in the day columns or in the bar across the top for all-day events. The **Edit event** form opens; change it and select **Save event**, or select **Delete event** and then **Delete** to remove it. **Cancel** closes the form without saving. Focus returns to the event when the form closes, or to the week heading after a delete.
