---
status: proposed
date: 2026-11-15
decision-makers: mgasca, Claude (AI assistant)
---

# Per-user data ownership: every event and task query takes a typed OwnerId and starts from an owner-filtered query

## Context and Problem Statement

[ADR-0041](0041-per-user-data-ownership.md) gave every event and task an owner and scoped every query with an EF Core global query filter keyed by the signed-in user. It rejected "an explicit owner predicate in every endpoint query", because a forgotten predicate leaks silently. The Rust port ([ADR-0051](0051-rust-backend-on-axum-and-tokio.md), [ADR-0052](0052-diesel-data-access-with-embedded-sql-migrations.md)) said ownership was carried over unchanged. Diesel has no global query filter, though. Every repository function in `calendar-infrastructure` (`events.rs`, `tasks.rs`, `agenda.rs`) now takes an `OwnerId` and builds its query from `queries::owned_events` or `owned_tasks`, and the session `Principal` carries the `OwnerId` (#827). That is the option [ADR-0041](0041-per-user-data-ownership.md) rejected, so the record no longer says what the code does (issue #938, found by the Calendar narrative, #711). On Rust and Diesel, how should the API make sure that no event or task query or write ever crosses users?

## Decision Drivers

* **D1 Isolation by default**: a new endpoint or query must not be able to read or write another user's rows by forgetting something. The API never takes a user identifier from the request ([ADR-0027](0027-google-oidc-bff-session.md)).
* **D2 Operational simplicity**: no new backing service, database extension or server parameter. It must work with the local Compose database, Testcontainers and Azure Flexible Server as they are ([ADR-0031](0031-azure-postgresql-flexible-server.md), [ADR-0063](0063-docker-compose-profiles-for-local-backing-services-instead-of-aspire.md)).
* **D3 Query performance**: the agenda and task-list queries keep using their indexes (GiST ranges, partial B-trees with `owner_id` leading) after the owner predicate is added.
* **D4 Fit with the pooled connection and transactions**: works with the `deadpool` pool of `diesel-async`, the read-only agenda snapshot ([ADR-0020](0020-aggregate-day-agenda-endpoint-as-read-model.md)) and the single-statement writes, without per-connection state that could leak to the next request.
* **D5 Testability**: cross-user isolation is asserted per endpoint in the existing API tests (two users, Testcontainers PostgreSQL, [ADR-0054](0054-rust-backend-testing-stack.md)), and a failure points at one place.
* **D6 Rust and Diesel ecosystem**: idiomatic Rust and Diesel 2 patterns that agents and reviewers recognise, with the compiler doing as much of the checking as it can.

## Considered Options

* A typed `OwnerId` parameter on every repository function, with queries started from owner-filtered roots
* A connection type that carries the owner and exposes only owner-filtered queries
* PostgreSQL row-level security with a per-transaction setting
* A typed `OwnerId` parameter plus row-level security (defence in depth)

## Decision Outcome

Chosen option: "A typed `OwnerId` parameter on every repository function, with queries started from owner-filtered roots". A repository call without an owner does not compile, and every event and task query starts from a root that already filters on the owner (D1, D6). It needs nothing beyond Diesel and the existing column (D2). The owner predicate stays an equality inside the same SQL the indexes serve (D3). It adds no connection state (D4), and the ownership tests that exist today cover it (D5).

| Driver | **Typed OwnerId parameter (chosen)** | Owner-carrying connection | Row-level security alone | OwnerId plus row-level security |
| --- | :---: | :---: | :---: | :---: |
| D1 Isolation by default | ★★☆ | ★★☆ | ★★★ | ★★★ |
| D2 Operational simplicity | ★★★ | ★★★ | ★☆☆ | ★☆☆ |
| D3 Query performance | ★★★ | ★★★ | ★★☆ | ★★☆ |
| D4 Fit with the pooled connection and transactions | ★★★ | ★★☆ | ★☆☆ | ★☆☆ |
| D5 Testability | ★★★ | ★★★ | ★★☆ | ★☆☆ |
| D6 Rust and Diesel ecosystem | ★★★ | ★☆☆ | ★★☆ | ★★☆ |

### What changed since the superseded record

[ADR-0041](0041-per-user-data-ownership.md) was decided for EF Core on .NET, and two of its drivers changed with the port, not only the facts (`docs/decisions/README.md`, "Reopening a decision"):

* **The ecosystem driver now names Rust and Diesel.** The chosen option of [ADR-0041](0041-per-user-data-ownership.md) depended on `HasQueryFilter`, and Diesel has nothing like it. An equivalent would have to be built by hand (the second option here).
* **Isolation by default can now come from the type system.** In .NET the explicit option meant a `Where` clause on each call site, which a new query could leave out and still compile. Here the owner is an `OwnerId` newtype that every repository function requires, so a call without one is a compile error. An owner and a row id, both UUIDs, cannot be swapped. The query roots `owned_events(owner)` and `owned_tasks(owner)` apply the filter before any other clause. The gap [ADR-0041](0041-per-user-data-ownership.md) feared is now narrow: someone would have to write a new query on `events::table` or `tasks::table` outside `queries.rs`, which is a visible act that review checks for. It is no longer a silent omission.

The value model of [ADR-0041](0041-per-user-data-ownership.md) is unchanged: every event and task has one owner, and nothing crosses users. The conventions below restate the parts of it that still stand, so [ADR-0041](0041-per-user-data-ownership.md) can be superseded whole.

### Row-level security stays a second layer for later

Row-level security is not adopted now, for the reasons rated above (D2, D4). Nothing in this decision rules it out:

* `owner_id` is the column a policy would check.
* `calendar_app` does not own the tables and is never granted `BYPASSRLS`, so a policy would bind it without `FORCE ROW LEVEL SECURITY`.
* `calendar_migrator`, as owner, bypasses policies unless they are forced ([ADR-0052](0052-diesel-data-access-with-embedded-sql-migrations.md)).

Adopting it would mean wrapping every request's statements in a transaction that calls `set_config('app.owner_id', …, true)`, plus a policy that matches nothing when the setting is empty. Re-decide it in its own ADR before the first of these: sharing between users, a non-browser client with its own identity, or a background job that reads across users. Each of them changes who the "current user" is. The trigger is carried over from [ADR-0041](0041-per-user-data-ownership.md) and recorded here and in the pull request template checklist, which now points to this record.

### Conventions

* **Owner type.** `calendar_infrastructure::OwnerId(Uuid)` (`ownership.rs`) is the owner of a repository call. It is built only from the signed-in user's id in the session `Principal` (`calendar-api/src/auth.rs`), never from the request.
* **Query roots.** Every event and task read, update and delete starts from `queries::owned_events(owner)` or `queries::owned_tasks(owner)` (`queries.rs`), and the agenda and task-list fragments (`queries/agenda.rs`, `queries/task_list.rs`) narrow those roots. Application code does not query `events::table` or `tasks::table` directly outside `queries.rs`. The exceptions are the inserts in `events.rs` and `tasks.rs`, which write `owner_id` from the `OwnerId` (next bullet). Application code also uses no `diesel::sql_query` or raw client on those tables.
* **Owner on insert.** `events::insert` and `tasks::insert` refuse an entity whose owner is not the call's `OwnerId` (`Error::OwnerMismatch`) before anything is sent. Batch writes (`tasks::write_batch`, `apply_to_open_overdue`) take the `OwnerId` and filter through the same roots.
* **Carried over from [ADR-0041](0041-per-user-data-ownership.md), unchanged:**
  * the `users` table and its identity key (Google `sub`, email lower-cased and refreshed at each sign-in) and lookup order (`users.rs`);
  * the legacy placeholder owner, claimed by the first allow-listed email;
  * non-null `owner_id` foreign keys on `events` and `tasks` with `ON DELETE RESTRICT`, with `owner_id` leading the task B-tree indexes and the GiST range indexes kept single-column (a composite GiST with a uuid needs the `btree_gist` extension, which Azure Flexible Server enables only through its extension allow-list);
  * a session without the user id rejected with 401 and its cookie cleared ([ADR-0056](0056-session-cookie-sealed-with-a-database-held-key.md));
  * another user's id answering 404, or `notFound` in a bulk result, not 403.
* **Least privilege.** The API connects as `calendar_app`, which has data rights only; migrations run only as `calendar_migrator` ([ADR-0052](0052-diesel-data-access-with-embedded-sql-migrations.md)).

### Consequences

* Good, because the record now says what the code does, and the guidance that cites it (`AGENTS.md`, `backend/AGENTS.md`, the `security-reviewer` agent) no longer has to explain the difference.
* Good, because the compiler enforces the parameter: a new repository function cannot reach the shared query roots without an owner.
* Good, because each query shows its owner at the call site, so a reader and a reviewer see the scoping without knowing about a filter defined somewhere else.
* Bad, because the filter on the roots is a convention: a direct `events::table` query outside `queries.rs` compiles. Only review catches it (the `backend/AGENTS.md` rule and the `security-reviewer` agent), backed by the per-endpoint tests.
* Bad, because isolation is enforced by one layer until row-level security is adopted (see above).
* Neutral, because cross-user code, such as a future job, has to construct an `OwnerId` per user deliberately. There is no "no user" context that silently sees nothing or everything.

### Confirmation

* `backend/crates/calendar-api/tests/api/ownership.rs` acts as two users and asserts, per endpoint, that each sees only their own rows (day and week agendas, every task-list view) and that the other user's ids answer 404 or `notFound` (read, update, delete, complete, reopen, bulk by ids and by filter). It also asserts that created rows belong to the caller, and that an insert for another owner fails with `Error::OwnerMismatch`.
* The infrastructure tests (`calendar-infrastructure/tests/`) assert the non-null owner columns, the foreign keys and the index definitions.
* Review: `backend/AGENTS.md` ("Ownership is a parameter, not a filter you remember") and the `security-reviewer` agent flag any query on `events::table` or `tasks::table` outside `queries.rs` other than the two inserts, any `sql_query` or raw client on those tables, and any `OwnerId` built from anything but the session's user.

## Pros and Cons of the Options

### A typed `OwnerId` parameter on every repository function, with queries started from owner-filtered roots

* Good, because **D1 Isolation by default**: a repository call cannot compile without an `OwnerId`, and the roots apply the owner filter first, so every query built from them is scoped.
* Bad, because **D1 Isolation by default**: the roots are a convention. A new query written on `events::table` outside `queries.rs` is not scoped and still compiles, and only review and the tests catch it. That is why it gets two stars and not three.
* Good, because **D2 Operational simplicity**: nothing beyond Diesel and the existing column, the same locally, in Testcontainers and on Azure.
* Good, because **D3 Query performance**: the predicate is an equality on an indexed column inside the same SQL, so the partial B-trees with `owner_id` leading still apply and the GiST overlap still narrows events.
* Good, because **D4 Fit with the pooled connection and transactions**: no session state on the connection, so nothing leaks between pooled uses, and the agenda snapshot and single-statement writes stay as they are.
* Good, because **D5 Testability**: the existing two-user API tests cover every endpoint, and a failure points to the one function that built the query.
* Good, because **D6 Rust and Diesel ecosystem**: a newtype parameter and boxed query fragments are plain Rust and plain Diesel 2.

### A connection type that carries the owner and exposes only owner-filtered queries

A wrapper around `AsyncPgConnection` that holds the owner and only hands out `owned_events` / `owned_tasks`, which emulates the EF Core filter.

* Good, because **D1 Isolation by default**: code holding the wrapper has no way to name the owner wrongly.
* Bad, because **D1 Isolation by default**: code can still reach the inner connection or `events::table`, so the gap is the same as the chosen option's.
* Good, because **D2 Operational simplicity** and **D3 Query performance**: the same SQL as the chosen option.
* Neutral, because **D4 Fit with the pooled connection and transactions**: the wrapper must forward transactions (`build_transaction().read_only()`) and pooled checkout, which is more code to keep right.
* Neutral, because **D5 Testability**: the same tests apply.
* Bad, because **D6 Rust and Diesel ecosystem**: a home-grown abstraction over Diesel's connection traits, which Diesel does not provide and reviewers would have to learn. It also hides the owner from the call site.

### PostgreSQL row-level security with a per-transaction setting

* Good, because **D1 Isolation by default**: the database enforces the policy on every statement, whatever the application does, including raw SQL.
* Bad, because **D2 Operational simplicity**: policies on both tables, a setting read with `current_setting()`, and role attributes (`BYPASSRLS`) that must never be granted to `calendar_app`.
* Neutral, because **D3 Query performance**: the policy predicate is the same equality, but the planner sees it as a policy qual behind a `current_setting()` cast.
* Bad, because **D4 Fit with the pooled connection and transactions**: `set_config(…, true)` lasts only for one transaction, so every request's statements, including today's single-statement writes, must run inside one. A session-level setting would leak to the next user of a pooled connection.
* Neutral, because **D5 Testability**: tests must run inside transactions that set the owner, and the migrator (the table owner) bypasses the policies unless they are forced.
* Neutral, because **D6 Rust and Diesel ecosystem**: documented PostgreSQL behaviour, but Diesel has no support for it, and it has known pitfalls (owner bypass, pooling, empty settings).

### A typed `OwnerId` parameter plus row-level security (defence in depth)

* Good, because **D1 Isolation by default**: two independent layers. A query that skips the roots is still stopped by the policy.
* Bad, because **D2 Operational simplicity** and **D4 Fit with the pooled connection and transactions**: every cost of row-level security, on top of the parameter.
* Neutral, because **D3 Query performance**: as for row-level security alone.
* Bad, because **D5 Testability**: two mechanisms to keep in agreement, and a failing test does not say which one is wrong without more setup.
* Neutral, because **D6 Rust and Diesel ecosystem**: each layer is idiomatic on its own, but together they are more to learn.

## More Information

* **Supersedes** [ADR-0041](0041-per-user-data-ownership.md). Its value model (one owner per row, nothing crosses users) and the conventions restated above still stand. Its mechanism, the EF Core global query filter, ended with the .NET backend ([ADR-0051](0051-rust-backend-on-axum-and-tokio.md), [ADR-0052](0052-diesel-data-access-with-embedded-sql-migrations.md)).
* **Related:** [ADR-0027](0027-google-oidc-bff-session.md) (sign-in and the allow-list), [ADR-0056](0056-session-cookie-sealed-with-a-database-held-key.md) (the session that carries the user id), [ADR-0020](0020-aggregate-day-agenda-endpoint-as-read-model.md) (the read-only agenda snapshot), [ADR-0014](0014-postgresql-database-engine.md) (the engine and its roles). Story [0017](../stories/0017-per-user-calendar-ownership.md) delivered ownership. Issue #938 tracks this record.
* PostgreSQL row-level security (<https://www.postgresql.org/docs/current/ddl-rowsecurity.html>, as cited in [ADR-0041](0041-per-user-data-ownership.md) on 2026-11-02): table owners bypass policies unless `FORCE ROW LEVEL SECURITY` is set; superusers and `BYPASSRLS` roles always bypass them. `set_config(name, value, true)` lasts until the end of the current transaction (<https://www.postgresql.org/docs/current/functions-admin.html>).
* Versions at the time of writing (`backend/Cargo.lock`): diesel 2.3.14, diesel-async 0.9.2, deadpool 0.13.1, axum 0.8.9.
* **Revisit triggers:** see "Row-level security stays a second layer for later". They are also in `.github/pull_request_template.md`.
