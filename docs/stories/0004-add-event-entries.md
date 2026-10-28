---
status: implemented
date: 2026-10-27
pr: https://github.com/mgasca/calendar/pull/35
adrs: [0018, 0019, 0020, 0021, 0026]
---

# 0004 Add event entries so I know when my appointments are

## Story

> As a calendar editor I need to be able to add event entries so that I know when my appointments are.

## Background

The API can already create events. `POST /api/events` validates timed and all-day events, stores them with an overlap index, and is in the generated client ([0001](0001-today-view.md#api)). The web app has no way to use it: the day view can show events, and since [0003](0003-add-todo-tasks.md) it can add tasks, but the only way to add an event is `make db-seed` or a direct API call.

This story adds the event form to the day view, beside **Add task**, so an editor can add an appointment and see it on the right day. It is the event counterpart of 0003, and it follows the same patterns where it can.

### Scope

* **Entry point:** an **Add event** button next to **Add task** on the day page (`features/day/DayPage.tsx`) opens the event form in a modal dialog. This differs from **Add task**, which is inline, on purpose: see [Follow-ups](#follow-ups).
* **Closing:** **Cancel** and Escape close the dialog without a confirmation, even if something was typed. Nothing is saved. While a save is in progress, the dialog can't be closed.
* **Event kinds:** timed or all-day. All-day events can span several days.
* **Fields:** title (required), start and end (date and time for timed events, dates for all-day), location and notes.
* **Defaults:** the form starts on the day being viewed (not necessarily today). For a timed event, the start is the next half hour on today, or 09:00 on any other day. The end is one hour after the start. Changing the start moves the end and keeps the duration; changing the end changes the duration.
* **Time zone:** the browser's IANA zone, shown in the form but not editable, as in the task form. Times are entered in that zone.
* **Daylight-saving times:** same rules as the task form ([0003](0003-add-todo-tasks.md)). A local time that doesn't exist is rejected, and a time that occurs twice asks which occurrence is meant.
* **Overlaps:** events may overlap. The form does not warn or block.
* **After saving:** the dialog closes, the new event appears in the agenda queries it touches, and a confirmation says which day it was added to. If that day is not the one being viewed, the view stays where it is and the confirmation offers **Show day**.
* **Day navigation:** already in place and not part of this story. The day page has a date picker and the `/day/:date` routes from [0002](0002-week-view.md) ([ADR-0026](../decisions/0026-client-side-routing-with-tanstack-router.md)); `/` follows the clock.
* **Reuse by the week view:** the form takes initial values (date, start and end times, all-day), so the week view can open it prefilled. The week's entry points are in [XXXX](XXXX-create-events-and-tasks-from-week-view.md), which depends on this story.

### Not in this story

* Adding tasks. That is [0003](0003-add-todo-tasks.md), already implemented.
* Creating from the week view. That is [XXXX](XXXX-create-events-and-tasks-from-week-view.md).
* Editing and deleting events. These need `PUT`/`PATCH`/`DELETE` endpoints and use the `xmin` concurrency token already on the table.
* Overlap warnings. The overlap query and index are ready, so this can follow.
* A "Discard this event?" prompt when closing an edited form. Not needed for now.
* Making **Add task** and **Add event** consistent. That waits for usability testing: see [Follow-ups](#follow-ups).
* Moving to the new event's day automatically. The view stays put and offers **Show day**.
* A time zone picker for events in other zones, and showing an event's original zone.
* Recurrence, reminders and invitations.
* Natural-language input ("dentist tomorrow 3pm").

### Acceptance criteria

1. **Given** the day view is open, **when** I choose **Add event**, enter "Dentist" for 29 October 15:00–16:00 and save, **then** the form closes, a message says "Dentist added for Thu 29 Oct", and the event is listed on 29 October. [Timed creation and agenda refresh](../../frontend/apps/web/src/App.test.tsx) (`saves a timed event, refreshes the agenda, and returns keyboard focus`); [Show day](../../frontend/apps/web/src/App.test.tsx) (`keeps the current day after saving elsewhere and Show day navigates`).
2. **Given** the event form is open, **when** I save an all-day event from 29 to 31 October (inclusive end in the form), **then** it is listed under *All day* on each of those three days and not on 1 November. [Three-day all-day event](../../frontend/apps/web/src/App.test.tsx) (`saves a three day all-day event with an exclusive end and displays it on each day`); [API inclusion](../../backend/tests/Calendar.Api.Tests/Endpoints/AgendaEndpointsTests.cs) (`AllDayEvents_MultiDay_CoverStartThroughTheDayBeforeTheExclusiveEnd`).
3. **Given** the event form is open, **when** I save a timed event from 23:30 to 00:30 the next day, **then** it appears on both days, marked as continuing. [Overnight display](../../frontend/apps/web/src/App.test.tsx) (`shows a midnight event as continuing on both days and permits overlapping events`); [API continuation flags](../../backend/tests/Calendar.Api.Tests/Endpoints/AgendaEndpointsTests.cs) (`Events_OvernightSpan_AppearsOnBothDaysWithContinuationFlags`).
4. **Given** the event form is open, **when** I submit it with an empty title or an end before the start, **then** the form does not submit and says what to fix next to the field. [Field validation](../../frontend/apps/web/src/features/events/EventForm.test.tsx) (`shows field errors for a blank title and an end before the start`).
5. **Given** the event form is open, **when** I enter a start or end that doesn't exist because clocks change, **then** the form rejects it. [Skipped times](../../frontend/apps/web/src/features/events/EventForm.test.tsx) (`rejects skipped start and end local times`).
6. **Given** the event form is open, **when** I enter a start or end that occurs twice because clocks change, **then** the form asks which occurrence is meant before it saves. [Repeated times](../../frontend/apps/web/src/features/events/EventForm.test.tsx) (`requires explicit choices for repeated start and end times`).
7. **Given** the event form is filled in, **when** the server rejects the request (400), **then** the form stays open, the message appears next to the matching field, and what I typed is kept. [Server validation](../../frontend/apps/web/src/features/events/EventForm.test.tsx) (`retains values after a field error and permits retry`).
8. **Given** the event form is filled in, **when** saving fails with a network or server error (other than 400), **then** the form stays open with a message and can be submitted again, and nothing is shown as saved until the server confirms it. [Network retry](../../frontend/apps/web/src/features/events/EventForm.test.tsx) (`retains values after a network error and saves on retry`).
9. **Given** an event is being saved, **when** the request is in progress, **then** the form is disabled so it can't be submitted twice, and the dialog can't be closed. [Pending save](../../frontend/apps/web/src/features/events/EventForm.test.tsx) (`disables all controls while a save is pending`) [Escape while saving](../../frontend/apps/web/src/features/events/EventForm.test.tsx) (`ignores Escape while a save is pending`).
10. **Given** the dialog is open and I have typed values, **when** I select **Cancel** or press Escape, **then** the dialog closes without asking for confirmation, nothing is saved, and focus returns to **Add event**. [Escape](../../frontend/apps/web/src/features/events/EventForm.test.tsx) (`closes on Escape without a prompt and saves nothing`); [Cancel](../../frontend/apps/web/src/features/events/EventForm.test.tsx) (`closes from Cancel without a prompt, even after typing`); [focus returns to Add event](../../frontend/apps/web/src/App.test.tsx) (`returns focus to Add event when the dialog is cancelled, and saves nothing`).
11. **Given** the day view shows one day, **when** I save an event for a different day and the save succeeds, **then** the view stays on the day it showed, the confirmation names the event's day and offers **Show day**, and selecting **Show day** opens that day. [Show day](../../frontend/apps/web/src/App.test.tsx) (`keeps the current day after saving elsewhere and Show day navigates`).
12. **Given** an event exists at a time, **when** I save another event at the same time, **then** both are saved and both are shown. [Overlapping events](../../frontend/apps/web/src/App.test.tsx) (`shows a midnight event as continuing on both days and permits overlapping events`).
13. **Given** the day view is open, **when** I use the dialog with the keyboard alone, **then** all controls are labelled and operable, focus moves to the title when the dialog opens and stays inside it while it is open, and focus returns to **Add event** when it closes. [Keyboard and focus](../../frontend/apps/web/src/App.test.tsx) (`saves a timed event, refreshes the agenda, and returns keyboard focus`) [Modal dialog](../../frontend/apps/web/src/features/events/EventForm.test.tsx) (`opens as a modal dialog named by its heading, with focus on the title`); the focus trap itself is the browser's and isn't tested, because jsdom has no modal dialogs.
14. **Given** the browser has a time zone, **when** the form and the agenda show times, **then** they use that time zone. [Form zone](../../frontend/apps/web/src/features/events/EventForm.test.tsx) (`shows the browser time zone and sends it with the instant`); [time resolver](../../frontend/apps/web/src/features/agenda/deadline.test.ts) (`resolves a half-hour offset in Kolkata`); [agenda time formatting](../../frontend/apps/web/src/features/day/DayView.test.tsx).

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

* **A modal dialog, unlike the task form:** the form is a native `<dialog>` opened with `showModal()`, which gives focus trapping, Escape and an inert background without a dependency. **Add task** reveals an inline form instead. The difference is deliberate: the product owner will run usability testing on inline versus dialog once this is in, and then consolidate both forms on the preferred one ([Follow-ups](#follow-ups)). To keep that switch cheap, the dialog holds only the form and its chrome, and everything else matches the task form: a button beside **Add task**, a mutation that calls the generated client, a `role="status"` confirmation and focus returning to the button. The files sit in `features/events/` next to `features/tasks/`. The form uses controlled React state and no form library.
* **Closing without a prompt:** **Cancel** and Escape close the dialog and drop what was typed, with no "Discard?" confirmation. While a save is in progress, Cancel and Escape do nothing, so a pending save can't be hidden or its error missed.
* **Stay put after saving:** saving for another day does not move the view. The confirmation names the day and offers **Show day**, which navigates to `/day/:date`.
* **Daylight-saving handling is shared, not copied:** the form uses the local-time resolver from 0003 (`deadlineInstants`), which rejects skipped times and returns both instants of a repeated one. It is no longer task-specific, so it moves from `features/tasks/deadline.ts` to `features/agenda/` and keeps its tests. It resolves in the runtime's zone, which is the same as the router context's zone in the app; tests set `TZ`.
* **All-day end dates:** the form shows the last day inclusively (29–31 October) and sends the exclusive `endDate` (1 November), as in [0001](0001-today-view.md).
* **Client checks mirror the server:** required title, end after start, length limits (200 for title and location, 4000 for notes). These give fast feedback; the server is still the authority. Server field errors are mapped to inputs: `title`, `start`/`startDate`, `end`/`endDate`, `location`, `notes`. Other keys (`timeZone`, `request`) appear in a form-level message. The task form shows a single message; the event form has more cross-field rules, so it shows them next to the field.
* **No optimistic insert:** the event appears once the server confirms it. Placing it correctly on the client would mean copying the server's inclusion and ordering rules ([0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md)). After a save, everything under the `['agenda']` key is invalidated (`AGENDA_KEY`), so the day and week views refresh together.
* **Prefill for reuse:** `AddEvent` and the form accept optional initial values, so [XXXX](XXXX-create-events-and-tasks-from-week-view.md) can open the same form from a slot, the all-day band or a day column, without a second form.

## Implementation notes

The event form uses the existing event endpoint and shared agenda queries. It was first delivered inline, matching **Add task** (#35), and is now a modal dialog (#NNN).

### Where things live

| Area | Location |
| --- | --- |
| Pure logic | `frontend/apps/web/src/features/events/eventForm.ts`: defaults, linked fields, validation, request body, server error mapping |
| Daylight-saving resolver | Moved from `features/tasks/deadline.ts` to `features/agenda/` (shared with the task form) |
| Mutation | `features/events/useCreateEvent.ts`: `POST /api/events`, then invalidates `AGENDA_KEY` |
| Form and button | `features/events/EventForm.tsx` (the form, shown in a modal `<dialog>`) and `AddEvent.tsx` (the button, the dialog, the confirmation and **Show day**) |
| Entry point | `features/day/DayPage.tsx`, next to `AddTask`, with `date` as the initial date |

### API

No changes. Uses the existing `POST /api/events` ([0001](0001-today-view.md#api)).

### Testing

Vitest covers form logic, DST resolution, validation, retry, pending state, focus and routed agenda display. Existing API tests cover all-day and overnight agenda inclusion. See the links beside each acceptance criterion for the specific cases. jsdom doesn't implement `showModal()` or `close()`, so `test/setup.ts` stubs them to open and close the dialog. The browser's focus trap and inert background aren't covered by tests. The dialog adds tests that:

* Focus moves to the title, stays inside the dialog, and returns to **Add event** on close.
* **Cancel** and Escape close the dialog without a prompt, even after typing, and nothing is saved.
* While a save is in progress, Cancel and Escape don't close the dialog.

### Delivery plan

1. **Done (#35):** the pure logic, the shared resolver, `useCreateEvent`, and the form and its entry point, delivered inline.
2. **Done (#NNN):** the form is shown in a modal `<dialog>` that opens with `showModal()` and closes on Cancel and Escape except while saving, with the dialog tests above. The **Add event** button stays visible behind the dialog.

### Follow-ups

* **Inline or dialog, then consolidate:** **Add event** is a dialog and **Add task** is inline. Once the event dialog is in, the product owner will run usability testing to see which the editors prefer, and then make both forms use it. That is a separate story. Until then the two are intentionally different.
* **Discard prompt:** none for now. Revisit if testing shows people losing typed text by closing the dialog.

## User guide

### Adding an event

1. Open the day you want, then select **Add event**. A form opens over the page.
2. Enter a title. The start and end default to the next half hour and one hour later on today; on other days, they start at 09:00.
3. For an all-day event, select **All day** and pick the first and last days. Both days are included.
4. Add a location or notes if you like, then select **Save event**.

The form closes and the event appears on its day straight away. If it is on another day, you stay where you are, a message says which day it was added to, and **Show day** takes you there. If something is missing or invalid, such as an end before the start, the form tells you next to the field and keeps what you typed.

Times are in the time zone your browser is using, which is shown in the form. If clocks change and a time doesn't exist, choose another time. If a time happens twice, the form asks which one you mean.

To leave without saving, select **Cancel** or press Escape. What you typed is discarded without asking. You can't close the form while it is saving.
