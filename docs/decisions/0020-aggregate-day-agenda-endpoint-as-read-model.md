---
status: proposed
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# A dedicated day-agenda endpoint as the read model, beside resource endpoints for writes

## Context and Problem Statement

The Today view needs, in one screen, the day's all-day events, timed events, due-today tasks and overdue tasks. The inclusion rules are non-trivial: spans that touch the day, overdue tasks that were completed today stay visible, and so on ([ADR-0018](0018-time-representation-and-bcl-date-time-types.md), [ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md)). Several clients will consume the API ([ADR-0001](0001-monorepo-layout.md), [ADR-0004](0004-openapi-contract-and-generated-client.md)). How should the API serve date-range views like this one, while still supporting creating and changing events and tasks?

## Decision Drivers

* **D1 One consistent snapshot**: the view loads with one request, and events and tasks come from the same moment.
* **D2 Rules live on the server**: inclusion, overdue and ordering rules are implemented, tested and changed once, not in every client ([ADR-0001](0001-monorepo-layout.md) future clients).
* **D3 Contract fit**: the endpoint is described by the OpenAPI document and generated clients stay simple ([ADR-0004](0004-openapi-contract-and-generated-client.md)).
* **D4 Extensibility**: week, month and other views can follow without redoing the design.
* **D5 Small API surface**: few endpoints and concepts to design, secure and keep stable.
* **D6 Query efficiency**: read paths use projections and `AsNoTracking` ([ADR-0015](0015-ef-core-data-access.md)) and avoid N+1 queries.

## Considered Options

* A dedicated `GET /api/agenda/day?date&timeZone` read endpoint, plus resource endpoints for writes
* The client composes the view from resource list endpoints (`/api/events?from&to`, `/api/tasks?...`)
* GraphQL
* A generic `GET /api/agenda?from&to&timeZone` range endpoint now

## Decision Outcome

Chosen option: "A dedicated day-agenda endpoint beside resource endpoints", because it gives the view one request and one snapshot (D1) with the rules in one tested place on the server (D2), at the lowest design cost (D5). It is a plain OpenAPI operation (D3).

| Driver | **Day-agenda endpoint (chosen)** | Client composes from lists | GraphQL | Generic range endpoint now |
| --- | :---: | :---: | :---: | :---: |
| D1 One consistent snapshot | ★★★ | ★☆☆ | ★★★ | ★★★ |
| D2 Rules live on the server | ★★★ | ☆☆☆ | ★★☆ | ★★☆ |
| D3 Contract fit | ★★★ | ★★★ | ☆☆☆ | ★★★ |
| D4 Extensibility | ★★☆ | ★★☆ | ★★★ | ★★★ |
| D5 Small API surface | ★★★ | ★★☆ | ☆☆☆ | ★★☆ |
| D6 Query efficiency | ★★★ | ★★☆ | ★☆☆ | ★★☆ |

### Shape

* **Reads:** `GET /api/agenda/day?date=YYYY-MM-DD&timeZone=Area/City` returns:
  * `date`, `timeZone` and the computed `window` (`start`, `end` as instants)
  * `allDayEvents[]`
  * `events[]` (timed, sorted by start then title, each with `startsBeforeDay` / `endsAfterDay` flags)
  * `tasks` as `{ overdue[], dueToday[] }`
  * A missing or invalid `date` or `timeZone` returns 400 ProblemDetails.
* **Writes:** resource endpoints, which are also the way other clients reach the data directly:
  * `POST /api/events`, `GET /api/events/{id}`
  * `POST /api/tasks`, `GET /api/tasks/{id}`, `POST /api/tasks/{id}/complete`, `POST /api/tasks/{id}/reopen`
* **Shared schemas:** agenda tasks reuse the `TaskResponse` schema of the resource endpoints, so the UI can update its cache from a mutation response. Agenda events use dedicated view schemas, `AllDayEventItem` and `TimedEventItem`, instead of the resource `EventResponse`: the resource schema has nullable fields for both event kinds, while the view schemas make each kind's fields non-null (clearer generated client types) and carry the agenda-only `startsBeforeDay` / `endsAfterDay` flags.
* **Query side:** the endpoint runs its projection queries (all-day events, timed events, due-today and overdue tasks) with `AsNoTracking`, inside one read-only `REPEATABLE READ` transaction so they see a single snapshot (D1) against the window computed by the pure `DayWindow` helper. The inclusion predicates are the same ones the unit tests cover.
* **Cache coherence in the web UI:** a TanStack Query key per `(date, timeZone)`; completing or reopening a task invalidates it, or patches it optimistically.

### Extending to week and month

* Add sibling operations (`/api/agenda/week`, or a generic `/api/agenda?from&to&timeZone`) when a second view exists, reusing the item schemas and the projection code. The generic form will need explicit answers to what "overdue" means for a range, which is why it is not built now.
* Each new view is a new operation in the contract, so clients regenerate with `make contracts` and breaking changes show up as a diff ([ADR-0004](0004-openapi-contract-and-generated-client.md)).

### Consequences

* Good, because the web UI, and later mobile and CLI clients, get "my day" from one call without reimplementing the rules.
* Good, because rule changes (e.g. how overdue tasks behave) are a backend-only change with unit tests.
* Good, because writes stay plain REST resources that any client can use independently of the view.
* Bad, because the endpoint is shaped to one view. Each new view needs its own endpoint or a deliberate generalization, so there is a risk of endpoint-per-screen growth.
* Bad, because the response duplicates data that the resource endpoints expose, and the two must stay schema-compatible (shared DTOs mitigate this).
* Neutral, because clients that want something other than the view's shape (for example "all tasks") need a resource list endpoint, which is not built until a feature needs it.

### Confirmation

* API tests (real PostgreSQL via Testcontainers, [ADR-0016](0016-local-database-provisioning.md)) cover the inclusion and ordering rules and the 400 cases.
* `contracts/openapi.json` and the generated client are regenerated and committed; CI's contract-drift check fails otherwise ([ADR-0004](0004-openapi-contract-and-generated-client.md)).
* Review checks that agenda queries use projections and `AsNoTracking`.

## Pros and Cons of the Options

### Dedicated day-agenda endpoint plus resource endpoints for writes

* Good, because **D1 One consistent snapshot**: one request, one transaction-consistent read.
* Good, because **D2 Rules live on the server**: inclusion, overdue and ordering rules are in the backend, next to the code that stores the data.
* Good, because **D3 Contract fit**: a typed GET with query parameters; `openapi-typescript` + `openapi-fetch` generate it with no special tooling.
* Good, because **D5 Small API surface**: one read operation with fixed semantics.
* Good, because **D6 Query efficiency**: the server picks exactly the columns and rows the view needs.
* Neutral, because **D4 Extensibility**: new views mean new operations; the item schemas and query code are reusable.

### Client composes the view from resource list endpoints

* Good, because **D3 Contract fit**: only generic resource endpoints, which any client can reuse.
* Neutral, because **D4 Extensibility**: lists with filters serve many views, but each client still builds each view.
* Neutral, because **D5 Small API surface**, **D6 Query efficiency**: no view endpoint, but two or more list endpoints with filters (including "overdue" and "completed in this window"), and each filter is its own query.
* Bad, because **D1 One consistent snapshot**: separate requests can see different states, so a task could be drawn twice or not at all while it is changed.
* Bad, because **D2 Rules live on the server**: every client reimplements day inclusion and overdue handling, which are easy to get subtly different, such as around DST ([ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md)).

### GraphQL

* Good, because **D1 One consistent snapshot** and **D4 Extensibility**: one query fetches exactly the shape each view needs, and new views need no new endpoints.
* Neutral, because **D2 Rules live on the server**: possible in resolvers, but clients can also assemble their own filters.
* Bad, because **D3 Contract fit**: not covered by OpenAPI; [ADR-0004](0004-openapi-contract-and-generated-client.md) considered and did not choose it, and it would need a second contract and toolchain.
* Bad, because **D5 Small API surface**: adds a server library, a schema, and new concerns (query cost limits, caching, authorization per field).
* Bad, because **D6 Query efficiency**: nested resolvers invite N+1 queries unless batching is added, and EF Core projections are harder to control.

### Generic range endpoint now: `GET /api/agenda?from&to&timeZone`

* Good, because **D1 One consistent snapshot**, **D3 Contract fit** and **D4 Extensibility**: one operation serves day, week and month views.
* Neutral, because **D2 Rules live on the server**: rules are also server-side, but "overdue" and "completed in the window" must be defined per range, which is unclear for a week or month view.
* Neutral, because **D5 Small API surface**: one endpoint, but a wider, more speculative contract that has to be supported even if only the day case is used.
* Neutral, because **D6 Query efficiency**: needs a bound on range size, and optimizing for ranges that no screen yet uses.

## More Information

* Related: [ADR-0001](0001-monorepo-layout.md), [ADR-0002](0002-dotnet-10-minimal-api-backend.md) (minimal APIs), [ADR-0004](0004-openapi-contract-and-generated-client.md), [ADR-0015](0015-ef-core-data-access.md), [ADR-0018](0018-time-representation-and-bcl-date-time-types.md), [ADR-0019](0019-single-user-mode-with-authentication-deferred.md) (no per-user scoping yet; adding it touches these queries), [ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md).
* Revisit when a second date-range view (week or month) is built: decide between a generic `/api/agenda?from&to` and sibling operations.
