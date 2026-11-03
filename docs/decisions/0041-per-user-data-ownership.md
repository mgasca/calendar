---
status: proposed
date: 2026-11-02
decision-makers: mgasca, Claude (AI assistant)
---

# Per-user data ownership: scope every query and write with an EF Core global query filter keyed by the signed-in user

## Context and Problem Statement

[ADR-0027](0027-google-oidc-bff-session.md) put Google sign-in and an email allow-list in front of the API, but every allowed account still reads and writes the same `events` and `tasks` rows: there is no owner column and no per-user scoping. [ADR-0019](0019-single-user-mode-with-authentication-deferred.md) left a retrofit plan for this moment, and [ADR-0027](0027-google-oidc-bff-session.md) requires it before a second user is supported. Story [0017](../stories/0017-per-user-calendar-ownership.md) delivers that plan: a `users` table that the sign-in callback resolves, and a non-null `owner_id` on `events` and `tasks` (both are conventions below, not alternatives). How should the API make sure that no query or write on those tables ever crosses users?

## Decision Drivers

* **D1 Isolation by default**: a forgotten predicate in a new endpoint or query must not leak another user's rows. The API never accepts a user identifier from the client ([ADR-0019](0019-single-user-mode-with-authentication-deferred.md) retrofit plan).
* **D2 Operational simplicity**: no new backing service, database extension or server parameter; it must work with the local Compose database, Testcontainers and Azure Flexible Server as they are ([ADR-0031](0031-azure-postgresql-flexible-server.md), [ADR-0016](0016-local-database-provisioning.md)).
* **D3 Query performance**: the agenda and task-list queries keep using their indexes (GiST ranges, partial B-trees) after the owner predicate is added, measured with `EXPLAIN (ANALYZE, BUFFERS)` as the backend practice requires.
* **D4 Retrofit safety**: rows that exist before the change get a non-null owner without the migration knowing the allow-list, and nothing is lost or exposed in the transition.
* **D5 Testability**: cross-user isolation can be asserted per endpoint in the existing API test setup (fake authentication scheme, Testcontainers PostgreSQL).
* **D6 AI-agent proficiency & ecosystem**: mainstream, well-documented EF Core and ASP.NET Core patterns that agents and reviewers recognise.

## Considered Options

* EF Core global query filter keyed by the signed-in user, owner set on insert
* An explicit owner predicate in every endpoint query
* PostgreSQL row-level security with a per-transaction session variable
* Global query filter plus row-level security (defence in depth)

## Decision Outcome

Chosen option: "EF Core global query filter keyed by the signed-in user, owner set on insert", because it makes isolation the default for every read, count, set-based update and delete (D1) with nothing beyond EF Core and a column (D2), keeps the owner predicate inside the same SQL the indexes already serve (D3), and is asserted by ordinary API tests (D5).

| Driver | **Global query filter (chosen)** | Explicit predicate per query | Row-level security alone | Filter + row-level security |
| --- | :---: | :---: | :---: | :---: |
| D1 Isolation by default | ★★★ | ★☆☆ | ★★★ | ★★★ |
| D2 Operational simplicity | ★★★ | ★★★ | ★☆☆ | ★☆☆ |
| D3 Query performance | ★★★ | ★★★ | ★★☆ | ★★☆ |
| D4 Retrofit safety | ★★★ | ★★★ | ★★☆ | ★★☆ |
| D5 Testability | ★★★ | ★★☆ | ★★☆ | ★☆☆ |
| D6 AI-agent proficiency & ecosystem | ★★★ | ★★★ | ★★☆ | ★☆☆ |

### Row-level security stays a second layer for later

PostgreSQL row-level security is not adopted now, but nothing in this decision prevents it: `owner_id` is the column a policy would check, the application role `calendar_app` does not own the tables (so policies would bind it without `FORCE ROW LEVEL SECURITY`) and is never granted `BYPASSRLS`, and the migrator, as owner, bypasses policies unless forced. Adopting it means a `SET LOCAL` of the user id per transaction under Npgsql pooling and a policy that tolerates an empty setting. Re-decide it, in its own ADR, before the first of: sharing between users, a non-browser client with its own identity, or a background job that reads across users. The trigger is recorded here and in the pull request template checklist, where it replaces the shared-data item from [ADR-0027](0027-google-oidc-bff-session.md).

### Implementation conventions

* **Identity key.** A `users` table holds one row per person: `id` (uuid, the owner key), `google_subject` (Google's `sub` claim, unique; null only on the legacy placeholder and on rows the Development seed scheme created, until a real sign-in fills it in), `email` (lower-cased, unique), display name, picture URL, `created_at` and `last_signed_in_at`. `sub` is the identity key because Google documents it as unique, never reused and unchanged when the account's email changes; email is refreshed at every sign-in and is still what the allow-list checks ([ADR-0027](0027-google-oidc-bff-session.md)).
* **One lookup order for sign-in and seeding.** A user is found by `sub`; failing that, by lower-cased email among rows that have no subject yet; failing that, if the email is the first in `Auth__AllowedEmails`, the unclaimed legacy placeholder (no subject, no email); otherwise a row is created. A real sign-in fills in the subject of a matched row that has none; the seed scheme never sets a subject.
* **Owner column.** `events.owner_id` and `tasks.owner_id` are non-null uuid foreign keys to `users.id` with `ON DELETE RESTRICT`. The domain factories take the owner id, so a caller cannot omit it. `owner_id` leads the B-tree indexes the task queries use (due date, due instant, completed at, open-task partial indexes). The GiST indexes on `events.span` and `events.date_span` stay single-column: a composite GiST with a uuid needs the `btree_gist` extension, which Azure Flexible Server only enables through the `azure.extensions` allow-list, and with a handful of users the range overlap is the selective predicate. The plans are measured in the delivering PR.
* **Current user and filter.** The sign-in callback resolves or creates the user and adds its id to the cookie principal as a claim. A scoped current-user service reads that claim and is injected into `CalendarDbContext`, which applies `HasQueryFilter(x => x.OwnerId == CurrentUserId)` to events and tasks, where `CurrentUserId` is a property of the context instance. The filter must reference the context instance, never a value copied out during `OnModelCreating`: the model is built once and cached per context type, and only a reference to the instance is re-evaluated per query, so each context gets its own user. With no user the filter matches nothing, and the context then accepts inserts for any owner (a context with a user refuses to save an added event or task owned by anyone else). That is how tests and tooling arrange data: the migrator context has no user, inserts rows for several users, and reads them back only with an explicit `IgnoreQueryFilters()`. Neither overload of `IgnoreQueryFilters` is used in application code (`backend/src`).
* **Legacy owner.** The ownership migration inserts one placeholder user with a fixed id (`User.LegacyOwnerId`) and backfills every existing event and task to it. The first sign-in (or seed run) by the first email in `Auth__AllowedEmails` claims that row through the lookup order above while it is still unclaimed; every other account gets a new row. Seeded rows and pre-migration rows therefore share an owner.
* **Sessions.** A cookie principal without the user-id claim is rejected and signed out (401 to API callers), so sessions issued before the change end once. No per-request user lookup for cookie sessions; the Development seed scheme, which has no cookie, resolves its user on each request and fails with a clear message when the allow-list is empty.
* **Not found, not forbidden.** Another user's event or task id answers 404 (or `notFound` in a bulk result), so the API does not confirm that the id exists.

### Consequences

* Good, because every existing and future query on events and tasks is scoped without touching call sites, including `ExecuteUpdate`, `ExecuteDelete`, counts and the `Concat` branches of the overdue query.
* Good, because the schema change is a table, two columns, a backfill and index rebuilds; no server parameter, extension or role change.
* Bad, because the filter lives in application code: a context created without a current user (tooling, a future background job) sees no rows rather than all rows, and code that needs cross-user access must say so explicitly.
* Bad, because isolation is enforced by one layer until row-level security is adopted (see above).
* Neutral, because rows of a person removed from the allow-list stay in the database, owned and invisible; removing users is a separate story.

### Confirmation

* API tests act as two users and assert, per endpoint, that each sees only its own rows and that the other's ids answer 404 or `notFound`.
* A migration test applies the migrations up to the one before ownership, inserts rows, migrates forward and asserts the legacy owner; a sign-in test asserts the claim.
* A schema test asserts the non-null columns, the foreign keys and the index definitions; the delivering PR records `EXPLAIN (ANALYZE, BUFFERS)` plans before and after on about 100k rows.
* Code review checks that no application query calls `IgnoreQueryFilters` (either overload) or runs raw SQL against `events` or `tasks` (`Database.ExecuteSql*`, `SqlQuery`), which the filter does not cover, and that no endpoint takes a user identifier from the request.

## Pros and Cons of the Options

### EF Core global query filter keyed by the signed-in user, owner set on insert

* Good, because **D1 Isolation by default**: the filter is part of the model, so every LINQ query, count and set-based operation on the entity carries the owner predicate.
* Good, because **D2 Operational simplicity**: nothing outside EF Core and the schema; works identically locally, in Testcontainers and on Azure.
* Good, because **D3 Query performance**: the owner predicate is an equality on an indexed column inside the same SQL, so partial B-trees with `owner_id` leading apply and the GiST overlap still narrows events.
* Good, because **D4 Retrofit safety**: the backfill is one SQL statement to a placeholder user, and the filter makes pre-migration rows invisible to everyone until the placeholder is claimed.
* Good, because **D5 Testability**: two fake users in the existing `WebApplicationFactory` setup cover every endpoint.
* Good, because **D6 AI-agent proficiency & ecosystem**: `HasQueryFilter` is the documented EF Core pattern for soft delete and multi-tenancy.
* Bad, because **D1 Isolation by default**: the filter is only as good as the current-user resolution; a context without a user must fail closed (no rows), which this decision requires.

### An explicit owner predicate in every endpoint query

* Good, because **D2 Operational simplicity** and **D6 AI-agent proficiency & ecosystem**: plain `Where` clauses, visible at each call site.
* Good, because **D3 Query performance** and **D4 Retrofit safety**: the same SQL and the same backfill as the chosen option.
* Neutral, because **D5 Testability**: the same tests apply, but they are the only thing that catches an omitted predicate.
* Bad, because **D1 Isolation by default**: a new query that forgets the predicate leaks silently; [ADR-0019](0019-single-user-mode-with-authentication-deferred.md) warned that queries that "work" without scoping are easy to copy.

### PostgreSQL row-level security with a per-transaction session variable

* Good, because **D1 Isolation by default**: the database enforces the policy on every statement, whatever the application does.
* Bad, because **D2 Operational simplicity**: a `SET LOCAL` on every transaction through Npgsql pooling, a policy that tolerates the empty string the setting becomes after a transaction, and role attributes (`BYPASSRLS`) that must never be granted to `calendar_app`.
* Neutral, because **D3 Query performance**: the policy predicate is the same equality, but the planner evaluates it as a policy qual, and `current_setting()` casts add a step.
* Neutral, because **D4 Retrofit safety**: the backfill is the same, but the policy and the owner bypass (the migrator, as owner, is not subject to it unless forced) must be tested at the same time.
* Neutral, because **D5 Testability**: tests must run inside transactions that set the variable; the migrator context (table owner) bypasses the policies unless forced.
* Neutral, because **D6 AI-agent proficiency & ecosystem**: documented, but with known footguns (owner bypass, pooling, empty settings).

### Global query filter plus row-level security (defence in depth)

* Good, because **D1 Isolation by default**: two independent layers.
* Bad, because **D2 Operational simplicity**: every cost of row-level security on top of the filter.
* Neutral, because **D3 Query performance** and **D4 Retrofit safety**: as for row-level security alone.
* Bad, because **D5 Testability** and **D6 AI-agent proficiency & ecosystem**: two mechanisms to keep in agreement, and a failing test cannot say which one is wrong without more setup.

## More Information

* Delivers the retrofit plan of [ADR-0019](0019-single-user-mode-with-authentication-deferred.md) and the "add both before a second user" follow-up of [ADR-0027](0027-google-oidc-bff-session.md). Data access per [ADR-0015](0015-ef-core-data-access.md); the database engine and its roles per [ADR-0014](0014-postgresql-database-engine.md), kept in force by [ADR-0037](0037-postgresql-only-no-sqlite-fallback.md), and the hosted server per [ADR-0031](0031-azure-postgresql-flexible-server.md).
* [ADR-0027](0027-google-oidc-bff-session.md) keeps the authentication decision. A note in its More Information section records that this ADR delivers its ownership follow-up (the bearer-scheme follow-up stays open, issue #84). The delivering PR makes the README limitations paragraph and the pull request template checklist stop saying that allowed accounts share data.
* Google's OpenID Connect guide (<https://developers.google.com/identity/openid-connect/openid-connect>, "An ID token's payload", checked 2026-11-02) says `sub` is "unique among all Google Accounts and never reused" and that a Google Account "can have multiple email addresses at different points in time, but the `sub` value is never changed".
* Azure Database for PostgreSQL Flexible Server installs only allow-listed extensions (`azure.extensions` server parameter, then `CREATE EXTENSION`); `btree_gist` is on the supported list (<https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-extensions>, checked 2026-11-02).
* PostgreSQL row-level security (<https://www.postgresql.org/docs/current/ddl-rowsecurity.html>, checked 2026-11-02): table owners bypass policies unless `FORCE ROW LEVEL SECURITY` is set; superusers and `BYPASSRLS` roles always bypass; a custom setting read with `current_setting()` is the empty string once the transaction that `SET LOCAL` it has ended.
* Versions at the time of writing: Microsoft.EntityFrameworkCore 10.0.14, Npgsql.EntityFrameworkCore.PostgreSQL 10.0.3, Microsoft.AspNetCore.Authentication.Google 10.0.14 (`backend/Directory.Packages.props`).
* Revisit triggers: see "Row-level security stays a second layer for later"; each of them changes who the "current user" is.
