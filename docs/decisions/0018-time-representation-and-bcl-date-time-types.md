---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# UTC instants plus an IANA zone id and floating dates, using BCL time types instead of NodaTime

## Context and Problem Statement

The Today view ([ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md)) mixes three kinds of time value: timed events (a moment in time), all-day events (a calendar date range with no zone) and task due values (either a date or a moment). [ADR-0014](0014-postgresql-database-engine.md) already says instants are stored as `timestamptz` with the event's IANA zone stored separately, and [ADR-0015](0015-ef-core-data-access.md) maps event spans to `NpgsqlRange<DateTimeOffset>`. How should these values be represented in the domain, the database and the API, and which .NET time types should implement that?

## Decision Drivers

* **D1 Semantic correctness**: instants, floating dates and zone-dependent wall-clock times are different things and must not be conflated. DST gaps and overlaps are handled deliberately.
* **D2 Fit with the data stack**: works with `timestamptz`, `date`, `tstzrange` and GiST overlap queries ([ADR-0014](0014-postgresql-database-engine.md), [ADR-0015](0015-ef-core-data-access.md)) without extra provider plugins.
* **D3 Minimal dependencies**: no new packages in `Calendar.Domain`, which has no framework dependencies ([ADR-0002](0002-dotnet-10-minimal-api-backend.md)).
* **D4 Testable clock**: "now" can be controlled in tests; no `DateTime.UtcNow` in domain logic.
* **D5 Contract friendliness**: types serialize to plain JSON and OpenAPI (`date-time`, `date`) that every client understands ([ADR-0004](0004-openapi-contract-and-generated-client.md)).
* **D6 AI-agent proficiency & ecosystem**: mainstream, well-documented types ([ADR-0003](0003-react-vite-typescript-web-ui.md) reasoning).

## Considered Options

* BCL types: UTC instants + IANA zone id for timed events, floating `DateOnly` for all-day events and date-only tasks
* The same model implemented with NodaTime
* Local date-times plus zone only (`timestamp without time zone`)

## Decision Outcome

Chosen option: "BCL types with UTC instants, an IANA zone id and floating dates", because it models each kind of value as what it is (D1), maps natively to PostgreSQL and the generated contract (D2, D5), and adds no dependencies to the domain (D3). `TimeProvider` makes the clock injectable (D4).

| Driver | **BCL types (chosen)** | NodaTime | Local date-time + zone |
| --- | :---: | :---: | :---: |
| D1 Semantic correctness | ★★☆ | ★★★ | ★☆☆ |
| D2 Fit with the data stack | ★★★ | ★★☆ | ★☆☆ |
| D3 Minimal dependencies | ★★★ | ★☆☆ | ★★★ |
| D4 Testable clock | ★★★ | ★★★ | ★★☆ |
| D5 Contract friendliness | ★★★ | ★☆☆ | ★★☆ |
| D6 AI-agent proficiency & ecosystem | ★★★ | ★★☆ | ★★☆ |

### Value model

| Value | Domain type | Storage | JSON / OpenAPI |
| --- | --- | --- | --- |
| Timed event span | `Start`, `End`: `DateTimeOffset` normalized to offset 0; `End > Start`, end exclusive | `timestamptz` (a `tstzrange`, GiST-indexed, per [ADR-0015](0015-ef-core-data-access.md)) | `date-time` |
| Timed event zone | `TimeZoneId`: IANA id string, validated with `TimeZoneInfo` | `text` | `string` |
| All-day event | `StartDate`, `EndDate`: `DateOnly`, **end exclusive** (a one-day event on 2026-10-26 ends 2026-10-27), no zone | `date` | `date` |
| Task due | `DueDate` (`DateOnly`, floating) **XOR** `DueAt` (instant) **XOR** neither | `date` / `timestamptz`, with a check constraint that at most one is set | `date` / `date-time` |
| Task completion | `CompletedAt`: `DateTimeOffset?`, set from `TimeProvider` | `timestamptz` | `date-time` |

Rules:

* **Floating means floating.** All-day events and date-only tasks never get a zone or an instant. They mean the same calendar date wherever the viewer is.
* **Instants are stored in UTC; the zone id is metadata**, kept so the original wall-clock time can be shown or edited and so recurrence can be added later ([ADR-0014](0014-postgresql-database-engine.md)). Inputs with a non-UTC offset are normalized, not rejected.
* **Time zone ids are IANA** (`Europe/Berlin`), resolved with `TimeZoneInfo.FindSystemTimeZoneById`. Development is Linux/WSL only ([ADR-0011](0011-make-as-top-level-task-runner.md)), where .NET reads the system tz database. **The runtime container image must include tzdata**; minimal images often omit it.
* **Domain code never reads the system clock.** It takes a `TimeProvider` (or a `DateTimeOffset now`). Tests use `FakeTimeProvider` from `Microsoft.Extensions.TimeProvider.Testing` ([ADR-0007](0007-backend-testing-stack.md)).
* **DST gaps and overlaps** are handled in one place, a pure `DayWindow` helper, and covered by tests with named zones ([ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md)).
* **Revisit NodaTime** if the model needs recurrence across DST changes, zoned arithmetic ("every Monday at 09:00 local"), or other logic that `TimeZoneInfo` makes error-prone. The storage model above is the same either way, so the change would be confined to Domain and Infrastructure mapping.

### Consequences

* Good, because each value kind has its own type, so a date-only task cannot be accidentally compared with an instant.
* Good, because no provider plugin, JSON converter or OpenAPI schema customization is needed.
* Good, because the existing `CalendarEvent` and the Npgsql mappings already use `DateTimeOffset`.
* Bad, because `TimeZoneInfo` has no zoned date-time type; gap and overlap handling is hand-written and must be tested.
* Bad, because `DateTimeOffset` can carry a non-zero offset, so normalization to UTC must be enforced at construction.
* Bad, because recurrence work later may justify NodaTime anyway, and that would be a second migration of the domain types.

### Confirmation

* Unit tests for `DayWindow` and the inclusion predicates, including 23-hour and 25-hour days, and a zone whose midnight is skipped.
* Domain validation tests: `End > Start`, `EndDate > StartDate`, an invalid zone id is rejected, and offsets are normalized to UTC.
* Infrastructure tests round-trip all value kinds through PostgreSQL ([ADR-0016](0016-local-database-provisioning.md)). The regenerated `contracts/openapi.json` shows `format: date` and `format: date-time` as in the table.
* Code review rejects `DateTime.Now`, `DateTime.UtcNow` and `DateTimeOffset.UtcNow` in `Calendar.Domain`.

## Pros and Cons of the Options

### BCL types: UTC instants + IANA zone id, floating `DateOnly`

* Good, because **D1 Semantic correctness**: `DateTimeOffset` for moments and `DateOnly` for floating dates keep the two concepts apart; `TimeZoneInfo` converts correctly for any date.
* Good, because **D2 Fit with the data stack**: Npgsql maps `DateTimeOffset` to `timestamptz` and `DateOnly` to `date` out of the box, and ranges work with `NpgsqlRange<DateTimeOffset>`.
* Good, because **D3 Minimal dependencies**: part of the shared framework; nothing to version or audit.
* Good, because **D4 Testable clock**: `TimeProvider` is built in and `FakeTimeProvider` is a first-party package.
* Good, because **D5 Contract friendliness**: System.Text.Json and the OpenAPI generator know these types.
* Good, because **D6 AI-agent proficiency & ecosystem**: the most documented option by far.
* Bad, because **D1 Semantic correctness**: no zoned date-time type, and ambiguous or skipped local times need explicit handling (`IsInvalidTime`, `IsAmbiguousTime`).

### NodaTime

* Good, because **D1 Semantic correctness**: `Instant`, `LocalDate`, `ZonedDateTime` and explicit zone-interval resolvers model the problem exactly; DST gaps and overlaps are first-class.
* Good, because **D4 Testable clock**: `IClock` and `FakeClock` serve the same purpose.
* Neutral, because **D2 Fit with the data stack**: supported by the `Npgsql.EntityFrameworkCore.PostgreSQL.NodaTime` plugin, but it is an extra package that must track the provider version.
* Bad, because **D3 Minimal dependencies**: adds NodaTime to the Domain, plus the plugin in Infrastructure.
* Bad, because **D5 Contract friendliness**: needs `NodaTime.Serialization.SystemTextJson` and custom OpenAPI schema mapping so generated clients see `date` and `date-time` strings.
* Neutral, because **D6 AI-agent proficiency & ecosystem**: well documented and respected, but less commonly generated than BCL code, so agents mix in BCL idioms.

### Local date-times plus zone only

* Good, because **D3 Minimal dependencies**: no more than the BCL.
* Bad, because **D1 Semantic correctness**: an ambiguous local time during a DST overlap identifies two instants, and sorting events across zones needs a conversion per row.
* Bad, because **D2 Fit with the data stack**: no sensible `tstzrange` or GiST overlap query, which contradicts [ADR-0014](0014-postgresql-database-engine.md) and [ADR-0015](0015-ef-core-data-access.md).
* Neutral, because **D4 Testable clock**: workable, but every comparison first converts to an instant.
* Neutral, because **D5 Contract friendliness** and **D6 AI-agent proficiency & ecosystem**: offset-less strings are easy to serialize, but clients misread them as local or UTC.

## More Information

* Related: [ADR-0014](0014-postgresql-database-engine.md) (storage conventions), [ADR-0015](0015-ef-core-data-access.md) (range mapping), [ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md) (how "today" is defined), [ADR-0020](0020-aggregate-day-agenda-endpoint-as-read-model.md) (the read endpoint), [ADR-0004](0004-openapi-contract-and-generated-client.md).
* Versions checked on 2026-10-26 with `dotnet package search`: NodaTime 3.3.6, `Npgsql.EntityFrameworkCore.PostgreSQL.NodaTime` 10.0.3, `Microsoft.Extensions.TimeProvider.Testing` 10.11.0.
* Not yet verified against a built contract: that the .NET 10 OpenAPI generator emits `format: date` for `DateOnly`. The Confirmation step above checks it.
