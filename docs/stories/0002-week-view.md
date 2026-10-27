---
status: implemented
date: 2026-10-27
pr: https://github.com/mgasca/calendar/pull/17
adrs: [0018, 0020, 0021, 0024, 0025]
---

# 0002 Week view: plan and track the whole week in one place

## Story

> As a forward planner, I need to be able to see a full week's view of events and tasks so I can better plan and track the things I need to do.

## Background

The [Today view](0001-today-view.md) answers "what's in my day". A forward planner also needs to look ahead and back:

* **Ahead:** what's coming this week and next, and where the free time is.
* **Back:** what was due earlier in the week and whether it got done.

That needs a view across seven days that shows fixed commitments (events) and work to do (tasks) together. It should be built on the same local-day rules as Today, so the two views never disagree.

The Today view can only show today. This story also makes any day viewable, so the week can link to its days. Creating events and tasks in the app is a separate story, [0003](0003-create-events-and-tasks.md), which builds on this one.

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
  * Creating events and tasks: story [0003](0003-create-events-and-tasks.md).
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
| [0025](../decisions/0025-client-side-routing-with-tanstack-router.md) | Client-side routing: TanStack Router with code-based route definitions | The app gets its first routes: `/`, `/day/:date` and `/week/:weekStart?` |

[ADR-0024](../decisions/0024-week-agenda-endpoint-on-range-based-internals.md) and [ADR-0025](../decisions/0025-client-side-routing-with-tanstack-router.md) were drafted with the `adr-draft` skill and accepted with the code that depends on them.

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

### Where things live

| Area | Location |
| --- | --- |
| Domain | `backend/src/Calendar.Domain/Time/DateRangeWindow.cs` (pure): consecutive `DayWindow`s for any range of dates, with an `IsoWeek(date, zone)` factory. `Agenda/DayInclusion.cs` gained raw-value rules. |
| Persistence | `Calendar.Infrastructure/Queries/AgendaQueries.cs`: range forms `AllDayOverlapping`, `TimedOverlapping`, `DueWithin` beside the per-day predicates |
| Agenda assembly | `Calendar.Api/Endpoints/AgendaBuilder.cs`: runs the range reads in one snapshot and buckets them into days with `DayInclusion`. `AgendaOrder.cs` and `RequestValidation.cs` hold the shared ordering and validation. Both `/day` (a one-day range) and `/week` (seven days) use it. |
| API | `Calendar.Api/Endpoints/AgendaEndpoints.cs` (`GetWeekAgenda`), `Contracts/AgendaContracts.cs` (`WeekAgendaResponse`, `AgendaDay`) |
| Contract | `contracts/openapi.json` and `frontend/packages/api-client/src/schema.gen.ts`, regenerated with `make contracts` |
| Web: routing | `frontend/apps/web/src/router.tsx` (routes `/`, `/day/$date`, `/week`, `/week/$weekStart`) and `App.tsx` (layout with the Today and Week links, not-found and invalid-date pages), per [ADR-0025](../decisions/0025-client-side-routing-with-tanstack-router.md) |
| Web: shared | `features/agenda/`: `agendaQuery.ts` (key prefix, errors, retry), `useToggleTask.ts`, `TaskItem.tsx`, `EventTimes.tsx`, `dayTime.ts`, `useNow.ts` |
| Web: day | `features/day/`: `DayView({ date })`, `TodayView`, `useDayAgenda.ts`. The day header links to its week. |
| Web: week | `features/week/`: `WeekView.tsx`, `TimeGrid.tsx`, `AllDayBand.tsx`, `TaskStrip.tsx`, `OverduePanel.tsx`, `useWeekAgenda.ts`, `useWeekKeys.ts`, and the pure `weekDates.ts` and `gridLayout.ts` |

### API

| Method and path | Purpose |
| --- | --- |
| `GET /api/agenda/week?date=YYYY-MM-DD&timeZone=Area/City&today=YYYY-MM-DD` | The week containing `date`: `{weekStart, timeZone, window{start,end}, allDayEvents[], days[7]{date, window, events[], tasks[]}, overdue[] \| null}` |
| `GET /api/agenda/day?date=YYYY-MM-DD&timeZone=Area/City` | Unchanged response, now built by the shared `AgendaBuilder` |
| `POST /api/tasks/{id}/complete` / `reopen` | Existing |

* **Item types:** `AllDayEventItem`, `TimedEventItem`, `TaskResponse` and `AgendaWindow` are reused unchanged, so the generated client got no new item types.
* **`overdue`:** it is `null` when the whole week is before `today`.
* **Task order:** the server orders each day's tasks like `/day` (timed by due instant, then date-only by title). The open-before-completed order is applied in the UI, in both views.
* **Validation:**
  * Missing or invalid `date`, `timeZone` or `today` returns 400 problem details.
  * Dates must be in years 1900–2200, the same range as the day agenda.

### Query approach

* **Cost:** a week costs the same as a day: four queries over the whole range window (all-day events, timed events, tasks due in the range, overdue tasks).
* **Range-ready:** the queries and the bucketing take a `DateRangeWindow`, and nothing below the endpoint knows a range is seven days long. A month view, or a generic `/api/agenda?from&to`, needs only a new endpoint plus its own overdue rule.
* **One snapshot:** the four queries run in one read-only `REPEATABLE READ` transaction.
* **Bucketing:** results are split into days in memory with `DayInclusion`. It gained rules on raw values (instants and dates), so the projections are bucketed without loading entities, and the per-day rules still have a single implementation.
* **Web caching:** every agenda query key starts with `['agenda']`. The week key is `['agenda', 'week', weekStart, timeZone, today]`: `today` comes from the client clock, so the Overdue panel refetches at local midnight while the week shown stays the one in the URL. Ticking a task patches the visible view through a `TaskPatch` adapter (`patchWeekTasks` maps `days[].tasks` and `overdue`), rolls back only that task on failure, and then invalidates the whole prefix, so a cached day view refetches too.

### The week grid

* **One scroll container:** the grid is a single CSS grid inside one scroll container. Day headings, the all-day band and the task strips are sticky at the top, and the 24 hours scroll beneath them. Below about 56 rem the whole grid scrolls sideways.
* **Accessible structure:** each day is a `<section aria-labelledby>` (with `display: contents`) named by its full date. It holds its heading, its task list and an ordered list of its events with time text. The heading's link to the day is named by its visible text ("Mon 26") and described by the full date. Positions are presentational. Events hidden behind a "+N more" chip stay in the list, visually hidden.
* **Placement:** `gridLayout.ts` places events by local wall-clock minutes in the viewer's zone, from `Intl.DateTimeFormat` parts, clipped to the day's window. On a day whose local midnight was skipped (such as America/Santiago on 6 September 2026, which starts at 01:00), the top is clipped to the window start's wall clock, not to 00:00. Very short events are at least 20 minutes tall. Overlapping events are clustered transitively and get greedy columns; a cluster that needs more than four columns shows three and a "+N more" chip linking to the day.
* **All-day band:** bars are clipped to the week, marked when they continue before Monday or after Sunday, and stacked into the fewest lanes.
* **Initial scroll:** each week opens at 07:00, or an hour before now in the current week, by setting `scrollTop` on the grid's container. One hour is a fixed 48 px, so the offset is exact.
* **Keyboard:** `←`, `→` and `t` are handled on the document and ignored in form fields, in editable text and with a modifier held. The grid's scroll container is a focusable region named "Week grid", so it can be scrolled from the keyboard; while focus is inside it, `←` and `→` scroll it instead of changing week.

### Testing

* **Domain:** `DateRangeWindow` unit tests cover ranges of 1, 7 and 42 days, ISO week snapping across year boundaries (including a week 1 that starts in December), the Europe/Berlin and America/Santiago DST weeks, and the skipped Pacific/Apia date.
* **API integration** (real PostgreSQL via Testcontainers): the week shape, snapping to Monday, ordering, completed tasks in past weeks, the Overdue rules for past, current and future weeks with no duplicates, and the 400 cases.
* **Agreement:** `WeekAgendaAgreementTests` checks that `days[i]` of the week equals `/api/agenda/day` for `weekStart + i`, for seeded data in several zones and DST weeks. Both outputs come from the same builder, so this test mainly catches multi-day bugs (bucketing, windows, flags). The builder's SQL is anchored separately by the existing `AgendaAgreementTests` against `DayInclusion`.
* **Frontend:**
  * Pure tests for `weekDates` (ISO weeks, arithmetic, locale-aware ranges across months and years) and `gridLayout` (wall-clock spans, midnight crossing, minimum height, overlap clusters, +N more, a 25-hour DST day, a skipped date, all-day lanes).
  * `WeekView` and routing tests, rendering the app from a memory history: redirects to Monday, navigation by links, keys and browser history, day links and the day view's week link, the Overdue panel in past, current and future weeks, task order and Overdue markers, optimistic ticking with rollback and day-cache invalidation, the empty, loading, error and skipped-date states, and the initial scroll.
* **Final counts:** 321 backend tests and 151 web tests (plus 1 in `@calendar/api-client`). `make check` is green.

### Delivery plan

Delivered as three stacked PRs, each green on `make check`:

1. **Backend and [ADR-0024](../decisions/0024-week-agenda-endpoint-on-range-based-internals.md):** `DateRangeWindow`, the range queries and the shared builder (with the day endpoint moved onto it), then `GET /api/agenda/week` with endpoint and agreement tests, and the regenerated contract.
2. **Routing and [ADR-0025](../decisions/0025-client-side-routing-with-tanstack-router.md):** TanStack Router. The Today view became the day view at `/` and `/day/:date`, and shared agenda code moved to `features/agenda`.
3. **Week view:** the grid, all-day band, task strips with ticking, Overdue panel, navigation, keyboard shortcuts and day links.

### Lessons learned during the build

* The ADR numbers drafted in this story went stale when #16 merged first: 0022 and 0023 became 0024 and 0025. Run `make adr-check ARGS=--next-number` right before writing an ADR, not when planning it.
* An agreement test between two outputs of the same builder can't catch a bug the builder shares with itself. It earns its place by catching multi-day bugs; the SQL itself is anchored by a test against an independent implementation.
* TanStack Router signals not-found and redirects by throwing its own values. ESLint's `only-throw-error` rule allows `NotFoundError` and `Redirect` from `@tanstack/router-core`, and nothing else.
* Routes render asynchronously, so component tests that need `Link` render inside a minimal router that is loaded before rendering (`renderInRouter`), and app tests wait with `findBy…`.
* Vitest needed Testing Library's `asyncUtilTimeout` raised to 5 s for the first render of a file while `make check` runs everything in parallel, and `window.scrollTo` stubbed because jsdom doesn't implement it and the router's scroll restoration calls it.
* jsdom implements neither layout nor `contentEditable`: the grid uses a fixed hour height so scroll offsets can be asserted, and tests set the `contenteditable` attribute directly.

### Known issues

* When moving between days or weeks, the previous view stays on screen, dimmed, until the new one loads. A task toggle error shown for it stays visible after the new view arrives.
* The API doesn't serve the SPA yet, so deep links such as `/week/2026-10-26` only work with the Vite dev server or `vite preview`. [ADR-0025](../decisions/0025-client-side-routing-with-tanstack-router.md) records the fallback rules for when the API serves it.
* On a 25-hour day, events in the repeated hour share wall-clock positions and sit side by side, as agreed. Their time text tells them apart.

### Follow-up stories

* [0003](0003-create-events-and-tasks.md): create events and tasks from the day and week views.
* Editing, moving (including drag and drop) and deleting events and tasks.
* A month view on the range-ready internals. It supersedes ADR-0024 if it introduces a generic range endpoint.
* A configurable first day of the week, once user preferences exist.
* Serving the SPA from the API, with the fallback rules in ADR-0025.

## User guide

### Your week at a glance

Choose **Week** in the Calendar web app, or open `/week`. You'll see the current week, Monday to Sunday, in your device's time zone. The heading shows the dates, for example *26 Oct – 1 Nov 2026*, with *This week*, *Next week* or similar above it, and a summary such as:

> 12 events · 9 tasks (4 open)

The summary counts what's in the week. An event that runs past midnight is counted once.

Today's heading is highlighted, and a red line marks the current time in today's column. The grid covers the whole day and opens at 07:00 (in the current week, at an hour before now). Scroll up or down to see earlier or later hours. The day headings, all-day events and tasks stay in view while you scroll.

If nothing is planned, you'll see *Nothing planned this week.*

### Reading the week

* **All-day events** run across the top of the week. An event that lasts several days is one bar spanning those days. An arrow shows when it started before Monday or carries on after Sunday.
* **Tasks** are listed under each day's heading: timed tasks first, by their due time, then the rest by title.
  * In the current week, unfinished tasks from earlier days are marked **Overdue**.
  * Completed tasks stay in the list, struck through and after the open ones, so past weeks show what you got done.
* **Timed events** are placed on the hourly grid at their start time, in your local time, with their times written on them. Events at the same time sit side by side. An event that runs past midnight appears on both days, marked as continuing. If more than four events happen at once, a **+N more** chip opens that day.
* **Overdue:** unfinished tasks from before this week are collected in the **Overdue** panel next to the grid, with their count and how late they are. It's shown for this week and future weeks. Past weeks have no Overdue panel.
* **Daylight-saving changes:** on the day the clocks go back, events in the repeated hour share the same place on the grid. If your time zone skipped a date entirely, that day says so instead of showing events.

### Moving around

* **Previous**, **This week** and **Next** move between weeks. You can also press `←` and `→`, and `t` for this week. The keys don't work while you're typing in a field or holding a modifier key. While the week grid has focus, `←` and `→` scroll it sideways instead.
* Each week has its own address, for example `/week/2026-10-26`, so you can bookmark it or share it, and the browser's back and forward buttons work. Any date opens its week: `/week/2026-10-28` shows the week starting on Monday 26 October.
* Select a day's heading to open that day. The day view has a **Week of …** link back to its week.

### Ticking off tasks

Tick a task's checkbox to complete it, and untick it to reopen it, in a day's task list or in the Overdue panel. Changes show straight away and also appear in the day view. If a change can't be saved, it's undone and you'll see a message.

### Current limitations

* You can't yet create, edit, move or delete events and tasks in the app. Creating them is coming in a later release.
* The week always starts on Monday.
* Recurring events aren't supported.
* On a phone, the week grid scrolls sideways. Use the day view for a phone-sized layout.
