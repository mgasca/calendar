---
status: planned
date: 2026-10-27
pr: https://github.com/mgasca/calendar/pull/20
adrs: [0018, 0019, 0020, 0021, 0026]
---

# 0004 Add event entries so I know when my appointments are

## Story

> As a calendar editor I need to be able to add event entries so that I know when my appointments are.

## Background

The API can already create events. `POST /api/events` validates timed and all-day events, stores them with an overlap index, and is in the generated client ([0001](0001-today-view.md#api)). The web app has no way to use it: the day view can show events, and since [0003](0003-add-todo-tasks.md) it can add tasks, but the only way to add an event is `make db-seed` or a direct API call.

This story adds the event form to the day view, beside **Add task**, so an editor can add an appointment and see it on the right day. It is the event counterpart of 0003, and it follows the same patterns where it can.

### Scope

* **Entry point:** an **Add event** button next to **Add task** on the day page (`features/day/DayPage.tsx`) opens the event form.
* **Event kinds:** timed or all-day. All-day events can span several days.
* **Fields:** title (required), start and end (date and time for timed events, dates for all-day), location and notes.
* **Defaults:** the form starts on the day being viewed (not necessarily today). For a timed event, the start is the next half hour on today, or 09:00 on any other day. The end is one hour after the start. Changing the start moves the end and keeps the duration; changing the end changes the duration.
* **Time zone:** the browser's IANA zone, shown in the form but not editable, as in the task form. Times are entered in that zone.
* **Daylight-saving times:** same rules as the task form ([0003](0003-add-todo-tasks.md)). A local time that doesn't exist is rejected, and a time that occurs twice asks which occurrence is meant.
* **Overlaps:** events may overlap. The form does not warn or block.
* **After saving:** the new event appears in the agenda queries it touches, and a confirmation says which day it was added to. If that day is not the one being viewed, the confirmation offers **Show day**.
* **Day navigation:** already in place and not part of this story. The day page has a date picker and the `/day/:date` routes from [0002](0002-week-view.md) ([ADR-0026](../decisions/0026-client-side-routing-with-tanstack-router.md)); `/` follows the clock.
* **Reuse by the week view:** the form takes initial values (date, start and end times, all-day), so the week view can open it prefilled. The week's entry points are in [XXXX](XXXX-create-events-and-tasks-from-week-view.md), which depends on this story.

### Not in this story

* Adding tasks. That is [0003](0003-add-todo-tasks.md), already implemented.
* Creating from the week view. That is [XXXX](XXXX-create-events-and-tasks-from-week-view.md).
* Editing and deleting events. These need `PUT`/`PATCH`/`DELETE` endpoints and use the `xmin` concurrency token already on the table.
* Overlap warnings. The overlap query and index are ready, so this can follow.
* A time zone picker for events in other zones, and showing an event's original zone.
* Recurrence, reminders and invitations.
* Natural-language input ("dentist tomorrow 3pm").

### Acceptance criteria

1. **Given** the day view, **when** I choose **Add event**, enter "Dentist" for 29 October 15:00–16:00 and save, **then** the form closes, a message says "Dentist added for Thu 29 Oct", and the event is listed on 29 October.
2. **Given** an all-day event from 29 to 31 October (inclusive end in the form), **then** it is listed under *All day* on each of those three days and not on 1 November.
3. **Given** a timed event from 23:30 to 00:30 the next day, **then** it appears on both days, marked as continuing.
4. **Given** an empty title, or an end before the start, **then** the form does not submit and says what to fix next to the field.
5. **Given** a start or end that doesn't exist because clocks change, **then** the form rejects it. **Given** one that occurs twice, **then** the form asks which occurrence is meant before it saves.
6. **Given** the server rejects the request (400), **then** the form stays open, the message appears next to the matching field, and what I typed is kept.
7. **Given** a network or server error (other than 400), **then** the form stays open with a message and can be submitted again. Nothing is shown as saved until the server confirms it. Saving disables the form, so it can't be submitted twice.
8. **Given** two events at the same time, **then** both are saved and both are shown.
9. The form is keyboard-operable with labelled controls. Focus moves to the title when it opens, and returns to **Add event** when it closes.
10. Times in the form and the agenda use the browser's time zone.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0018](../decisions/0018-time-representation-and-bcl-date-time-types.md) | UTC instants with an IANA zone, and floating dates | Timed events are sent as instants with an explicit offset plus the zone; all-day events as dates with an exclusive end |
| [0019](../decisions/0019-single-user-mode-with-authentication-deferred.md) | Single user, no sign-in | The form has no owner or permissions |
| [0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md) | Resource endpoints for writes, the agenda as a read model | Saving uses `POST /api/events`; the agenda is refetched and the server decides which days an event appears on |
| [0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md) | The client's local date and zone define "today" | The form's default date and zone come from the browser |
| [0026](../decisions/0026-client-side-routing-with-tanstack-router.md) | Client-side routing with TanStack Router | **Show day** navigates to `/day/:date`; the day page already knows the shown date |

No new ADR is expected. Adding a date-picker library or a form library would need its own ADR first.

### Other decisions (not ADR-worthy)

* **Same shape as the task form:** a button beside **Add task** that reveals a form, with a mutation that calls the generated client, a `role="status"` confirmation, and focus returning to the button. The files sit in `features/events/` next to `features/tasks/`. The form uses controlled React state and no form library.
* **Daylight-saving handling is shared, not copied:** the form uses the local-time resolver from 0003 (`deadlineInstants`), which rejects skipped times and returns both instants of a repeated one. It is no longer task-specific, so it moves from `features/tasks/deadline.ts` to `features/agenda/` and keeps its tests. It resolves in the runtime's zone, which is the same as the router context's zone in the app; tests set `TZ`.
* **All-day end dates:** the form shows the last day inclusively (29–31 October) and sends the exclusive `endDate` (1 November), as in [0001](0001-today-view.md).
* **Client checks mirror the server:** required title, end after start, length limits (200 for title and location, 4000 for notes). These give fast feedback; the server is still the authority. Server field errors are mapped to inputs: `title`, `start`/`startDate`, `end`/`endDate`, `location`, `notes`. Other keys (`timeZone`, `request`) appear in a form-level message. The task form shows a single message; the event form has more cross-field rules, so it shows them next to the field.
* **No optimistic insert:** the event appears once the server confirms it. Placing it correctly on the client would mean copying the server's inclusion and ordering rules ([0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md)). After a save, everything under the `['agenda']` key is invalidated (`AGENDA_KEY`), so the day and week views refresh together.
* **Prefill for reuse:** `AddEvent` and the form accept optional initial values, so [XXXX](XXXX-create-events-and-tasks-from-week-view.md) can open the same form from a slot, the all-day band or a day column, without a second form.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things will live

| Area | Location |
| --- | --- |
| Pure logic | `frontend/apps/web/src/features/events/eventForm.ts`: defaults, linked fields, validation, request body, server error mapping |
| Daylight-saving resolver | Moved from `features/tasks/deadline.ts` to `features/agenda/` (shared with the task form) |
| Mutation | `features/events/useCreateEvent.ts`: `POST /api/events`, then invalidates `AGENDA_KEY` |
| Form and button | `features/events/EventForm.tsx` and `AddEvent.tsx` (the button, confirmation and **Show day**) |
| Entry point | `features/day/DayPage.tsx`, next to `AddTask`, with `date` as the initial date |

### API

No changes. Uses the existing `POST /api/events` ([0001](0001-today-view.md#api)).

### Testing

* **Pure tests (Vitest):**
  * `eventForm`: next-half-hour rounding, including 23:45 → next day; the end follows the start; editing the end changes the duration; all-day inclusive → exclusive; validation messages; server error mapping.
  * The moved resolver keeps its existing tests (spring gap, fall overlap in `America/New_York`). Add a half-hour-offset zone (`Asia/Kolkata`) and a 30-minute change (`Australia/Lord_Howe`).
* **Component tests (Testing Library and MSW):**
  * A timed event is saved with the right body; the form closes; the confirmation appears; the agenda shows the event.
  * A one-day and a three-day all-day event (posted `endDate` is the day after the last day).
  * An event for another day shows **Show day**, which moves to that day.
  * A repeated local time asks for the occurrence; a skipped time is rejected.
  * A 400 with `errors.end` puts the message by the end field and keeps the input.
  * A network error keeps the form open, and resubmitting works.
  * Focus moves to the title on open and returns to **Add event** on close.
* **API:** none expected. The existing endpoint tests cover creation. A test that a midnight-spanning timed event appears on both days' agendas should exist already; if not, add it.

### Delivery plan

Two PRs:

1. The pure logic, the moved resolver and `useCreateEvent`, with unit tests and no UI.
2. `EventForm`, `AddEvent`, the entry point in `DayPage` and the component tests.

### Open questions

1. **Inline form or dialog?** The planned design opens the form as a modal `<dialog>`, which traps focus and closes on Escape. **Add task** reveals an inline form instead. Should the two match? If so, either change the event form to inline, or move both to a dialog in a follow-up.
2. **After a save for another day:** should the view move to that day automatically, rather than offering **Show day**?
3. **Discarding:** should closing an edited form ask "Discard this event?" first, or is that unnecessary for a short form?

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Adding an event

1. Open the day you want, then select **Add event**.
2. Enter a title. The start and end default to the next half hour and one hour later on today; on other days, they start at 09:00.
3. For an all-day event, select **All day** and pick the first and last days. Both days are included.
4. Add a location or notes if you like, then select **Save event**.

The event appears on its day straight away. If it is on another day, a message says so, and **Show day** takes you there. If something is missing or invalid, such as an end before the start, the form tells you next to the field and keeps what you typed.

Times are in the time zone your browser is using, which is shown in the form. If clocks change and a time doesn't exist, choose another time. If a time happens twice, the form asks which one you mean.
