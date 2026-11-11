---
status: accepted
date: 2026-11-11
decision-makers: mgasca, Claude (AI assistant)
---

# chrono and chrono-tz types for instants, floating dates and IANA zones in the Rust backend

## Context and Problem Statement

[ADR-0018](0018-time-representation-and-bcl-date-time-types.md) decided two things: a value model (UTC instants plus an IANA zone id for timed events, floating dates for all-day events and date-only tasks, an injected clock) and the .NET types that implement it (`DateTimeOffset`, `DateOnly`, `TimeZoneInfo`, `TimeProvider`, instead of NodaTime). The backend moves to Rust ([ADR-0051](0051-rust-backend-on-axum-and-tokio.md)), where those types do not exist, while the storage, the contract and the day rules of [ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md) must not change. Which Rust time types implement the same value model?

## Decision Drivers

* **D1 Semantic correctness**: instants, floating dates and zone-dependent wall-clock times stay distinct types; daylight-saving gaps and overlaps are handled deliberately, with the same results as the C# rules.
* **D2 Fit with the data and contract stack**: maps to `timestamptz`, `date` and the range columns through Diesel ([ADR-0052](0052-diesel-data-access-with-embedded-sql-migrations.md)), and to `date-time` and `date` schemas through utoipa and serde ([ADR-0051](0051-rust-backend-on-axum-and-tokio.md)), without adapter crates.
* **D3 Minimal dependencies**: few crates in `calendar-domain`, which has no I/O or framework dependency.
* **D4 Testable clock**: "now" is injected; domain code cannot read the system clock.
* **D5 Contract parity**: JSON output is byte-compatible with what System.Text.Json wrote, and input parsing accepts what the .NET API accepted ([ADR-0004](0004-openapi-contract-and-generated-client.md)).
* **D6 Maturity and agent proficiency**: stable, widely used, well documented, so agents write it correctly.

## Considered Options

* chrono with chrono-tz
* jiff
* The time crate with a separate time-zone database crate

## Decision Outcome

Chosen option: "chrono with chrono-tz", because Diesel, utoipa and serde support chrono through their own feature flags (D2), it is the most used and documented of the three (D6), and its zone conversions return an explicit gap, single or ambiguous result that maps onto the C# rules (D1). jiff models zoned time better (D1), as NodaTime did in [ADR-0018](0018-time-representation-and-bcl-date-time-types.md), and loses for the same reason NodaTime did: it does not plug into the rest of the stack as directly. The maintainer chose chrono on 2026-11-11; the alternatives were not tried in code.

| Driver | **chrono with chrono-tz (chosen)** | jiff | time with a zone database crate |
| --- | :---: | :---: | :---: |
| D1 Semantic correctness | ★★☆ | ★★★ | ★☆☆ |
| D2 Fit with the data and contract stack | ★★★ | ★★☆ | ★★☆ |
| D3 Minimal dependencies | ★★☆ | ★★☆ | ★★☆ |
| D4 Testable clock | ★★☆ | ★★☆ | ★★☆ |
| D5 Contract parity | ★★☆ | ★★☆ | ★★☆ |
| D6 Maturity and agent proficiency | ★★★ | ★★☆ | ★★☆ |

### Value model

The model, the storage and the contract formats of [ADR-0018](0018-time-representation-and-bcl-date-time-types.md) are unchanged. Only the domain type column changes:

| Value | Rust type | Storage | JSON / OpenAPI |
| --- | --- | --- | --- |
| Timed event span | `start`, `end`: `DateTime<Utc>`; `end > start`, end exclusive | `timestamptz` (generated `tstzrange`, GiST-indexed) | `date-time` |
| Timed event zone | `chrono_tz::Tz`, parsed from an IANA id | `text` | `string` |
| All-day event | `start_date`, `end_date`: `NaiveDate`, end exclusive, no zone | `date` | `date` |
| Task due | `due_date` (`NaiveDate`, floating) XOR `due_at` (`DateTime<Utc>`) XOR neither | `date` / `timestamptz`, with the existing check constraint | `date` / `date-time` |
| Task completion | `completed_at`: `Option<DateTime<Utc>>`, set from the injected clock | `timestamptz` | `date-time` |

Rules:

* **Floating means floating**, and **instants are UTC with the zone as metadata**, exactly as before. An input with a non-UTC offset is parsed as `DateTime<FixedOffset>` and normalized to UTC, not rejected.
* **Zone ids are IANA**, resolved by chrono-tz, which compiles the time-zone database into the binary. The API no longer reads the image's tzdata. The database version the API uses is therefore the one in the pinned chrono-tz release, and it changes only when that crate is updated.
* **The clock is injected.** `calendar-domain` takes `now` as a `DateTime<Utc>` argument and never calls a clock. The API holds a clock in its state; tests set it ([ADR-0054](0054-rust-backend-testing-stack.md)). Direct calls to `Utc::now` and its relatives are banned by lint ([ADR-0055](0055-rust-static-analysis-and-formatting.md)).
* **Gaps and overlaps** are handled in one place, the port of `DayWindow`, by matching on the result of the local-to-instant conversion (none, single, ambiguous), and choosing the same instant the C# code chose in each case.
* **Wire formats are written explicitly.** Serialization and parsing of instants and dates go through functions in one module that reproduce the .NET formats; no handler relies on chrono's default serde output.
* **`NaiveDateTime` is never stored or sent.** It appears only inside the day-window computation, between a date and its instant.

### Effect on earlier records

These edits were made when this record was accepted, on 2026-11-11.

* **[ADR-0018](0018-time-representation-and-bcl-date-time-types.md)** becomes `superseded by` this record, because its chosen option ("BCL types") no longer exists in the backend. Its architecture-model entry gets a `note`, as [ADR-0014](0014-postgresql-database-engine.md)'s has: the value model, the storage types, the contract formats and the floating-date and UTC rules still stand and are restated here. Nodes that cite [ADR-0018](0018-time-representation-and-bcl-date-time-types.md) for those rules may keep citing it under that note, or move to this record in the code pull request.
* **[ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md)** stands unchanged: the client still supplies `today` and `timeZone`.

### Consequences

* Good, because the database columns, the JSON and the OpenAPI formats do not change, so the frontend is unaffected.
* Good, because the runtime image no longer needs tzdata for the API to resolve zones.
* Bad, because **formatting and parsing are a parity risk**. System.Text.Json writes a UTC `DateTimeOffset` with a `+00:00` offset and trims fractional seconds in its own way; chrono's defaults differ. .NET's parser and chrono's accept different sets of inputs. Each difference must be found by tests against the real .NET output before the C# sources are deleted.
* Bad, because **zone id validation may differ**. `TimeZoneInfo.FindSystemTimeZoneById` on Linux and chrono-tz may disagree on letter case, legacy aliases and Windows zone names. The accepted set must be compared, and any difference is a contract change.
* Bad, because the API's time-zone data (compiled into chrono-tz) and PostgreSQL's (in its image) are updated separately, so a rule in `calendar-domain` and its SQL form in `Queries/` can disagree about a recently changed zone until both are bumped. Under .NET the API's data came from its image, with the same kind of gap.
* Bad, because chrono has no zoned-arithmetic type, so gap and overlap handling stays hand-written, as it was with `TimeZoneInfo`.
* Bad, because `calendar-domain` now depends on two third-party crates for time, where the C# domain used only the framework.
* Neutral, because recurrence, the trigger [ADR-0018](0018-time-representation-and-bcl-date-time-types.md) named for NodaTime, is now the trigger for jiff.

### Confirmation

* The domain tests port every `DayWindow` and inclusion test with the same named zones, including 23-hour and 25-hour days and a zone whose midnight is skipped.
* Contract tests compare serialized instants and dates with strings captured from the .NET API, and parse the inputs the C# tests send, including non-UTC offsets and fractional seconds.
* A test feeds the same list of zone ids (valid, wrong case, legacy alias, Windows name, nonsense) to both implementations before the C# sources are deleted, and records the differences in the code pull request.
* Infrastructure tests round-trip every value kind through PostgreSQL. The regenerated `contracts/openapi.json` shows the same `format: date` and `format: date-time`.
* Clippy rejects a direct clock read ([ADR-0055](0055-rust-static-analysis-and-formatting.md)).

## Pros and Cons of the Options

### chrono with chrono-tz

* Good, because **D2 Fit with the data and contract stack**: Diesel's `chrono` feature maps `DateTime<Utc>` and `NaiveDate` to `timestamptz` and `date`, and utoipa's `chrono` feature emits `date-time` and `date`; the code branch already enables both.
* Good, because **D6 Maturity and agent proficiency**: the longest-established Rust date-time crate, with the most examples.
* Good, because **D1 Semantic correctness**: `DateTime<Utc>`, `NaiveDate` and `Tz` keep instants, floating dates and zones apart, and a local-to-instant conversion returns none, one or two results that the caller must handle.
* Neutral, because **D4 Testable clock**: chrono has no clock abstraction; the application defines a small one, and a lint keeps `Utc::now` out.
* Neutral, because **D3 Minimal dependencies**: two crates in the domain, one of which carries the whole zone database in the binary.
* Bad, because **D1 Semantic correctness**: no zoned date-time arithmetic; "the same wall-clock time tomorrow" is hand-written.
* Bad, because **D5 Contract parity**: the default serde output is not the .NET format, so explicit formatters are required.

### jiff

* Good, because **D1 Semantic correctness**: `Timestamp`, civil dates and `Zoned` values with DST-aware arithmetic and explicit disambiguation, the closest equivalent to NodaTime.
* Neutral, because **D2 Fit with the data and contract stack**: Diesel and utoipa integration goes through additional crates or features that were not evaluated for this record.
* Neutral, because **D3 Minimal dependencies**: one crate, which can bundle the zone database or read the system's.
* Neutral, because **D4 Testable clock**: the same application-defined clock is needed.
* Neutral, because **D5 Contract parity**: its default formats are not the .NET ones either.
* Bad, because **D6 Maturity and agent proficiency**: much newer than chrono, with fewer examples, so agents mix in chrono idioms.

### The time crate with a separate time-zone database crate

* Good, because **D2 Fit with the data and contract stack**: Diesel and utoipa have `time` features.
* Neutral, because **D3 Minimal dependencies**: `time` plus a zone crate, the same count as the chosen option.
* Neutral, because **D4 Testable clock**: the same application-defined clock.
* Neutral, because **D5 Contract parity**: explicit formatters are needed here too.
* Neutral, because **D6 Maturity and agent proficiency**: mature and widely used, but IANA zone handling is less commonly written with it.
* Bad, because **D1 Semantic correctness**: `time` has offsets but no IANA zones of its own; named-zone conversion and DST handling come from a second, smaller crate, which is where the day rules need the most care.

## More Information

* **Versions** resolved in the code branch's `Cargo.lock` on 2026-11-11: chrono 0.4.45, chrono-tz 0.10.4. Read from the lock file, not re-checked against crates.io. jiff and `time` versions and their Diesel and utoipa integrations were not checked.
* **Not verified:** every statement above about how .NET and chrono differ in formatting, parsing and zone lookup is expected from the libraries' documentation and has not been measured in this repository. The Confirmation tests are what establishes them.
* **Related:** [ADR-0014](0014-postgresql-database-engine.md) (storage conventions), [ADR-0020](0020-aggregate-day-agenda-endpoint-as-read-model.md), [ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md).
* **Revisit when** the model needs recurrence across daylight-saving changes or zoned arithmetic ("every Monday at 09:00 local"): evaluate jiff then. The storage model is the same either way.
* **Resolved at acceptance, 2026-11-11:** the maintainer chose to keep chrono-tz's compiled-in tz database after the port measured its differences from .NET. The differences in accepted zone ids and in day windows for zones whose rules changed after tzdata 2025b are accepted and listed in `backend/README.md` ("Known differences from the .NET backend"). No check compares chrono-tz's tz database version with the PostgreSQL image's.
