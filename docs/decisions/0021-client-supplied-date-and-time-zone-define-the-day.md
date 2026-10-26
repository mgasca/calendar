---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# The client's IANA time zone and local date define "today", with the server computing the day window

## Context and Problem Statement

"Today" means different instants for different people: 2026-10-26 in Tokyo starts hours before it does in Berlin. Timed events are instants, while all-day events and date-only tasks are floating dates ([ADR-0018](0018-time-representation-and-bcl-date-time-types.md)). There are no user accounts yet ([ADR-0019](0019-single-user-mode-with-authentication-deferred.md)), and several clients will use the API ([ADR-0004](0004-openapi-contract-and-generated-client.md)). Whose time zone defines the day, and what does the client send for the day-agenda request ([ADR-0020](0020-aggregate-day-agenda-endpoint-as-read-model.md))?

## Decision Drivers

* **D1 Matches the user's wall-clock day**: the day shown is the one the person is living in, including when travelling.
* **D2 DST-correct window**: 23-hour and 25-hour days, and zones whose local midnight is skipped, are handled in one tested place.
* **D3 Works without accounts**: no stored user profile or settings.
* **D4 Stateless and explicit for any client**: the request fully describes what is asked, so it is reproducible, testable and the same for web, mobile and CLI.
* **D5 Floating values**: all-day events and date-only tasks need a local calendar date, not just an instant range.
* **D6 Input safety**: a small, easily validated input surface.

## Considered Options

* The client sends the local date and its IANA zone id; the server computes the window
* The client sends a UTC range (start and end instants)
* A per-user stored time zone setting
* A server-defined UTC day

## Decision Outcome

Chosen option: "The client sends the local date and its IANA zone id", because it uses the zone of the device the person is actually using (D1), needs no accounts (D3), is a complete and stateless description of the request (D4), and gives the server the local date that floating values need (D5). The server computes the window once, correctly (D2).

| Driver | **Client date + zone (chosen)** | Client UTC range | Stored user zone | Server UTC day |
| --- | :---: | :---: | :---: | :---: |
| D1 Matches the user's wall-clock day | ★★★ | ★★☆ | ★★☆ | ☆☆☆ |
| D2 DST-correct window | ★★★ | ★☆☆ | ★★★ | ★★★ |
| D3 Works without accounts | ★★★ | ★★★ | ☆☆☆ | ★★★ |
| D4 Stateless and explicit for any client | ★★★ | ★★☆ | ★☆☆ | ★★★ |
| D5 Floating values | ★★★ | ☆☆☆ | ★★★ | ★☆☆ |
| D6 Input safety | ★★☆ | ★☆☆ | ★★★ | ★★★ |

### Semantics

* **Request:** `date` as `YYYY-MM-DD` and `timeZone` as an IANA id (`Europe/Berlin`). The web client takes them from `Intl.DateTimeFormat().resolvedOptions().timeZone` and the local date. Missing or invalid values return 400 ProblemDetails.
* **Window:** for date `D` and zone `Z`, the window is `[local midnight of D in Z, local midnight of D+1 in Z)`, as UTC instants. If a local midnight does not exist (a DST gap), the window starts at the first valid instant of that day. The helper is a pure `DayWindow` in Domain with no database dependency.
* **Timed events** are included if `Start < windowEnd && End > windowStart` ([ADR-0018](0018-time-representation-and-bcl-date-time-types.md) range semantics).
* **All-day events** are included if `StartDate <= D && EndDate > D`. They ignore the zone; `D` is the client's local date.
* **Tasks:**
  * Due today: `DueDate == D`, or `DueAt` inside the window.
  * Overdue: `DueDate < D` or `DueAt < windowStart`, shown if incomplete, or if `CompletedAt` is inside the window.
  * Undated tasks never appear.
* **Server clock:** the server does not decide what day it is. "Now" is only used when stamping `CompletedAt`, via `TimeProvider`. Whether a timed task due earlier today is past due is left to the client's clock.
* **Rollover:** the client recomputes the date at local midnight and on focus, so a tab left open does not show yesterday.
* **Zone database:** IANA ids rely on the host's tz database (see [ADR-0018](0018-time-representation-and-bcl-date-time-types.md)), so the runtime image must ship tzdata. Legacy aliases that browsers may still report (`Asia/Calcutta`, `US/Eastern`) are resolved through an embedded alias-to-canonical table derived from the tzdata `backward` file (`Calendar.Domain`, with the tzdata release and refresh steps in its header), because hosts without the legacy links would otherwise reject them. Geographic aliases always resolve to the canonical zone, which is the id stored and echoed; slashless ids (`UTC`, `CET`) are tried on the host first. Directory ids, pseudo entries (`localtime`, `Factory`) and malformed paths stay rejected. A `+` in `Etc/GMT+5` must be percent-encoded in the query string (`%2B`), as any HTTP client library does.

### Consequences

* Good, because travelling or changing device zone works with no settings change.
* Good, because the DST logic exists once, on the server, with tests; clients only send two strings.
* Good, because the request is a plain GET that is easy to call from `curl` or the seed tool and easy to reproduce in tests.
* Bad, because the client is trusted to send a truthful zone. That is fine for a single user, and a wrong value only changes the view for that caller.
* Bad, because a user moving between zones sees all-day items and overdue lists change with the device zone. This is intended for floating values, but it can surprise.
* Bad, because the server must reject unknown or hostile zone ids, and the container needs tzdata.
* Neutral, because when accounts exist ([ADR-0019](0019-single-user-mode-with-authentication-deferred.md)), a stored preferred zone can become the default when `timeZone` is omitted. The explicit parameter would remain.

### Confirmation

* Unit tests for `DayWindow` with named zones: a normal day, spring-forward (23 h) and fall-back (25 h) days, a zone whose midnight is skipped, and a zone ahead of and behind UTC.
* API tests: invalid date, invalid zone and missing parameters return 400 ProblemDetails; the same stored data yields different results for different zones.
* The runtime container build includes a check or a test that a named zone resolves (when the Dockerfile exists).

## Pros and Cons of the Options

### The client sends the local date and its IANA zone id

* Good, because **D1 Matches the user's wall-clock day**: uses the zone of the device in hand.
* Good, because **D2 DST-correct window**: one server implementation, with tests.
* Good, because **D3 Works without accounts**: needs nothing stored.
* Good, because **D4 Stateless and explicit for any client**: any client can produce a date and a zone id.
* Good, because **D5 Floating values**: the local date is given directly, so all-day and date-only values are compared with it exactly.
* Neutral, because **D6 Input safety**: two short strings to validate (date parse, zone lookup) with no range-size concerns.

### The client sends a UTC range

* Good, because **D3 Works without accounts**: needs nothing stored.
* Neutral, because **D1 Matches the user's wall-clock day**: correct only if every client computes the DST-aware window correctly. Browsers have the data, but clients differ in how easily they can.
* Neutral, because **D4 Stateless and explicit for any client**: explicit and stateless, but each client has its own range logic.
* Bad, because **D2 DST-correct window**: every client implements 23/25-hour days and skipped midnights.
* Bad, because **D5 Floating values**: the local date cannot be recovered reliably from an instant range without the zone, so all-day events and date-only tasks cannot be matched, and the zone has to be sent anyway.
* Bad, because **D6 Input safety**: arbitrary ranges can be huge, so the server must cap them, and it cannot tell whether a range is "a day".

### A per-user stored time zone setting

* Good, because **D2 DST-correct window**: one server implementation.
* Good, because **D5 Floating values** and **D6 Input safety**: the server derives the local date, with only a trusted setting as input.
* Neutral, because **D1 Matches the user's wall-clock day**: right at home, wrong while travelling or on a second device until the setting is changed.
* Bad, because **D3 Works without accounts**: needs a user profile and a settings endpoint, which do not exist ([ADR-0019](0019-single-user-mode-with-authentication-deferred.md)).
* Bad, because **D4 Stateless and explicit for any client**: the response depends on hidden state, which makes calls harder to reproduce and test.

### A server-defined UTC day

* Good, because **D2 DST-correct window**, **D3 Works without accounts**, **D4 Stateless and explicit for any client** and **D6 Input safety**: trivial; UTC has no DST, and the request needs no parameters.
* Neutral, because **D5 Floating values**: all-day items compare with a date, but it is the UTC date, not the user's.
* Bad, because **D1 Matches the user's wall-clock day**: for anyone not in UTC, "today" starts and ends at the wrong local hours. In the evening in the Americas, the view would already show tomorrow.

## More Information

* Related: [ADR-0018](0018-time-representation-and-bcl-date-time-types.md) (time types and storage), [ADR-0020](0020-aggregate-day-agenda-endpoint-as-read-model.md) (the endpoint this input belongs to), [ADR-0019](0019-single-user-mode-with-authentication-deferred.md) (no stored user settings), [ADR-0004](0004-openapi-contract-and-generated-client.md).
* Revisit when user accounts exist (a stored default zone), or when recurrence is added (zone-aware expansion may justify NodaTime, see [ADR-0018](0018-time-representation-and-bcl-date-time-types.md)).
