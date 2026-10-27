---
status: accepted
date: 2026-10-27
decision-makers: mgasca, Claude (AI assistant)
---

# A sibling week-agenda endpoint as a read model, built on range-based internals

## Context and Problem Statement

The week view ([story 0002](../stories/0002-week-view.md)) shows seven local days of events and tasks, plus an Overdue panel. [ADR-0020](0020-aggregate-day-agenda-endpoint-as-read-model.md) chose a dedicated day-agenda read model and deferred the choice between sibling operations and a generic range endpoint until a second view existed. [ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md) says the client's local date and IANA zone define the day, and the server never decides what day it is. How should the API serve the week, so that each day in it agrees with the day agenda and a later month view stays cheap to add?

## Decision Drivers

* **D1 One consistent snapshot**: the whole week loads with one request, and every day comes from the same moment ([ADR-0020](0020-aggregate-day-agenda-endpoint-as-read-model.md) D1).
* **D2 Day and week agree**: each day of the week shows exactly what the day agenda shows for that date, because the per-day rules have one implementation (`DayInclusion`).
* **D3 Rules live on the server**: week snapping, DST-correct days, bucketing and the Overdue rule are implemented and tested once, not in every client.
* **D4 Explicit semantics**: every field has a defined meaning; in particular "overdue" is defined for the view, not left open for an arbitrary range.
* **D5 Extensibility**: a month view, or a generic range endpoint, is a thin addition on the same code.
* **D6 Query efficiency**: a week costs about as much as a day: a fixed number of projection queries over the whole range, not one set per day ([ADR-0015](0015-ef-core-data-access.md)).

## Considered Options

* Sibling `GET /api/agenda/week` with range-ready internals
* Generic `GET /api/agenda?from&to&timeZone` range endpoint
* The client composes the week from seven `/api/agenda/day` calls
* A week endpoint returning flat lists that the client buckets into days

## Decision Outcome

Chosen option: "Sibling `GET /api/agenda/week` with range-ready internals", because it returns the week from one snapshot (D1), reuses the day rules unchanged so day and week agree (D2), keeps snapping, bucketing and the overdue rule on the server (D3) with semantics defined for this view (D4), and costs four queries for any range (D6). Building the internals on ranges of days, not on weeks, keeps a month or generic endpoint a thin addition (D5).

| Driver | **Sibling week endpoint, range internals (chosen)** | Generic range endpoint | Client composes 7 day calls | Week endpoint, flat lists |
| --- | :---: | :---: | :---: | :---: |
| D1 One consistent snapshot | ★★★ | ★★★ | ☆☆☆ | ★★★ |
| D2 Day and week agree | ★★★ | ★★★ | ★★★ | ★☆☆ |
| D3 Rules live on the server | ★★★ | ★★☆ | ★★☆ | ★☆☆ |
| D4 Explicit semantics | ★★★ | ★☆☆ | ★★☆ | ★★☆ |
| D5 Extensibility | ★★☆ | ★★★ | ★★☆ | ★★☆ |
| D6 Query efficiency | ★★★ | ★★☆ | ★☆☆ | ★★★ |

### Shape

* **Request:** `GET /api/agenda/week?date=YYYY-MM-DD&timeZone=Area/City&today=YYYY-MM-DD`, operation `GetWeekAgenda`. All three parameters are required. A missing or invalid value returns 400 ProblemDetails, and dates must be in years 1900–2200, as for the day agenda.
* **Which week:** the ISO week, Monday to Sunday, that contains `date`. Any date is accepted and snaps to its Monday (`weekStart`). The first day of the week is not configurable.
* **Window:** seven consecutive `DayWindow`s from local midnight on Monday to local midnight on the next Monday in `timeZone`, so 23- and 25-hour days and skipped dates behave exactly as in the day agenda ([ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md)).
* **Response:** `{weekStart, timeZone, window{start,end}, allDayEvents[], days[7]{date, window, events[], tasks[]}, overdue[] | null}`.
  * **All-day events** are returned **once per week**, not per day: those overlapping the week, ordered by start date, then title, then id. The client draws one bar per event and clips it to the week.
  * **Per-day buckets** (`AgendaDay`): `events` are the timed events overlapping that day, with the day's `startsBeforeDay` / `endsAfterDay` flags and the day agenda's ordering. `tasks` are the tasks due that day, open and completed, in the day agenda's `dueToday` order.
  * **Item schemas** `AllDayEventItem`, `TimedEventItem`, `TaskResponse` and `AgendaWindow` are reused unchanged.
* **`today` and the Overdue rule:** the server never decides what day it is ([ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md)), so the client sends its local `today`.
  * `overdue` holds the tasks that are overdue as of `today`'s `DayWindow` by the day agenda's rule: still open, or completed within today.
  * It is limited to tasks **due before the week's Monday**: `DueDate < weekStart` or `DueAt < days[0].Start`. Tasks that became overdue later in the week are already in their day's `tasks`, so the panel never repeats them.
  * For a future week this is the full overdue list, including tasks due between today and the week start.
  * It is `null` when the whole week is before today (`weekStart + 6 < today`): past weeks have no Overdue panel.

### Range-ready internals

* **Domain:** a pure `DateRangeWindow` is a run of consecutive `DayWindow`s for any number of days from a start date in a zone. The ISO week is one factory on it (`IsoWeek(date, zone)`).
* **Queries:** range forms of the day predicates (`AllDayOverlapping`, `TimedOverlapping` with the same GiST span overlap, `DueWithin`) sit beside the per-day ones in `AgendaQueries`.
* **Builder:** one shared agenda builder runs the reads for a `DateRangeWindow` in one read-only `REPEATABLE READ` transaction and buckets the results into days in memory with `DayInclusion`. Nothing below the endpoint knows that a week has seven days.
* **The day endpoint uses the same builder** as a one-day range, with an unchanged response, so all agenda views share one code path.

### Consequences

* Good, because the week view gets everything in one request, and a day in the week can never disagree with the day view.
* Good, because a week costs four queries, the same as a day.
* Good, because a month view needs only a new endpoint and its own overdue rule; the domain, queries and builder are reused.
* Bad, because the API gains a second view-shaped operation, continuing the endpoint-per-view growth that [ADR-0020](0020-aggregate-day-agenda-endpoint-as-read-model.md) accepted.
* Bad, because the client must send `today` as well as `date`, and two clients with different clocks can see different Overdue panels for the same week. This is intended by [ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md).
* Neutral, because all-day events are week-level while timed events and tasks are per day; clients that want per-day all-day lists filter by date.
* Neutral, because a month view or a generic range endpoint would **supersede** this ADR, which would then record how such an endpoint defines overdue.

### Confirmation

* `DateRangeWindow` unit tests cover ranges of 1, 7 and 42 days, ISO week snapping across year boundaries (including a week 1 that starts in December), DST weeks and a skipped date.
* API tests (real PostgreSQL via Testcontainers, [ADR-0016](0016-local-database-provisioning.md)) cover the week shape, snapping, ordering, the Overdue rules for past, current and future weeks, and the 400 cases.
* An agreement test checks, for seeded data in several zones and DST weeks, that each `days[i]` equals `/api/agenda/day` for `weekStart + i`.
* The existing day-agenda tests pass unchanged after the day endpoint moves onto the shared builder.
* `contracts/openapi.json` and the generated client are regenerated and committed; CI's contract-drift check fails otherwise ([ADR-0004](0004-openapi-contract-and-generated-client.md)).

## Pros and Cons of the Options

### Sibling `GET /api/agenda/week` with range-ready internals

* Good, because **D1 One consistent snapshot**: one request and one read-only `REPEATABLE READ` transaction for the whole week.
* Good, because **D2 Day and week agree**: days are bucketed with the same `DayInclusion` rules the day agenda uses, through the same builder.
* Good, because **D3 Rules live on the server**: Monday snapping, DST-correct day windows, bucketing and the overdue rule are on the server, with tests.
* Good, because **D4 Explicit semantics**: "overdue" is defined for a week, relative to the client's `today`, and `null` for past weeks.
* Good, because **D6 Query efficiency**: four projection queries over the range window, with the GiST span index for timed events.
* Neutral, because **D5 Extensibility**: the internals take any range, so a month view is a thin endpoint; it is still one more operation in the contract.

### Generic `GET /api/agenda?from&to&timeZone` range endpoint

* Good, because **D1 One consistent snapshot** and **D2 Day and week agree**: the same builder could serve it from one snapshot.
* Good, because **D5 Extensibility**: one operation serves day, week, month and custom ranges.
* Neutral, because **D3 Rules live on the server**: bucketing stays on the server, but week snapping moves to every client.
* Neutral, because **D6 Query efficiency**: the range has to be capped, and the cost is unbounded up to that cap.
* Bad, because **D4 Explicit semantics**: "overdue" for an arbitrary range has no agreed meaning (before `from`? as of which day?), the open question [ADR-0020](0020-aggregate-day-agenda-endpoint-as-read-model.md) left for this decision, and it would be fixed in a contract before a second range view needs it.

### The client composes the week from seven `/api/agenda/day` calls

* Good, because **D2 Day and week agree**: each day is literally the day agenda.
* Good, because **D5 Extensibility**: no new endpoint; a month is 42 calls.
* Neutral, because **D3 Rules live on the server**: per-day rules stay on the server, but week snapping, deduplicating multi-day all-day events and the Overdue panel move into each client.
* Neutral, because **D4 Explicit semantics**: each response is well defined, but the week-level Overdue rule is only defined by client code.
* Bad, because **D1 One consistent snapshot**: seven requests see seven snapshots, so a task ticked during the load can show in one state on one day and another state on the next.
* Bad, because **D6 Query efficiency**: seven requests and 28 queries for one view, and overdue tasks are fetched seven times.

### A week endpoint returning flat lists that the client buckets into days

* Good, because **D1 One consistent snapshot** and **D6 Query efficiency**: one request and four queries, like the chosen option.
* Neutral, because **D4 Explicit semantics**: the lists are well defined, but which item belongs to which day is left to the client.
* Neutral, because **D5 Extensibility**: the same shape scales to a month, but each client also scales its bucketing.
* Bad, because **D2 Day and week agree**: every client reimplements `DayInclusion` for bucketing, so a week day can disagree with the day view, typically around DST and midnight-crossing events.
* Bad, because **D3 Rules live on the server**: the continuation flags and the per-day DST windows have to be computed by each client.

## More Information

* Refines, and does not supersede, [ADR-0020](0020-aggregate-day-agenda-endpoint-as-read-model.md): it answers its "Extending to week and month" question for the week, with sibling operations.
* Related: [ADR-0018](0018-time-representation-and-bcl-date-time-types.md) (instants and floating dates), [ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md) (the client's date, zone and `today`), [ADR-0004](0004-openapi-contract-and-generated-client.md) (contract), [ADR-0015](0015-ef-core-data-access.md) (projections and `AsNoTracking`).
* Revisit when a month view or a generic range endpoint is built. That decision supersedes this ADR and must define overdue for its range.
* Revisit when a configurable first day of the week is added (once user preferences exist): the ISO-Monday snapping becomes a parameter.
