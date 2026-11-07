---
status: implemented
date: 2026-11-07
issue: https://github.com/mgasca/calendar/issues/466
pr:
  - https://github.com/mgasca/calendar/pull/472
  - https://github.com/mgasca/calendar/pull/488
  - https://github.com/mgasca/calendar/pull/491
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

1. **Given** a timed event "Dentist" today 15:00–16:00 on the Today view, **when** I select its title, change the start to 16:00 and save, **then** the dialog closes, "Dentist saved." is announced, and the Schedule lists Dentist at 16:00–17:00. [Open, edit and save with the version](../../frontend/apps/web/src/features/events/EditEvent.test.tsx) (`opens the event from its title, prefilled, and saves a new time with its version`); [API update and agenda](../../backend/tests/Calendar.Api.Tests/Endpoints/EventEndpointsTests.cs) (`UpdateTimedEvent_ReplacesEveryField_AndReturnsANewVersion`). The new time in the Schedule was checked in the running app; the web test asserts the request and the status message.
2. **Given** an all-day event, **when** I open it, **then** the dialog shows **All day** checked with its first and last day (inclusive), and saving a later last day lists it on the added days. [All-day prefill and save](../../frontend/apps/web/src/features/events/EditEvent.test.tsx) (`opens an all-day event with All day checked and its last day, and saves a later one`); [inclusive last day](../../frontend/apps/web/src/features/events/EditEvent.test.tsx) (`shows an all-day event with its inclusive last day`); [API kind switch](../../backend/tests/Calendar.Api.Tests/Endpoints/EventEndpointsTests.cs) (`UpdateEvent_CanSwitchATimedEventToAllDay`).
3. **Given** the edit dialog is open, **when** I clear the title or set the end before the start and save, **then** nothing is sent and the field says what to fix, as in **Add event**. [Blank title](../../frontend/apps/web/src/features/events/EditEvent.test.tsx) (`validates like Add event and sends nothing`); end before start uses the same `validate` as **Add event**, covered by its tests; [API 400](../../backend/tests/Calendar.Api.Tests/Endpoints/EventEndpointsTests.cs) (`UpdateEvent_Invalid_Returns400WithTheField_AndLeavesTheEventUnchanged`).
4. **Given** the edit dialog is open, **when** I select **Delete event** and then **Delete**, **then** the dialog closes, "Dentist deleted." is announced, and the event is no longer listed on the day. [Delete](../../frontend/apps/web/src/features/events/EditEvent.test.tsx) (`asks first, deletes on Delete, and moves focus to the day heading`); [API delete](../../backend/tests/Calendar.Api.Tests/Endpoints/EventEndpointsTests.cs) (`DeleteEvent_RemovesIt_FromTheResourceAndTheAgenda`).
5. **Given** the delete confirmation is showing, **when** I select **Keep event**, **then** nothing is deleted and the edit form is shown again with what I typed. [Keep event](../../frontend/apps/web/src/features/events/EditEvent.test.tsx) (`goes back to the form with what was typed on Keep event`).
6. **Given** I confirm a delete, **when** the server fails, **then** the dialog stays open, reports that the event couldn't be deleted, and the event is still listed. [Failed delete](../../frontend/apps/web/src/features/events/EditEvent.test.tsx) (`keeps the dialog open and the event listed when the delete fails`).
7. **Given** I opened an event and it was then changed elsewhere, **when** I save, **then** the dialog stays open, says the event was changed elsewhere, and shows the latest values; saving again succeeds. [Conflict reload](../../frontend/apps/web/src/features/events/EditEvent.test.tsx) (`reloads the latest version when the event was changed elsewhere, then saves`); also checked in the running app with a second `PUT` from the page.
8. **Given** I opened an event and it was then deleted elsewhere, **when** I save or delete, **then** the dialog says the event no longer exists, and the day no longer lists it. [Save](../../frontend/apps/web/src/features/events/EditEvent.test.tsx) (`says so when the event was deleted elsewhere, and the day drops it`); [delete](../../frontend/apps/web/src/features/events/EditEvent.test.tsx) (`says so when the event was already deleted elsewhere, and the day drops it`); [opening](../../frontend/apps/web/src/features/events/EditEvent.test.tsx) (`says when the event can no longer be opened`).
9. **Given** a save is failing with a network or server error (not 400, 404 or 409), **when** it fails, **then** the dialog stays open with my values and a message, and saving again succeeds. [Server error and retry](../../frontend/apps/web/src/features/events/EditEvent.test.tsx) (`keeps the values after a server error and saves on retry`).
10. **Given** the Today view, **when** I use the keyboard alone, **then** each event title is a button I can reach with Tab and open with Enter or Space, focus moves into the dialog when it opens, and returns to the title after a save or **Cancel**. [Keyboard](../../frontend/apps/web/src/features/events/EditEvent.test.tsx) (`opens from the keyboard`); [focus after save](../../frontend/apps/web/src/features/events/EditEvent.test.tsx) (`opens the event from its title, prefilled, and saves a new time with its version`); [after Cancel](../../frontend/apps/web/src/features/events/EditEvent.test.tsx) (`cancels without saving and returns focus to the title`). The focus trap is the browser's and isn't tested (jsdom has no modal dialogs).
11. **Given** two users, **when** one requests, updates or deletes the other's event by id, **then** the API answers 404 and the event is unchanged (API tests). [Read](../../backend/tests/Calendar.Api.Tests/Endpoints/OwnershipTests.cs) (`AnotherUsersEvent_IsNotFound_AndTheOwnersIsFound`); [update and delete](../../backend/tests/Calendar.Api.Tests/Endpoints/OwnershipTests.cs) (`AnotherUsersEvent_IsNotFoundForUpdateAndDelete_AndStaysUnchanged`).
12. **Given** an update that sends a stale version, **when** the API handles it, **then** it answers 409 and the stored event is unchanged (API tests). [Stale version](../../backend/tests/Calendar.Api.Tests/Endpoints/EventEndpointsTests.cs) (`UpdateEvent_WithAStaleVersion_Returns409_AndLeavesTheEventUnchanged`), which fails without the version check (negative control in PR #488).
13. **Given** the dialog in the Light and Dark themes at desktop and phone widths, **when** I open, edit and delete an event, **then** the controls are legible and usable in both (checked in the running app, with screenshots in the UI PR). Checked by hand in the running app; screenshots in [PR #491](https://github.com/mgasca/calendar/pull/491).
14. **Given** the change is complete, **when** I run `just check`, **then** it passes, including the regenerated contract. `just check` on the delivering revision of PR #491, and CI on each PR.

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

Delivered in two PRs after the card ([#472](https://github.com/mgasca/calendar/pull/472)): the API with the regenerated contract ([#488](https://github.com/mgasca/calendar/pull/488)), then the Today view and this card's completion ([#491](https://github.com/mgasca/calendar/pull/491)). No migration: `xmin` was already the concurrency token.

### Where things live

| Area | Location |
| --- | --- |
| Endpoints | `backend/src/Calendar.Api/Endpoints/EventEndpoints.cs`: `UpdateAsync`, `DeleteAsync`, `CheckShape` (the per-kind field rules shared with create) |
| Contracts | `backend/src/Calendar.Api/Contracts/EventContracts.cs`: `UpdateEventRequest`, `EventResponse.Version`, the internal `IEventFields` both requests implement |
| Version token | `backend/src/Calendar.Infrastructure/RowVersion.cs`: `VersionOf` and `ExpectVersion`; the entity configurations use its property name, so API code never names `xmin` (ADR-0014) |
| Domain | `backend/src/Calendar.Domain/Events/CalendarEvent.cs`: `Update` and `UpdateAllDay` build a validated copy with the factory rules, then take its fields, so an invalid update changes nothing |
| Contract and client | `contracts/openapi.json`, `frontend/packages/api-client/src/schema.gen.ts` (by `just contracts`) |
| Dialog | `frontend/apps/web/src/features/events/EditEvent.tsx` (loads the event, loading and not-found states), `EventForm.tsx` (edit mode, delete step, conflict reload), `eventForm.ts` (`fromEvent`), `useEditEvent.ts` (`eventQuery`, `useUpdateEvent`, `useDeleteEvent`) |
| Rows | `frontend/apps/web/src/features/day/DayView.tsx`: `EventTitle`, the status line and `focusAfterEdit` |
| Styles | `frontend/apps/web/src/styles/components.css`, the block "Editing from the day view" (`.item-open`, `.delete-confirmation`) |

### API

* `GET /api/events/{id}`: the response gains `version` (also on `POST` and `PUT`). The event is now loaded tracked, so the shadow token can be read.
* `PUT /api/events/{id}` (`UpdateEvent`): body as `POST /api/events` plus the required `version`. 200 with the updated event and its new version; 400 with field errors (same keys as create; a missing `version` is a binding 400); 404 when the event does not exist or belongs to another user; 409 when `version` is stale, with nothing written. After a failed concurrency check the endpoint answers 404 if the event is gone, else 409.
* `DELETE /api/events/{id}` (`DeleteEvent`): 204; 404 when it does not exist or belongs to another user; 409 only when another write lands between the request's read and its delete.
* `version` is a uint32 in the contract; the generated TypeScript type is `number | string` (the API reads numbers from strings too). The client treats it as opaque and sends back what it got.

### Testing

* Domain: `Update_ReplacesTheFields_AndKeepsIdAndOwner`, `UpdateAllDay_TurnsATimedEventIntoAnAllDayOne_AndBack`, `Update_WithInvalidValues_Throws_AndChangesNothing` in [CalendarEventTests](../../backend/tests/Calendar.Domain.Tests/Events/CalendarEventTests.cs).
* API with Testcontainers: [EventEndpointsTests](../../backend/tests/Calendar.Api.Tests/Endpoints/EventEndpointsTests.cs) (update, kind switch, stale version, invalid, missing version, unknown, delete) and [OwnershipTests](../../backend/tests/Calendar.Api.Tests/Endpoints/OwnershipTests.cs).
* Vitest with MSW: [EditEvent.test.tsx](../../frontend/apps/web/src/features/events/EditEvent.test.tsx) runs the routed app against a small in-memory event store with the API's version check, so save, conflict, not found and delete go through the real queries and invalidations.
* The running app (throwaway stack, both themes, 1280×900 and 390×844): open, edit timed and all-day, delete with **Keep event** and **Delete**, and a changed-elsewhere conflict made by a second `PUT` from the page.

### Lessons learned, known issues and follow-ups

* **Don't refetch what you just deleted.** Invalidating the open dialog's event query after a delete refetched it while the dialog was still mounted, and the running app logged a 404. The event and notes queries are now only marked stale (`refetchType: 'none'`); the agenda is refetched. The browser run caught it; the MSW tests did not, because an extra 404 doesn't fail them.
* **Wording in PR bodies.** The backend PR's body said, in prose with the closing keyword, that the UI PR would complete the issue, and the squash merge closed #466 early; it was reopened. PR bodies that must not close an issue use `Refs #N` and avoid the closing keywords anywhere in the text.
* **Focus after a delete** goes to the day heading, which gets `tabindex="-1"` when it is first needed, so the header markup stays as it was.
* **Status message:** the plain `role="status"` line of **Add event**, because the fading notification (#463) had not merged. It can switch to that component once it lands.
* **Follow-up:** editing and deleting from the Week view is [#492](https://github.com/mgasca/calendar/issues/492).

## User guide

### Changing an event

1. On the day page, select the event's title (it is underlined with dots), under **All day** or **Schedule**. The **Edit event** form opens with the event's details.
2. Change what you need, then select **Save event**. The form closes, a message says the event was saved, and the day shows the change.

Times are in your browser's time zone, as when adding an event. If the event was changed somewhere else since you opened it, the form tells you and shows the latest version: check it, make your change again and save.

### Deleting an event

1. Open the event as above and select **Delete event**.
2. Select **Delete** to confirm, or **Keep event** to go back to the form.

The form closes and a message says the event was deleted. A deleted event can't be restored. If the event was already deleted somewhere else, the form says it no longer exists.

Events can be changed only from the day page for now, not from the week.
