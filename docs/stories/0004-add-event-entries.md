---
status: planned
date: 2026-10-27
pr: https://github.com/mgasca/calendar/pull/20
adrs: [0018, 0019, 0020, 0021, 0025]
---

# 0004 Add event entries so I know when my appointments are

## Story

> As a calendar editor I need to be able to add event entries so that I know when my appointments are.

## Background

The API can already create events. `POST /api/events` validates timed and all-day events, stores them with an overlap index, and is in the generated client ([0001](0001-today-view.md#api)). The web app has no way to use it: the Today view is read-only, and the only way to add an event is `make db-seed` or a direct API call.

This story adds the event form to the web app, so an editor can add an appointment and see it on the right day.

### Scope

* **Entry point:** an **Add event** button in the day view header opens a dialog.
* **Event kinds:** timed or all-day. All-day events can span several days.
* **Fields:** title (required), start and end (date and time for timed events, dates for all-day), location and notes.
* **Defaults:** the form starts with the day being viewed (not necessarily today). For a timed event, the start is the next half hour on today, or 09:00 on any other day. The end is one hour after the start. Changing the start moves the end and keeps the duration; changing the end changes the duration.
* **Time zone:** the browser's IANA zone, shown in the form but not editable. Times are entered in that zone.
* **Overlaps:** events may overlap. The form does not warn or block.
* **Day navigation:** not built here. The day view moves between dates with the routes from [0002](https://github.com/mgasca/calendar/pull/19) (`/day/:date`). This story relies on that routing and does not add its own navigation.
* **After saving:** the new event appears in every cached agenda it touches, and a confirmation says which day it was added to. If that day is not the one being viewed, the confirmation offers **Show day**.

### Not in this story

* Editing and deleting events. These need `PUT`/`PATCH`/`DELETE` endpoints and use the `xmin` concurrency token already on the table.
* Tasks, and the week view. These are in [0003](0003-create-events-and-tasks.md).
* Overlap warnings. The overlap query and index are ready, so this can follow.
* A time zone picker for events in other zones, and showing an event's original zone.
* Recurrence, reminders and invitations.
* Natural-language input ("dentist tomorrow 3pm").

### Acceptance criteria

1. **Given** the day view, **when** I choose **Add event**, enter "Dentist" for 29 October 15:00–16:00 and save, **then** the dialog closes, a message says "Dentist added for Thu 29 Oct", and the event is listed on 29 October.
2. **Given** an all-day event from 29 to 31 October (inclusive end in the form), **then** it is listed under *All day* on each of those three days and not on 1 November.
3. **Given** a timed event from 23:30 to 00:30 the next day, **then** it appears on both days, marked as continuing.
4. **Given** an empty title, or an end before the start, **then** the form does not submit and says what to fix next to the field.
5. **Given** the server rejects the request (400), **then** the form stays open, the message appears next to the matching field, and what I typed is kept.
6. **Given** a network or server error (other than 400), **then** the form stays open with a message and can be submitted again. Nothing is shown as saved until the server confirms it.
7. **Given** two events at the same time, **then** both are saved and both are shown.
8. The dialog is accessible. It traps focus while open, closes with Escape, and returns focus to **Add event** when it closes.
9. Times in the form and the agenda use the browser's time zone.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0018](../decisions/0018-time-representation-and-bcl-date-time-types.md) | UTC instants with an IANA zone, and floating dates | Timed events are sent as instants with an explicit offset plus the zone; all-day events as dates with an exclusive end |
| [0019](../decisions/0019-single-user-mode-with-authentication-deferred.md) | Single user, no sign-in | The form has no owner or permissions |
| [0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md) | Resource endpoints for writes, the agenda as a read model | Saving uses `POST /api/events`; the agenda is refetched and the server decides which days an event appears on |
| [0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md) | The client's local date and zone define "today" | The form's default date and zone come from the browser |
| 0025 (in review, [#19](https://github.com/mgasca/calendar/pull/19)) | Client-side routing with TanStack Router | The day view's date comes from the `/day/:date` route, which this story's dialog is opened from |

No new ADR is expected. Adding a date-picker library or a form library would need its own ADR first.

### Other decisions (not ADR-worthy)

* **Native dialog:** the form is a `<dialog>` opened with `showModal()`. That gives focus trapping, Escape and an inert background without a dependency. The form uses controlled React state and no form library.
* **Wall-clock conversion in one place:** the form turns a local date and time into an instant with a helper that reads the zone's offset from `Intl`, rather than `new Date(y, m, d, h, min)`. This keeps the conversion correct when the zone differs from the browser's, as in tests. A time skipped by a daylight-saving change is a field error. A time that occurs twice uses the earlier occurrence, the usual calendar convention.
* **All-day end dates:** the form shows the last day inclusively (29–31 October) and sends the exclusive `endDate` (1 November), as in [0001](0001-today-view.md).
* **Client checks mirror the server:** required title, end after start, length limits (200 for title and location, 4000 for notes). These give fast feedback; the server is still the authority. Server field errors are mapped to inputs: `title`, `start`/`startDate`, `end`/`endDate`, `location`, `notes`. Other keys (`timeZone`, `request`) appear in the form-level message.
* **No optimistic insert:** the event appears once the server confirms it. Placing it correctly on the client would mean copying the server's inclusion and ordering rules ([0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md)). After a save, all agenda queries are invalidated, so the day and week views refresh together.
* **No overdue section on other days:** the Earlier/Now/Next badges and the overdue flag belong to today ([0001](0001-today-view.md)). The form itself does not depend on that.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things will live

| Area | Location |
| --- | --- |
| Pure logic | `frontend/apps/web/src/features/agenda/`: `zonedTime.ts` (local date and time → instant), `eventForm.ts` (defaults, linked fields, validation, request body, server error mapping) |
| Mutation | `features/agenda/useCreateEvent.ts`: `POST /api/events`, then invalidates the agenda queries |
| Form | `features/agenda/CreateEventDialog.tsx`: the event-only form. [0003](0003-create-events-and-tasks.md) extends it with tasks and the week view. |
| Entry point | An **Add event** button in the day header, `features/day/DayView.tsx` |

### API

No changes. Uses the existing `POST /api/events` ([0001](0001-today-view.md#api)).

### Testing

* **Pure tests (Vitest):**
  * `zonedTime`: normal conversions in `Europe/Madrid`, `America/New_York`, `Asia/Kolkata` (+05:30) and `Australia/Lord_Howe` (30-minute change); a skipped time returns `undefined`; a repeated time picks the earlier instant; dates near the 1900 and 2200 limits.
  * `eventForm`: next-half-hour rounding, including 23:45 → next day; the end follows the start; editing the end changes the duration; all-day inclusive → exclusive; validation messages; server error mapping.
* **Component tests (Testing Library and MSW):**
  * A timed event is saved with the right body; the dialog closes; the confirmation appears; the agenda shows the event.
  * A one-day and a three-day all-day event (posted `endDate` is the day after the last day).
  * An event for another day shows **Show day**, which moves to that day.
  * A 400 with `errors.end` puts the message under Ends and keeps the input.
  * A network error keeps the form open, and resubmitting works.
  * Focus is trapped while open, Escape closes the dialog, and focus returns to **Add event**.
* **API:** none expected. The existing endpoint tests cover creation. A test that a midnight-spanning timed event appears on both days' agendas should exist already; if not, add it.

### Delivery plan

Two PRs, after [#19](https://github.com/mgasca/calendar/pull/19) (routing) merges:

1. The pure logic and `useCreateEvent`, with unit tests and no UI.
2. `CreateEventDialog`, the **Add event** button and the component tests.

### Open questions

1. **Overlap with [0003](0003-create-events-and-tasks.md):** 0003 already covers creating events from the day view. Should this story be delivered as the event slice of 0003, or kept separate and then extended by 0003?
2. **After a save for another day:** should the view move to that day automatically, rather than offering **Show day**?
3. **Discarding:** should closing an edited form ask "Discard this event?" first, or is that unnecessary for a short form?

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Adding an event

1. Open the day you want, then select **Add event**.
2. Enter a title. The start and end default to the next half hour and one hour later on today; on other days, they start at 09:00.
3. For an all-day event, select **All day** and pick the first and last days. Both days are included.
4. Add a location or notes if you like, then select **Add event**.

The event appears on its day straight away. If it is on another day, a message says so, and **Show day** takes you there. If something is missing or invalid, such as an end before the start, the form tells you next to the field and keeps what you typed.

Times are in the time zone your browser is using, which is shown in the form.
