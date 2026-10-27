---
status: planned
date: 2026-10-27
pr: https://github.com/mgasca/calendar/pull/17
adrs: [0018, 0020]
---

# 0003 Create events and tasks from the day and week views

## Story

> As a forward planner, I need to be able to add events and tasks straight from my day and week views so I can plan where I'm looking, without leaving the calendar.

*Split out of [0002](0002-week-view.md) while reviewing its design, so the week view can ship read-only first. The story wording is derived from 0002 and is to be confirmed by the product owner.*

## Background

So far, events and tasks can only be created through the API or `make db-seed` ([0001](0001-today-view.md)). With the week view ([0002](0002-week-view.md)) a planner can see the free time in the week, but can't use it without leaving the app.

The `POST /api/events` and `POST /api/tasks` endpoints already exist and validate everything. This story is a UI story: there are no backend changes.

### Scope (proposed)

* **In the week view:**
  * Clicking an empty grid slot prefills a one-hour event.
  * Dragging selects a time range, snapped to 30 minutes.
  * Clicking the all-day band prefills an all-day event for that date.
  * "+ Task" in each day's task strip prefills a task due that day.
* **In the day view:** an "Add" button with the same choices.
* **The form:**
  * Title (required).
  * Timed or all-day, with times or a date range.
  * Location and notes, for events.
  * For tasks: a due date, with an optional time.
* **Not in this story:** editing, moving (including drag and drop) and deleting existing items, which need update endpoints. Also out: recurring events and reminders.

### Acceptance criteria

1. From the week view, a timed event, an all-day event and a task can each be created with a pointer, and also with the keyboard alone.
2. From the day view, the same three can be created with the "Add" button.
3. A new item appears in the right place in both views without a reload.
4. Server validation errors (400 problem details) are shown in the form next to the field they belong to, and what was typed is kept.
5. If saving fails for another reason, the form stays open with a message and can be retried. Nothing is shown as created until the server confirms it.
6. The form is an accessible dialog: focus moves into it, is trapped while it is open, and returns to where it was opened from.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0018](../decisions/0018-time-representation-and-bcl-date-time-types.md) | UTC instants plus an IANA zone, and floating dates | Timed events are sent as instants with an explicit offset plus the browser's zone; all-day events and date-only tasks as dates |
| [0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md) | Agenda read models, with resource endpoints for writes | Creating goes through the existing resource endpoints, then the agenda views refresh |

No new ADR is expected. If the form needs a date-picker or form library, that dependency gets an ADR first.

### Other decisions (proposed, not ADR-worthy)

* **Keyboard alternative:** every week column has an "Add to *weekday*" button that opens the same form as clicking a slot, so creating never needs a pointer.
* **All-day end dates:** the form shows an inclusive end date ("26–27 Oct") and sends the exclusive `endDate` the API expects (28 Oct).
* **Times are entered in the browser's zone.** The form sends instants with an explicit offset (`ExplicitOffsetConverter` rejects values without one) and the browser's IANA zone.
* **No optimistic insert:** the new item appears once the server confirms it. All `['agenda']` queries are then invalidated, so the day and week views both pick it up. Placing an unconfirmed item correctly would need the server's inclusion rules on the client.
* **Client-side checks mirror the server** (required title, end after start, at most 200 characters for title and location, 4000 for notes) for fast feedback. The server stays the authority.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things will live

| Area | Location |
| --- | --- |
| Hooks | `frontend/apps/web/src/features/agenda/`: `useCreateEvent.ts`, `useCreateTask.ts` (`POST` and invalidate `['agenda']`) |
| Form | `features/agenda/CreateItemPopover.tsx`, shared by the day and week views |
| Week view | Slot click and drag selection in `features/week/TimeGrid.tsx`, band click in `AllDayBand.tsx`, "+ Task" and "Add to *weekday*" in the day columns |
| Day view | An "Add" button in `features/day/DayView.tsx` |

### API

No changes. Uses the existing `POST /api/events` and `POST /api/tasks` (see [0001](0001-today-view.md#api)).

### Testing

* **Pure tests:** slot and drag snapping, and converting between inclusive and exclusive all-day end dates.
* **Component tests (MSW):**
  * Each create flow from the week and day views.
  * Server validation errors mapped to fields.
  * Failure and retry.
  * Focus handling in the dialog.
  * Keyboard-only creation.

### Delivery plan

One PR after 0002 ships: the hooks and form first with the day view's "Add", then the week view's slot, band and strip entry points.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Adding events and tasks

* **Timed event:** in the week view, click an empty spot on the grid to add a one-hour event, or drag to choose the start and end.
* **All-day event:** click the all-day band at the top of the week.
* **Task:** select **+ Task** under a day's heading. It's due that day, and you can add a time.
* **Day view:** select **Add** to create any of these for that day.
* **Without a mouse:** each day in the week has an **Add to *weekday*** button.

Give it a title (required) and, if you like, a location and notes, then save. The new item appears straight away in the day and week views. If something isn't valid, for example an end time before the start, the form tells you what to fix and keeps what you typed.
