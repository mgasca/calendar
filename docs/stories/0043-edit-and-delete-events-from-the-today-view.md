---
status: planned
date: 2026-11-07
issue: https://github.com/mgasca/calendar/issues/466
pr:
  - https://github.com/mgasca/calendar/pull/472
adrs: ["0014", "0015", "0018", "0020", "0021", "0041", "0043", "0047"]
---

# 0043 Edit and delete events from the Today view

## Story

> As a calendar editor, I need to open an event from the Today view to change or delete it, so that I can fix a mistake or a cancelled appointment without going through the API.

Tracked in issue #466, part of the Today view epic #458.

## Background

Events can be created from the day page since [0004](0004-add-event-entries.md), but they cannot be changed or removed anywhere in the app. The API has only `POST /api/events` and `GET /api/events/{id}`. Story 0004 deferred editing and deleting ("Not in this story"), noting that it needs update and delete endpoints and the `xmin` concurrency token that is already on the `events` table ([ADR-0015](../decisions/0015-ef-core-data-access.md)). On the Today view, event rows in **All day** and **Schedule** are not interactive: a typo in a title, a moved appointment or a cancelled one stays until someone edits the database.

Every event belongs to one user ([0017](0017-per-user-calendar-ownership.md), [ADR-0041](../decisions/0041-per-user-data-ownership.md)), so the new endpoints are owner-scoped like the existing ones. This story is the event counterpart of task editing ([#467](https://github.com/mgasca/calendar/issues/467)), which follows it because both regenerate the API contract.

### Agreed scope

* **Opening an event:** on the day page (`/` and `/day/:date`), the title of every event in **All day** and **Schedule** is a button. Selecting it, with the mouse or the keyboard, opens the event in the existing event dialog, titled **Edit event**, prefilled with the stored title, kind (timed or all-day), start, end, location and notes. The dialog loads the event first and says so while it loads; if the event no longer exists, it says that and the day refreshes.
* **Editing:** every field that **Add event** offers can be changed, including switching between timed and all-day. Validation, daylight-saving handling (skipped times rejected, repeated times asking which occurrence) and the field messages are the same as when adding ([0004](0004-add-event-entries.md), [ADR-0043](../decisions/0043-form-validation-red-borders-and-bubble.md)). **Save event** saves the change; **Cancel** and Escape close without saving and without a prompt, except while a request is in progress.
* **Time zone:** as when adding, times are shown and entered in the browser's time zone, which the dialog shows. A timed event created in another zone is shown converted to the browser's zone, and saving stores the browser's zone with it.
* **Deleting:** the edit dialog has a **Delete event** action. It asks for confirmation inside the same dialog ("Delete Dentist? This can't be undone.", with **Delete** and **Keep event**); only **Delete** removes the event. Nothing else deletes an event.
* **After saving or deleting:** the dialog closes, every agenda query refreshes (day and week), and a status message says "Dentist saved." or "Dentist deleted." Keyboard focus returns to the event's title button after a save, or to the day heading after a delete, because the row is gone.
* **Changed elsewhere:** the dialog saves against the version it loaded. If the event was changed in the meantime (another tab or device), the save is refused, the dialog says "This event was changed elsewhere. The latest version is shown; check it and save again.", and the form reloads with the latest values. If it was deleted in the meantime, the dialog says so and the day refreshes.
* **Failures:** a network or server error keeps the dialog open with what was typed and a message, and the action can be retried. A failed delete keeps the dialog open and reports the failure; nothing is shown as saved or deleted until the server confirms it.
* **Ownership:** another user's event cannot be read, changed or deleted; the API answers as if it did not exist ([ADR-0041](../decisions/0041-per-user-data-ownership.md)).

### Not in this story

* Editing or deleting from the week view. The endpoints and dialog are reusable; the week's entry points are a follow-up issue, like [XXXX](XXXX-create-events-and-tasks-from-week-view.md) is for creating.
* Editing tasks. That is #467, card 0044 (planned).
* Undo after deleting, and a recycle bin.
* A "Discard changes?" prompt on closing an edited dialog, as for **Add event** ([0004](0004-add-event-entries.md)).
* Merging the user's edits with the changes made elsewhere. On a conflict the latest version replaces the form, and the user re-applies their change.
* Keeping a timed event's original zone when it is edited in a browser in another zone, or a zone picker ([0004](0004-add-event-entries.md) leaves both out).
* Recurrence, reminders and invitations.
* The fading save notification of #463. If it has merged when this story's UI lands, the status messages use it; otherwise they use the same plain status message as **Add event**.

### Dependencies

* Builds on [0004](0004-add-event-entries.md) (the event form and dialog) and [0017](0017-per-user-calendar-ownership.md) (owner scoping).
* Task editing ([#467](https://github.com/mgasca/calendar/issues/467)) follows this story, because both regenerate `contracts/openapi.json` and the TypeScript client.

### Acceptance criteria

1. **Given** a timed event "Dentist" today 15:00–16:00 on the Today view, **when** I select its title, change the start to 16:00 and save, **then** the dialog closes, "Dentist saved." is announced, and the Schedule lists Dentist at 16:00–17:00.
2. **Given** an all-day event, **when** I open it, **then** the dialog shows **All day** checked with its first and last day (inclusive), and saving a later last day lists it on the added days.
3. **Given** the edit dialog is open, **when** I clear the title or set the end before the start and save, **then** nothing is sent and the field says what to fix, as in **Add event**.
4. **Given** the edit dialog is open, **when** I select **Delete event** and then **Delete**, **then** the dialog closes, "Dentist deleted." is announced, and the event is no longer listed on the day.
5. **Given** the delete confirmation is showing, **when** I select **Keep event**, **then** nothing is deleted and the edit form is shown again with what I typed.
6. **Given** I confirm a delete, **when** the server fails, **then** the dialog stays open, reports that the event couldn't be deleted, and the event is still listed.
7. **Given** I opened an event and it was then changed elsewhere, **when** I save, **then** the dialog stays open, says the event was changed elsewhere, and shows the latest values; saving again succeeds.
8. **Given** I opened an event and it was then deleted elsewhere, **when** I save or delete, **then** the dialog says the event no longer exists, and the day no longer lists it.
9. **Given** a save is failing with a network or server error (not 400, 404 or 409), **when** it fails, **then** the dialog stays open with my values and a message, and saving again succeeds.
10. **Given** the Today view, **when** I use the keyboard alone, **then** each event title is a button I can reach with Tab and open with Enter or Space, focus moves into the dialog when it opens, and returns to the title after a save or **Cancel**.
11. **Given** two users, **when** one requests, updates or deletes the other's event by id, **then** the API answers 404 and the event is unchanged (API tests).
12. **Given** an update that sends a stale version, **when** the API handles it, **then** it answers 409 and the stored event is unchanged (API tests).
13. **Given** the dialog in the Light and Dark themes at desktop and phone widths, **when** I open, edit and delete an event, **then** the controls are legible and usable in both (checked in the running app, with screenshots in the UI PR).
14. **Given** the change is complete, **when** I run `just check`, **then** it passes, including the regenerated contract.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0014](../decisions/0014-postgresql-database-engine.md) | PostgreSQL, with its specific features contained in Infrastructure | The `xmin` version is read and checked in `Calendar.Infrastructure`, never named in API code |
| [0015](../decisions/0015-ef-core-data-access.md) | EF Core code-first, `xmin` as the optimistic-concurrency token | Updates are checked against the version the client loaded; no migration is needed |
| [0018](../decisions/0018-time-representation-and-bcl-date-time-types.md) | UTC instants with an IANA zone, and floating dates | The update request has the same shape as the create request |
| [0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md) | Resource endpoints for writes, the agenda as a read model | Edits and deletes go to `/api/events/{id}`; the agenda is refetched afterwards |
| [0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md) | The client's local date and zone define the day | The dialog shows and sends times in the browser's zone |
| [0041](../decisions/0041-per-user-data-ownership.md) | Per-user ownership, not found rather than forbidden | Another user's event answers 404 on read, update and delete |
| [0043](../decisions/0043-form-validation-red-borders-and-bubble.md) | Red borders and a bubble for form validation | Edit mode reuses the event form's validation display |
| [0047](../decisions/0047-semantic-css-tokens-selected-by-a-data-theme-attribute.md) | Semantic tokens and a `data-theme` attribute | The title button and the delete confirmation use shared classes and tokens in both themes |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **A version in the event, sent back on update:** the event response carries an opaque `version`, and the update request must send it. Comparing it on save is what lets the API refuse a write based on a stale read (criterion 7); detecting only a race inside one request, as task complete and reopen do, would silently overwrite a change made after the dialog opened.
* **Full replacement, not a patch:** the update takes the whole event, with the same fields and rules as create. The dialog always has every field, and one validation path is simpler than per-field patches.
* **Delete without a version:** a delete removes the event whatever changed since it was opened, like task deletion. The user has just seen the event and confirmed; refusing a delete because a note changed elsewhere would be unhelpful.
* **The dialog loads the event:** the agenda carries only `hasNotes`, not the notes, and no version, so opening an event fetches it by id. This keeps the agenda read model unchanged.
* **Confirmation inside the dialog:** deleting replaces the form with a confirmation step in the same dialog, instead of opening a second modal on top of it. The task delete confirmation is worded for tasks and stacked dialogs are awkward for focus.
* **The title is the button:** the event title becomes a `<button>` styled as text, so the row layout and the status badges stay as they are and the row has one obvious target.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| Endpoints | `backend/src/Calendar.Api/Endpoints/EventEndpoints.cs` |
| Contracts | `backend/src/Calendar.Api/Contracts/EventContracts.cs` (`UpdateEventRequest`, `version` on `EventResponse`) |
| Version token | `backend/src/Calendar.Infrastructure` (reads and checks `xmin`) |
| Domain | `backend/src/Calendar.Domain/Events/CalendarEvent.cs` (an update method with the create rules) |
| Contract and client | `contracts/openapi.json`, `frontend/packages/api-client` (generated by `just contracts`) |
| Form | `frontend/apps/web/src/features/events/EventForm.tsx`, `eventForm.ts` (edit mode, delete step) |
| Rows | `frontend/apps/web/src/features/day/DayView.tsx` (title buttons in **All day** and **Schedule**) |

### API

Planned:

* `GET /api/events/{id}`: unchanged, but the response gains `version`.
* `PUT /api/events/{id}`: body as `POST /api/events` plus the required `version`. 200 with the updated event and its new version; 400 with field errors; 404 when the event does not exist or belongs to another user; 409 when `version` is stale.
* `DELETE /api/events/{id}`: 204; 404 when the event does not exist or belongs to another user.

### Testing

* Domain tests for the update rules (title, end after start, kinds, zone).
* API tests with Testcontainers: update and delete of timed and all-day events, validation, stale version (409, unchanged row), and another user's event (404 on read, update and delete, row unchanged) in `OwnershipTests`.
* Vitest with MSW: edit mode prefill (timed and all-day), save, validation, conflict reload, not found, delete confirm, keep and failure, keyboard focus.
* The running app in both themes at desktop and phone widths.

### Lessons learned, known issues and follow-ups

* To be filled in on delivery.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Changing an event

1. On the day page, select the event's title, under **All day** or **Schedule**. The **Edit event** form opens with the event's details.
2. Change what you need, then select **Save event**. The form closes and the day shows the change.

Times are in your browser's time zone, as when adding an event. If the event was changed somewhere else since you opened it, the form tells you and shows the latest version: check it, make your change again and save.

### Deleting an event

1. Open the event as above and select **Delete event**.
2. Select **Delete** to confirm, or **Keep event** to go back to the form.

A deleted event can't be restored.
