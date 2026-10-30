---
status: planned
date: 2026-10-27
pr: ["https://github.com/mgasca/calendar/pull/17"]
adrs: ["0018", "0020"]
---

# XXXX Create events and tasks from the week view

## Story

> As a forward planner, I need to be able to add events and tasks straight from my week view so I can plan into the free time I can see, without leaving the week.

*Split out of [0002](0002-week-view.md) while reviewing its design. The story wording is derived from 0002 and is to be confirmed by the product owner.*

*Numbered `XXXX` for now: it gets its number when it is scheduled. It must come after the stories that add creating events and tasks from the day view.*

## Background

So far, events and tasks can only be created through the API or `make db-seed` ([0001](0001-today-view.md)). With the week view ([0002](0002-week-view.md)) a planner can see the free time in the week, but can't use it without leaving the week.

Creating events and tasks **from the day view** is covered by other stories, which are delivered first:

* Adding events from the day view: [story 0004](0004-add-event-entries.md).
* Adding todo tasks: [#23](https://github.com/mgasca/calendar/pull/23).

Those stories build the forms, the client-side validation, the create hooks and the error handling. This story **reuses them** and only adds the week view's ways in: choosing a time slot, a date or a day, and opening the existing forms prefilled. If the day-view stories change the forms, this story follows them rather than defining its own.

The `POST /api/events` and `POST /api/tasks` endpoints already exist. This is a UI story with no backend changes, unless the task stories add fields that the week needs to prefill.

### Dependencies

* Story 0002 (week view), implemented in [#18](https://github.com/mgasca/calendar/pull/18), [#19](https://github.com/mgasca/calendar/pull/19) and [#24](https://github.com/mgasca/calendar/pull/24).
* [Story 0004](0004-add-event-entries.md): the event form.
* The todo task story ([#23](https://github.com/mgasca/calendar/pull/23)): the task form.

### Scope (proposed)

* **Timed event:** clicking an empty grid slot opens the event form prefilled with a one-hour event. Dragging selects a time range, snapped to 30 minutes.
* **All-day event:** clicking the all-day band opens the event form prefilled with an all-day event on that date.
* **Task:** "+ Task" in each day's task strip opens the task form, due that day.
* **Keyboard:** every day column has an "Add to *weekday*" button, so creating never needs a pointer.
* **Not in this story:**
  * The forms themselves, and creating from the day view. Those belong to the stories above.
  * Editing, moving (including drag and drop) and deleting existing items, which need update endpoints.
  * Recurring events and reminders.

### Acceptance criteria

1. **Given** the week view is open, **when** a timed event, all-day event or task is created with a pointer or keyboard alone, **then** the corresponding item is created.
2. **Given** creation is opened from a slot, dragged range, all-day band or task strip, **when** the form opens, **then** it is prefilled with the selected time range or day.
3. **Given** an item is created successfully from the week view, **when** the server confirms it, **then** it appears in the correct place in the week and in the day view without a reload.
4. **Given** a create form is submitted with invalid data or the request fails, **when** validation or the error state is shown, **then** validation, error and retry behaviour matches creation from the day view.
5. **Given** the form was opened from a slot, band or button, **when** the form closes, **then** focus returns to that originating control.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0018](../decisions/0018-time-representation-and-bcl-date-time-types.md) | UTC instants plus an IANA zone, and floating dates | A slot is turned into instants in the viewer's zone; the all-day band and task strips prefill dates |
| [0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md) | Agenda read models, with resource endpoints for writes | Creating goes through the existing resource endpoints, then the agenda views refresh |

No new ADR is expected.

### Other decisions (proposed, not ADR-worthy)

* **Reuse, don't fork:** the week opens the same forms as the day view, with prefilled values. Any week-only behaviour lives in the entry points, not in the forms.
* **Slot to time:** a slot's position is turned back into a wall-clock time in the viewer's zone with the same helpers that place events on the grid (`gridLayout.ts`), so a click lands where it looks like it does, including on daylight-saving days. A drag on a skipped date is not possible: that column has no timed slots.
* **No optimistic insert:** the new item appears once the server confirms it. All `['agenda']` queries are then invalidated, so the day and week views both pick it up.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things will live

| Area | Location |
| --- | --- |
| Week entry points | Slot click and drag selection in `frontend/apps/web/src/features/week/TimeGrid.tsx`, band click in `AllDayBand.tsx`, "+ Task" in `TaskStrip.tsx`, "Add to *weekday*" in the day columns |
| Forms and create hooks | From the day-view stories (0004 and the todo task story), reused as they are |

### API

No changes expected. Uses the existing `POST /api/events` and `POST /api/tasks`.

### Testing

* **Pure tests:** turning a slot or a dragged range into a start and end, snapped to 30 minutes, including daylight-saving days.
* **Component tests (MSW):** each entry point opens the right form with the right prefilled values, keyboard-only creation, and the new item appearing in the week.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Adding events and tasks from the week

* **Timed event:** click an empty spot on the grid to add a one-hour event, or drag to choose the start and end.
* **All-day event:** click the all-day band at the top of the week.
* **Task:** select **+ Task** under a day's heading. It's due that day.
* **Without a mouse:** each day has an **Add to *weekday*** button.

The same form opens as when you add from the day view, already filled in with the time or date you picked. The new item appears straight away in the week and in the day view.
