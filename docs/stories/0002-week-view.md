---
status: planned
date: 2026-10-27
pr: https://github.com/mgasca/calendar/pull/17
adrs: [0018, 0020, 0021, 0024, 0026]
---

# 0002 Week view: plan and track the whole week in one place

## Story

> As a forward planner, I need to be able to see a full week's view of events and tasks so I can better plan and track the things I need to do.

## Background

The [Today view](0001-today-view.md) answers "what's in my day". A forward planner also needs to look ahead and back:

* **Ahead:** what's coming this week and next, and where the free time is.
* **Back:** what was due earlier in the week and whether it got done.

That needs a view across seven days that shows fixed commitments (events) and work to do (tasks) together. It should be built on the same local-day rules as Today, so the two views never disagree.

The Today view can only show today. This story also makes any day viewable, so the week can link to its days. Creating events and tasks from the week is a separate story, [XXXX](XXXX-create-events-and-tasks-from-week-view.md), which builds on this one and on the stories that add creating from the day view.

### Scope agreed with the product owner

* **Which week:** the ISO week, Monday to Sunday, containing the chosen date, in the browser's time zone. The first day of the week is not configurable in this story.
* **Layout:** a **time grid**, with seven day columns on an hourly grid (the usual desktop calendar week).
  * All-day events sit in a band across the top, as one bar per event spanning its days.
  * Each day has a task strip under the band for the tasks due that day.
  * The grid always shows all 24 hours.
* **Overdue tasks:** a separate **Overdue** panel beside the grid, shown only when the week contains today or is in the future.
* **Completed tasks** stay visible, struck through, in every week, including past weeks.
* **Interactions:**
  * Move to the previous, current or next week, with the week kept in the URL.
  * Tick tasks complete or reopen them.
  * Open any day from the week.
* **Not in this story:**
  * Creating events and tasks from the week: story [XXXX](XXXX-create-events-and-tasks-from-week-view.md).
  * Dragging items to move or resize them.
  * Editing or deleting existing items.
  * Recurring events.
  * A configurable week start.
  * A month view.
  * A mobile-specific layout: narrow screens scroll the grid sideways.

### Acceptance criteria

1. `/week` shows the current Monday–Sunday week in the browser's time zone, with all-day events, timed events and tasks on the correct days. Each day matches what the day view shows for that date.
2. Previous, This week and Next change the URL and the content. The browser's back and forward buttons restore them, and a week URL can be bookmarked.
3. Selecting a day's heading opens that day. The day view and the Today view are the same view.
4. Ticking a task in the week updates it immediately, and the change shows in the day view without a reload.
5. Completed tasks show struck through, after the open ones, in past, current and future weeks.
6. The Overdue panel follows the rules under *Other decisions*, and never repeats a task that is already shown in a day column.
7. All of the above works in weeks with a daylight-saving change, and is usable with a keyboard and with assistive technology.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0018](../decisions/0018-time-representation-and-bcl-date-time-types.md) | UTC instants plus an IANA zone, and floating dates | Timed events are placed by instant, all-day events and date-only tasks by date |
| [0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md) | A dedicated day-agenda read model, with resource endpoints for writes | Its "Extending to week and month" section anticipates this story. The week follows the same pattern. |
| [0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md) | The client sends its local date and IANA zone; the server computes the window | The week is resolved the same way. The client also sends its "today", which the Overdue panel needs. |
| [0024](../decisions/0024-week-agenda-endpoint-on-range-based-internals.md) *(refines 0020)* | A sibling `GET /api/agenda/week` read model, built on range-based internals | Records the ISO-Monday week, the per-day buckets, and the `today` parameter with the overdue-before-the-week rule. It also records that the internals work for any range of days, so a later month or generic range endpoint is a thin addition that supersedes 0024. |
| [0026](../decisions/0026-client-side-routing-with-tanstack-router.md) | Client-side routing: TanStack Router with code-based route definitions | The app gets its first routes: `/`, `/day/:date` and `/week/:weekStart?` |

[ADR-0024](../decisions/0024-week-agenda-endpoint-on-range-based-internals.md) and [ADR-0026](../decisions/0026-client-side-routing-with-tanstack-router.md) were drafted with the `adr-draft` skill and accepted with the code that depends on them.

### Other decisions (not ADR-worthy)

* **The week window** runs from local midnight on Monday to local midnight on the next Monday.
  * It is a `DateRangeWindow` of seven `DayWindow`s: 23- and 25-hour days and skipped dates behave exactly as in the Today view.
  * `DateRangeWindow` works for any number of consecutive days. The ISO week is one factory on it.
* **Any date selects its week:** the API and the URL accept any date and use that week's Monday. `/week/2026-10-28` redirects to `/week/2026-10-26`.
* **Per-day contents use the Today rules unchanged** (`DayInclusion`):
  * Timed events that overlap the day are included. An event that crosses midnight appears in each day it touches, with "continues" cues.
  * Each day lists the tasks due that day, open and completed.
* **Completed tasks** are struck through and listed after the open ones, in every week. There is no toggle to hide them: past weeks are a record of what got done, which supports tracking.
* **Overdue panel:**
  * It contains tasks that are overdue as of today, by the Today rule: open, or completed today.
  * It is limited to tasks **due before this week's Monday**. Tasks that became overdue earlier this week stay in their day column, marked *Overdue*.
  * It is shown for the current week and future weeks. For a future week it is the full overdue list.
  * Past weeks have no panel. Their columns show what was due and whether it was done.
* **All-day events are returned once per week**, not per day, because the band draws one bar per event. The bar is clipped to the week, with a marker when the event starts before Monday or ends after Sunday.
* **The grid is labelled by wall-clock hours.**
  * Positions come from the event's local time in the viewer's zone.
  * On a 25-hour day, events in the repeated hour overlap and share the column width.
  * A skipped date shows a note instead of timed events.
* **Overlapping events** share the column width side by side. More than about four at once collapse into a "+N more" chip that opens the day. Very short events get a minimum height.
* **The grid always shows all 24 hours** and opens scrolled to 07:00, or to an hour before now in the current week. Empty hours are not collapsed, so an early flight or a late call is never hidden and the grid doesn't shift between weeks.
* **Caching:** all agenda queries share an `['agenda']` key prefix. Ticking a task patches the visible view straight away, then refreshes every agenda view, so the day and week views never show different data.
* **Header summary:** "N events · M tasks (K open)" counts only what is in the week. The Overdue panel shows its own count.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things will live

| Area | Location |
| --- | --- |
| Domain | `backend/src/Calendar.Domain/Time/DateRangeWindow.cs` (new, pure): consecutive `DayWindow`s for any range of dates, with an `IsoWeek(date, zone)` factory |
| Persistence | `Calendar.Infrastructure/Queries/AgendaQueries.cs`: range forms `AllDayOverlapping`, `TimedOverlapping`, `DueWithin` beside the existing per-day predicates |
| Agenda assembly | A shared builder that buckets range results into days with `DayInclusion`. The day endpoint uses it for a one-day range and the week endpoint for a seven-day range. |
| API | `Calendar.Api/Endpoints/AgendaEndpoints.cs` (`GetWeekAgenda`), `Contracts/AgendaContracts.cs` (`WeekAgendaResponse`, `AgendaDay`) |
| Contract | `contracts/openapi.json` and `schema.gen.ts`, regenerated with `make contracts` |
| Web: shared | `frontend/apps/web/src/features/agenda/`: the toggle hook, the task item, problem-details helpers (moved out of `today/`) |
| Web: day | `features/day/`: `TodayView` becomes `DayView({ date })`. The Earlier/Now/Next badges only show on today. |
| Web: week | `features/week/`: `WeekView`, `useWeekAgenda`, `weekDates.ts`, `gridLayout.ts`, `TimeGrid`, `AllDayBand`, `OverduePanel` |
| Routing | The route definitions in `router.tsx` and the layout in `App.tsx`, per [ADR-0026](../decisions/0026-client-side-routing-with-tanstack-router.md) |

### API

| Method and path | Purpose |
| --- | --- |
| `GET /api/agenda/week?date=YYYY-MM-DD&timeZone=Area/City&today=YYYY-MM-DD` | The week containing `date`: `{weekStart, timeZone, window{start,end}, allDayEvents[], days[7]{date, window, events[], tasks[]}, overdue[] \| null}` |
| `POST /api/tasks/{id}/complete` / `reopen` | Existing |

* **Item types:** `AllDayEventItem`, `TimedEventItem`, `TaskResponse` and `AgendaWindow` are reused unchanged, so the generated client gets no new item types.
* **`overdue`:** it is `null` when the whole week is before `today`.
* **Validation:**
  * Missing or invalid `date`, `timeZone` or `today` returns 400 problem details.
  * Dates must be in years 1900–2200, the same range as the day agenda.

### Query approach

* **Cost:** a week costs the same as a day. There are four queries over the whole range window (all-day events, timed events, tasks due in the range, overdue tasks), not seven times four.
* **Range-ready:**
  * The queries and the day bucketing take a `DateRangeWindow`, not a week.
  * Nothing below the endpoint knows a range is seven days long.
  * A month view, or a generic `/api/agenda?from&to`, then needs only a new endpoint plus the overdue rules for that view.
  * The day endpoint moves onto the same builder, so all agenda views share one code path.
* **One snapshot:** the four queries run in the same read-only `REPEATABLE READ` transaction as the day agenda.
* **Bucketing:** results are split into days in memory with the existing `DayInclusion` rules, so the per-day rules keep a single implementation.
* **Shared code:** validation and ordering are extracted from the day endpoint so both endpoints share them. The event projections become `Expression` fields, like `TaskResponse.Projection`.

### Testing

* **Domain:** `DateRangeWindow` unit tests cover:
  * Ranges of 1, 7 and 42 days.
  * ISO week snapping across year boundaries, including an ISO week 1 that starts in December.
  * Daylight-saving weeks (Europe/Berlin 2026-10-25, America/Santiago 2026-09-06).
  * A skipped date (Pacific/Apia 2011-12-30).
* **API integration:** tests cover the week shape, snapping to Monday, ordering, completed tasks in past weeks, the Overdue rules (past, current and future week, no duplicates) and the 400 cases.
* **Agreement test:** for seeded data in several zones, `days[i]` of the week equals `/api/agenda/day` for `weekStart + i`. This keeps the two read models from drifting apart.
* **Frontend:**
  * Pure tests for `weekDates` and `gridLayout`, covering overlap clustering and daylight-saving days.
  * `WeekView` tests for navigation and URL state, the Overdue panel, ticking with rollback, completed tasks, initial scroll position, and the empty state.
  * Routing tests for the redirect to Monday and for `/` being today.

### Delivery plan

One PR per step, each green on `make check`:

1. **Backend and ADR-0024:** `DateRangeWindow`, the range queries and the shared builder (with the day endpoint moved onto it), then `GET /api/agenda/week` with endpoint and agreement tests, and the regenerated contract.
2. **Routing and [ADR-0026](../decisions/0026-client-side-routing-with-tanstack-router.md):** add the router. The Today view becomes the day view at `/` and `/day/:date`. Shared agenda code moves to `features/agenda`.
3. **Week view:** grid, all-day band, task strips with ticking, Overdue panel, navigation and day links.

### Follow-up stories

* [XXXX](XXXX-create-events-and-tasks-from-week-view.md): create events and tasks from the week view, after the day-view create stories.
* Editing, moving (including drag and drop) and deleting events and tasks.
* A month view on the range-ready internals. It supersedes ADR-0024 if it introduces a generic range endpoint.
* A configurable first day of the week, once user preferences exist.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Your week at a glance

Choose **Week** in the Calendar web app, or open `/week`. You'll see the current week, Monday to Sunday, in your device's time zone. The heading shows the dates, for example *26 Oct – 1 Nov 2026*, and a summary such as:

> 12 events · 9 tasks (4 open)

Today's column is highlighted, and a line marks the current time. The grid covers the whole day and opens at 07:00 (in the current week, at an hour before now). Scroll up or down to see earlier or later hours.

### Reading the week

* **All-day events** run across the top of the week. An event that lasts several days is one bar spanning those days. An arrow shows when it started before Monday or carries on after Sunday.
* **Tasks** are listed under each day's heading: timed tasks first by their due time, then the rest.
  * In the current week, unfinished tasks from earlier days are marked **Overdue**.
  * Completed tasks stay in the list, struck through and after the open ones, so past weeks show what you got done.
* **Timed events** are placed on the hourly grid at their start time, in your local time. Events at the same time sit side by side. An event that runs past midnight appears on both days, marked as continuing. If a day is too busy to show everything, a **+N more** chip opens that day.
* **Overdue:** unfinished tasks from before this week are collected in the **Overdue** panel next to the grid, so they don't get lost. Past weeks have no Overdue panel.

### Moving around

* **Previous**, **This week** and **Next** move between weeks. You can also use the `←` and `→` keys, and `t` for this week.
* Each week has its own address, so you can bookmark it or share it, and the browser's back button works.
* Select a day's heading to open that day on its own.

### Ticking off tasks

Tick a task's checkbox to complete it, and untick it to reopen it, in a day column or in the Overdue panel. Changes save straight away and also show in the day view. If a change can't be saved, it's undone and you'll see a message.

### Current limitations

* You can't yet create, edit, move or delete events and tasks in the app. Creating them is coming in a later release.
* The week always starts on Monday.
* Recurring events aren't supported.
* On a phone, the week grid scrolls sideways. Use the day view for a phone-sized layout.
