---
status: implemented
date: 2026-10-26
pr: https://github.com/mgasca/calendar/pull/11
adrs: [0018, 0019, 0020, 0021]
---

# 0001 Today view: see everything for today in one place

## Story

> As a person who prepares for their day in the morning, I need to be able to see everything for today in a single view so that I don't miss anything throughout the day.

## Background

This is the calendar's first user-facing feature. Before it, the repo had the scaffolding (a .NET API, a React web UI, and accepted ADRs for PostgreSQL, EF Core and local database provisioning), but no persistence code and no domain beyond a bare `CalendarEvent` record.

A morning planner wants one glance that answers three questions: *what's fixed in my day*, *what's happening when*, and *what must I get done*, including anything that slipped from earlier days. The view therefore combines calendar events and tasks, and is built around the user's own local day rather than UTC.

### Scope agreed with the product owner

* **Events:** timed events and all-day events, including events that span midnight and multi-day all-day events. No recurrence, reminders or external calendar import.
* **Tasks:** incomplete tasks **due today**, plus incomplete **overdue** tasks, flagged as overdue so nothing is missed.
  * A task due today stays visible after it's completed (shown as done).
  * An overdue task completed *today* also stays visible, so it doesn't vanish the moment it's ticked.
  * Tasks without a due date never appear in the Today view.
* **Task due value:** either a calendar date ("due Friday") or an exact date and time ("due Friday 17:00").
* **Interaction:** tasks can be marked complete or reopened from the view.
* **Data entry:** events and tasks are created through the API. For demos and development, `make db-seed` adds a realistic sample day. A create/edit UI is a later story.
* **Whose "today":** the browser's time zone and local date.
* **Users:** single user, no sign-in yet.

### Acceptance criteria

1. **Given** the web app is opened, **when** today's agenda loads, **then** today's date, all-day events, timed events in time order, overdue tasks and tasks due today are shown in one scrolling view.
2. **Given** the browser has a local date and time zone, **when** the Today view loads on an ordinary or daylight-saving transition day, **then** it uses that local date and time zone.
3. **Given** an event started yesterday or ends tomorrow, **when** today's agenda is shown, **then** the event appears with the corresponding continuation label.
4. **Given** a task is overdue, **when** it appears in the Today view, **then** its overdue status is conveyed in text as well as colour.
5. **Given** a task is shown, **when** its checkbox is ticked or unticked, **then** it is respectively completed or reopened and the change persists.
6. **Given** the Today view is open, **when** local midnight passes or the user returns to the window after data changes, **then** the view shows the new day or refreshed data.
7. **Given** the view is loading, empty, or an error occurs, **when** the corresponding state is displayed on a phone or with assistive technology, **then** the state is clear and usable.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0018](../decisions/0018-time-representation-and-bcl-date-time-types.md) | Time representation with built-in .NET types (UTC `DateTimeOffset` + IANA zone, floating `DateOnly`, `TimeProvider`); no NodaTime | How events, all-day events and task due values are stored |
| [0019](../decisions/0019-single-user-mode-with-authentication-deferred.md) | Single-user mode; authentication deferred, no owner column | Keeps the slice small; the app must not be exposed beyond a trusted network until an auth ADR lands |
| [0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md) | A dedicated `GET /api/agenda/day` read model, with resource endpoints for writes | One request returns the whole day; inclusion rules live once, on the server |
| [0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md) | The client sends its local date and IANA zone; the server computes the day's window | Defines "today" without user accounts or stored preferences |

The story also implements these earlier, already-accepted ADRs for the first time: [0014](../decisions/0014-postgresql-database-engine.md) (PostgreSQL), [0015](../decisions/0015-ef-core-data-access.md) (EF Core with code-first migrations) and [0016](../decisions/0016-local-database-provisioning.md) (Docker Compose and Testcontainers). The seed tool follows [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md).

### Other decisions (not ADR-worthy)

* **The day window** runs from local midnight of the date to local midnight of the next date, as UTC instants. It is daylight-saving correct: 23- and 25-hour days are handled, and where midnight doesn't exist the day starts at its first valid instant. A date a zone skips entirely (e.g. Pacific/Apia 2011-12-30) gets an empty window.
* **All-day events** use an exclusive end date, iCalendar style: a one-day event on 26 October has end date 27 October.
* **Inclusion rules** (single source of truth: `Calendar.Domain.Agenda.DayInclusion`, mirrored in SQL):
  * A timed event is included if it overlaps the window: `start < dayEnd && end > dayStart`. Events that only touch the window's edges are excluded.
  * An all-day event is included if `startDate <= date < endDate`.
  * A task is **due today** if its due date is today, or its due instant falls in the window.
  * A task is **overdue** if it was due before the window. It's included if incomplete, or if it was completed within today's window.
  * A timed task due earlier today is "due today", not overdue. The UI marks it *Past due* using the browser's clock.
* **Validation:**
  * Titles are required, trimmed and at most 200 characters. Location is at most 200 characters and notes at most 4000.
  * Timed events must end after they start, and all-day events must end on a later date.
  * A task has a due date, a due instant, or neither, never both.
* **Date-times must carry an explicit offset** (`Z` or `±hh:mm`). Values without one are rejected with a 400 rather than silently interpreted in the server's local offset.
* **Time zones:**
  * Only IANA ids are accepted. Windows ids and pseudo-zones like `localtime` are rejected.
  * Legacy aliases that browsers can report (e.g. `Asia/Calcutta`, `Europe/Kiev`, `US/Eastern`) are mapped to their canonical id through a table taken from the official tz database's `backward` file.
  * The canonical id is what gets stored and echoed back.
* **Agenda dates** are limited to years 1900–2200, so extreme dates can't break the window calculation.
* **Agenda consistency:** the agenda's four reads run in one read-only `REPEATABLE READ` transaction, so they all see the same snapshot.
* **Agenda response shape:** the agenda's event entries use their own view types (`AllDayEventItem`, `TimedEventItem`), with flags for spans that start before or end after the day. Tasks reuse the `TaskResponse` resource schema.
* **Overlapping events:** a timed and an all-day event are never considered overlapping, because all-day dates have no time zone.
* **Concurrency:** task completion uses optimistic concurrency (`xmin`). A conflicting change returns 409, and the UI refetches.
* **Event times are shown in the viewer's time zone**, not in the zone the event was created in.
* **The UI uses plain CSS** with no component library. Dark mode follows the system setting.
* **The dev seed goes through the HTTP API** rather than writing to the database directly, so it exercises the same validation as real clients.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| Domain | `backend/src/Calendar.Domain/`: `Events/CalendarEvent.cs`, `Tasks/TodoTask.cs`, `Time/DayWindow.cs`, `Time/TimeZones.cs`, `Time/IanaAliases.cs`, `Agenda/DayInclusion.cs` |
| Persistence | `backend/src/Calendar.Infrastructure/`: `CalendarDbContext`, `Configurations/`, `Queries/AgendaQueries.cs`, `Migrations/` |
| API | `backend/src/Calendar.Api/`: `Endpoints/{Event,Task,Agenda}Endpoints.cs`, `Contracts/`, `RequestValidation.cs`, `BadRequestExceptionHandler.cs` |
| Contract | `contracts/openapi.json` → `frontend/packages/api-client/src/schema.gen.ts` (`make contracts`) |
| Web UI | `frontend/apps/web/src/features/today/`: `TodayView.tsx`, `useDayAgenda.ts`, `useToggleTask.ts`, `useNow.ts`, `dayTime.ts` |
| Local database | `compose.yaml`, `docker/postgres/init/01-roles.sh`, `.env.example` |
| Seed tool | `tools/seed-dev/` |
| Test fixtures | `backend/tests/Calendar.Testing/` (shared Testcontainers + Respawn), `Calendar.Api.Tests`, `Calendar.Infrastructure.Tests`, `Calendar.Domain.Tests` |

### API

| Method and path | Purpose |
| --- | --- |
| `POST /api/events` | Create a timed event `{title, start, end, timeZone, location?, notes?}` or an all-day event `{title, allDay: true, startDate, endDate, location?, notes?}`. Returns 201 with `Location`. |
| `GET /api/events/{id}` | Fetch an event |
| `POST /api/tasks` | Create a task `{title, dueDate?}` or `{title, dueAt?}`. Returns 201. |
| `GET /api/tasks/{id}` | Fetch a task |
| `POST /api/tasks/{id}/complete` / `reopen` | Idempotent; returns the updated task, or 409 on a concurrent change |
| `GET /api/agenda/day?date=YYYY-MM-DD&timeZone=Area/City` | Returns `{date, timeZone, window{start,end}, allDayEvents[], events[], tasks{overdue[], dueToday[]}}` |

Errors use `application/problem+json`: 400 with per-field `errors`, 404 and 409. A `+` in a zone id (e.g. `Etc/GMT+5`) must be percent-encoded as `%2B` in the query string. The generated client does this.

### Persistence

* **Tables:** `events` and `tasks`, in snake_case.
* **Event span:** timed events carry a generated, stored `tstzrange` column (`span`) with a GiST index, used by the overlap query (ADR-0014/0015). It's confined to Infrastructure. For the SQLite fallback, `AgendaQueries.TimedOn` would switch to `starts_at < end AND ends_at > start`.
* **Integrity:** check constraints enforce the event shape (timed vs all-day columns), the due-date-xor-due-instant rule and non-blank titles. Partial indexes cover all-day dates and task due/completed columns.
* **Roles:** the app connects as `calendar_app` (data access only), and migrations run as `calendar_migrator`. Migrations are never applied at app startup.

### Testing

* **Domain unit tests** cover daylight-saving days in New York, London, Santiago, Havana, Beirut, Asuncion, Coyhaique and Apia. They also cover a property test that consecutive days tile without gaps across all system zones, every inclusion boundary, and alias resolution.
* **API integration tests** run against real PostgreSQL via Testcontainers. `AgendaAgreementTests` checks the SQL agenda against `DayInclusion` across eight zone/date scenarios.
* **Frontend tests** (Vitest, Testing Library and MSW) cover each section and state, optimistic toggling with rollback and 409 handling, Now/Next markers, midnight rollover and periodic refetch.
* **Final counts:** 248 backend and 48 frontend tests. `make check` and the GitHub CI on PR #11 are green.

### Lessons learned during the build

* An independent review of the domain found two real defects before they shipped:
  * Directory-like zone ids (e.g. `America`) threw a `SecurityException`, which would have been a 500.
  * In zones where daylight saving starts exactly at midnight (e.g. Asuncion), the day started an hour early, because .NET doesn't report that midnight as invalid.
* The CI step `dotnet ef … -c Release` was wrong: for `dotnet ef`, `-c` means `--context`. Use `--configuration`.
* Legacy zone aliases fail on hosts without the `tzdata-legacy` package. The embedded alias table makes resolution independent of the host. The runtime container image must still ship tzdata.
* Testing Library's `waitFor` can't be used with a faked `setInterval`. The tests fake only `Date` unless they need intervals, and use `vi.waitFor` with a generous timeout.

### Known issues

* At the midnight rollover, the new date heading can briefly appear above the previous day's items until the new day loads. Checkboxes are disabled meanwhile, and the next fetch corrects it.

### Follow-up stories

* A UI for creating and editing events and tasks
* Recurring events (likely revisits ADR-0018's NodaTime trade-off)
* Reminders and notifications
* Authentication (ADR-0019's revisit trigger)
* Showing event notes; collapsing past events; grouping overlapping events

## User guide

### Your day at a glance

Open the Calendar web app. The Today view is the home screen. It shows today's date as the heading and a one-line summary underneath, for example:

> 2 all-day events · 7 events · 5 tasks to do · 2 overdue

"Today" is your local day, based on your device's time zone. It moves on by itself at midnight, so a tab left open overnight shows the new day in the morning.

The view has three sections. A section with nothing in it is hidden. If you have nothing at all today, you'll see *"Nothing scheduled today. Enjoy the free day!"*

### All day

All-day events, such as birthdays, holidays and conferences. An event that lasts several days shows which day you're on, for example *"Day 2 of 4"*.

### Schedule

Your timed events in start-time order, each with its time range in your local time (e.g. *09:30 – 10:00*), and its location if it has one. Badges help you find your place in the day:

* **Earlier**: the event has already finished. It's shown dimmed.
* **Now**: the event is happening right now.
* **Next**: the next event still to come.

Events that cross midnight say so: *"Continues from yesterday, until 02:00"*, *"From 22:30, continues tomorrow"*, or *"Continues from yesterday to tomorrow"*.

### Tasks

* **Overdue**: unfinished tasks from earlier days, with a note such as *"Overdue since yesterday"* or *"Overdue by 3 days"*. If you complete an overdue task today, it stays in the list, ticked, marked *"Was overdue"*, until tomorrow.
* **Due today**: tasks due today. A task with a due time shows it (*"Due 17:00"*), and adds *"Past due"* once that time has passed.

Open tasks are listed first, then completed ones.

**To complete a task,** tick its checkbox. The task is struck through and moves to the bottom of its list. **To reopen it,** untick the checkbox. Changes save straight away. If a change can't be saved, it's undone and you'll see *"Couldn't update the task. Your change was undone."* If the task was changed somewhere else at the same time, the list refreshes and asks you to try again.

Tasks without a due date, or due on a later day, don't appear in the Today view.

### Keeping it up to date

The view refreshes when you switch back to its window and every five minutes while it's visible. You can also select **Refresh** next to the date. If a refresh fails, you keep seeing the last loaded agenda with a *"Couldn't refresh"* message and a retry button.

### Current limitations

* You can't yet create or edit events and tasks in the app. They're added through the API (see below).
* Recurring events and reminders aren't supported yet.
* There's no sign-in. Run the app only on your own machine or a trusted network.

### For developers: run it locally with sample data

```sh
make db-up && make db-migrate       # start PostgreSQL and create the schema
dotnet user-secrets set "ConnectionStrings:Calendar" \
  "Host=127.0.0.1;Port=5432;Database=calendar;Username=calendar_app;Password=<CALENDAR_APP_PASSWORD from .env>" \
  --project backend/src/Calendar.Api
make dev-api                        # API on http://localhost:5041
make db-seed                        # add a sample day for your local zone (additive)
make dev-web                        # web UI; proxies /api to the API
```

* **Seed options:** `make db-seed ARGS="--date 2026-10-26 --time-zone Europe/Berlin --api-url http://localhost:5041"`.
* **Clean slate:** `make db-reset`, then `make db-migrate`.
* **Sample data:** the seed adds six timed events (one overlapping pair, one from last night, one running into tomorrow), a birthday and a multi-day conference. It also adds tasks due today, overdue tasks (one already completed), and an undated task and a task due tomorrow, which correctly don't appear.
