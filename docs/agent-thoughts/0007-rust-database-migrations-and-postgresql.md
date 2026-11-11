---
date: "2026-11-11"
author: "Codex (GPT-6)"
revision: "fc65d248c5d04b5a0f061177a03360886f19a393"
---

# 0007 Rust database migrations, from one familiar command to three different approaches

*Written on 11 November 2026 by Codex, based on revision `fc65d248c5d04b5a0f061177a03360886f19a393`. The maintainer asked whether Rust has equivalents to our .NET database migrations, what would change beneath `just`, and how SQLx, Diesel and SeaORM compare in community, power and abstraction. They then asked for an objective article for human readers. I inspected the repository's migration recipes, EF configuration and backend guidance, and consulted the primary documentation linked below. I have not implemented a Rust backend, executed these Rust commands or benchmarked the alternatives. Community descriptions are interpretations of public project material, not measurements of support quality. This article records an exploration; it does not propose replacing the accepted backend architecture.*

Imagine adding a priority field to a task. It sounds small: one column, one Rust field, perhaps one new sort order. Yet that little change asks several different systems to agree. The database must store the value, the application must understand it, existing tasks need sensible treatment, and the next deployment must know whether the column already exists.

In Calendar today, Entity Framework Core helps coordinate those jobs. Rust has tools for them too. The interesting difference is where each tool puts the boundary between what we write and what it derives for us.

That boundary matters more than whether a project describes itself as an ORM. We can keep a familiar command such as `just db migrate` while changing almost everything underneath it.

## What our current command actually does

Calendar's [data-access decision](../decisions/0015-ef-core-data-access.md) chooses EF Core with migrations. In `db.just`, the local migration recipe changes into `backend`, restores the .NET tools, sets `CALENDAR_MIGRATOR_CONNECTION`, and calls:

```sh
dotnet ef database update --project src/Calendar.Infrastructure
```

The migrations live in `backend/src/Calendar.Infrastructure/Migrations`. EF records which migrations a database has received and applies the pending ones. The application connects as `calendar_app`; migration commands connect as the more privileged `calendar_migrator`. Schema changes run explicitly, rather than during application startup.

There are two distinct capabilities here. **Migration execution** means applying a versioned sequence of changes and tracking progress. **Migration generation** means inspecting a model change and producing the next change in that sequence. EF gives us both: its model snapshot helps generate migrations, and our backend lint recipe checks for model changes missing a migration.

This is why “Rust has migrations” is a useful answer but an incomplete comparison. We also need to ask what describes the intended schema, what generates the change, and what checks agreement afterwards.

The database itself is another boundary. PostgreSQL, the Compose service, and the two-role arrangement do not depend on C#. Our `just db up`, `down`, `reset` and `psql` recipes could retain their behavior under any of the three options. Here, `down` means stopping Compose; it is separate from a migration's reverse operation, which is also often called “down.”

## SQLx: the schema change is SQL

SQLx puts SQL at the center of database access. Its [project documentation](https://github.com/transact-rs/sqlx/blob/main/README.md) describes an asynchronous SQL toolkit rather than an ORM. Application queries use SQL and map their results into Rust values. Optional checked query macros validate statements using database schema information; ordinary runtime queries do not gain that check automatically.

A conventional migration workflow would look like this:

```sh
sqlx migrate add -r add_task_priority
# Edit the generated up and down SQL files.
just db migrate
```

Underneath `just db migrate`, we would set a migrator connection URL and run `sqlx migrate run` from the chosen migration directory. The CLI tracks applied migrations and checks migration integrity. SQLx can also embed migrations in a Rust executable. Either packaging style can preserve our explicit deployment step. These are documented in the [SQLx CLI guide](https://github.com/transact-rs/sqlx/blob/main/sqlx-cli/README.md).

For Calendar, the repository changes would include a pinned CLI or migration executable, SQL migration files, Rust connection configuration, and a replacement for EF's snapshot check. If we adopted checked query macros, we would also establish how their schema metadata is prepared and checked in CI, including offline builds.

The benefit is direct correspondence between a reviewed migration and the SQL PostgreSQL executes. The responsibility is equally direct: we write the schema changes, including defaults, data transformations and reverse operations where appropriate. A changed Rust struct does not itself produce a migration.

## Diesel: describe queries through Rust's types

Diesel combines an ORM and a typed query builder. Its usual workflow includes SQL migrations, Rust model structs, and `schema.rs`, which describes database tables to the query builder. The [getting-started guide](https://diesel.rs/guides/getting-started) demonstrates the basic loop:

```sh
diesel migration generate add_task_priority
# Edit up.sql and down.sql.
just db migrate
```

Our recipe would set the migrator connection URL and call `diesel migration run`. We would add CLI configuration and a migration directory. Diesel can regenerate `schema.rs` after applying migrations when configured to do so; application structs and queries must then agree with the changed schema. See the [CLI configuration guide](https://diesel.rs/guides/configuring-diesel-cli.html).

There is an important qualification to “you write the SQL yourself.” Diesel also supports generating migrations by comparing an edited `schema.rs` with a database, introduced in its [2.1 release](https://diesel.rs/news/2_1_0_release.html):

```sh
diesel migration generate add_task_priority --diff-schema
```

That is useful generation support, but the inputs differ from EF's entity model and saved snapshot. We would need to verify its coverage for our actual schema objects rather than assume it reproduces every PostgreSQL detail. Data migrations still require deliberate application knowledge.

The distinctive investment is learning how queries compose through Diesel's traits and types. Compiler checks can catch invalid query combinations, but complicated queries can also produce complicated Rust types. A reasonable evaluation would include how easily maintainers can read, change and diagnose those queries, alongside what the compiler catches.

## SeaORM: entities and relationships at the center

SeaORM provides a higher-level application API built around entities, relationships and active models. Its [project overview](https://github.com/SeaQL/sea-orm) covers that broader ORM surface. A conventional explicit-migration setup uses a separate Rust migration crate with forward and reverse methods, written with schema builders or SQL.

Our execution path could be:

```sh
# DATABASE_URL is set to the migrator connection for this process.
cargo run --locked --manifest-path migration/Cargo.toml -- up
```

That is an illustrative path, assuming a crate named `migration` at the working directory. SeaORM documents both direct execution and CLI-driven commands in its [migration execution guide](https://www.sea-ql.org/SeaORM/docs/migration/running-migration/).

We would replace EF migration classes with Rust migration modules, package that runner for deployment, and use SeaORM entities and queries in the application. Database-first entity generation can help keep the application's schema representation aligned with the database.

Writing migration methods in Rust may feel familiar to someone reading EF migration classes. It does not, by itself, imply EF's model-diff workflow. SeaORM 2.0 also documents an [entity-first workflow](https://www.sea-ql.org/SeaORM/docs/generate-entity/entity-first/) that compares entities with the live schema and synchronizes supported changes. That is genuine schema automation, though its coverage and deployment model differ from EF snapshot-generated migrations. Its startup-sync examples would need adapting to our separate migrator step; versioned upgrades and data transformations would still need a deliberate process. Code syntax, schema synchronization and safe versioned upgrades are separate questions.

## How high is each abstraction?

For everyday application access, the broad ordering is SQLx, then Diesel, then SeaORM. That describes the normal APIs, not a hierarchy of quality.

| Question | SQLx | Diesel | SeaORM |
| --- | --- | --- | --- |
| What do I usually write? | SQL and Rust result types | Typed Rust query expressions | Entity operations and relationship queries |
| What stays most visible? | The database statement | The typed query structure | The application's entity model |
| What do I maintain? | SQL, result mappings and migration SQL | Schema definitions, model structs and query expressions | Entities, relationships and migration definitions |
| What deserves an early experiment? | Query metadata and result mapping workflow | Complex query composition and compiler diagnostics | Generated query shapes and PostgreSQL-specific escape paths |

Higher abstraction can remove repetitive application code. It also asks us to understand the translation beneath the API when behavior or performance surprises us. Lower abstraction exposes more SQL directly, while leaving more mapping and composition work with the application. Different teams may find either arrangement easier to maintain.

None of these descriptions makes the tools drop-in replacements for EF's change tracking, concurrency handling or migration checks. Those behaviors need an explicit inventory.

## “Most powerful” has several meanings

If power means expressing an exact PostgreSQL statement, direct SQL makes that expression straightforward. SQLx's checked macros let the database validate supported SQL rather than requiring SQLx to reproduce PostgreSQL's entire grammar. That does not mean another library cannot execute the same statement.

If power means composing database queries with Rust's type system enforcing constraints, Diesel makes that a central feature. If it means expressing common entity and relationship operations with less application plumbing, SeaORM provides the highest-level surface of these three.

All three have raw SQL escape paths. The practical distinction is how much of a workload fits naturally within the main API and how much supporting code is needed around the exceptions. A raw query can preserve database expressiveness while giving up some guarantees of the surrounding query builder.

These are different kinds of capability. They do not establish a performance winner. Query plans, round trips, loading behavior, connection management and actual data distributions matter more than the position of a library in an abstraction table.

## Can Diesel keep our PostgreSQL behavior?

Yes. Our earlier discussion initially gave too little credit to Diesel's built-in PostgreSQL support. Choosing its typed query builder would not require abandoning ranges, PostgreSQL indexing or database-side time-zone logic.

Calendar stores generated half-open ranges for events: `tstzrange` for timed spans and `daterange` for all-day spans. It uses GiST indexes and range operators to find overlaps. Diesel provides range expressions including `overlaps_with` for `&&`, `contains` for element containment, and `contains_range` for range containment. See [its range API](https://docs.diesel.rs/2.3.x/diesel/prelude/trait.PgRangeExpressionMethods.html).

| Calendar behavior | Diesel implementation route |
| --- | --- |
| Generated range columns, GiST and partial indexes | Preserve the PostgreSQL definitions in SQL migrations |
| Range overlap and containment predicates | Built-in PostgreSQL range expressions |
| Database-side time-zone conversion | Built-in `at_time_zone`, with casts or custom expressions as needed |
| Disjoint task queries combined with `UNION ALL` | Built-in `union_all` |
| One read-only snapshot for agenda reads | A transaction with the appropriate isolation and read-only settings |
| Keyset pagination | Explicit ordering, seek comparisons, null handling and limits |
| Restricted runtime role and elevated migration role | Keep the PostgreSQL roles and grants |

The relevant APIs include [timestamp expressions](https://docs.diesel.rs/2.3.x/diesel/prelude/trait.PgTimestampExpressionMethods.html), [set operations](https://docs.diesel.rs/2.3.x/diesel/query_dsl/trait.CombineDsl.html), and [PostgreSQL transaction configuration](https://docs.diesel.rs/2.3.x/diesel/pg/struct.TransactionBuilder.html).

There is still real porting work. Generated columns must remain excluded from application writes. Nullable range values, dates, time zones and parameter types must map correctly. Our optimistic concurrency behavior uses PostgreSQL's `xmin`; a Rust implementation must explicitly preserve the version check and the handling of an update that affects no rows. Merely connecting through Diesel does not reproduce EF's concurrency behavior.

For unsupported expressions, Diesel permits custom typed SQL functions and full SQL queries. Full SQL results can use `QueryableByName`, but Diesel cannot then validate the complete statement and declared result types as it can with its typed builder. See [function declarations](https://docs.diesel.rs/2.3.x/diesel_derives/index.html) and [raw result mapping](https://docs.diesel.rs/2.2.x/diesel/prelude/derive.QueryableByName.html).

Feature support makes the implementation feasible. Equivalent results and execution plans would still need tests and measurements, especially around daylight-saving transitions, nulls and pagination ties. The same standard applies to SQLx and SeaORM.

## What the communities offer

The available project material suggests three overlapping interests rather than three isolated camps.

SQLx's examples and [ecosystem links](https://github.com/transact-rs/sqlx) present an async, SQL-oriented approach, including integrations with web frameworks and higher-level database libraries. A reader comfortable reasoning in SQL will recognize that starting point. This observation describes the materials; it does not establish that SQLx has the largest community or the fastest support.

Diesel's [project organization](https://github.com/diesel-rs) includes the core library and `diesel_async`. Its guides emphasize typed queries, schema representation and extension points. The surrounding material is particularly relevant when the question is how to express a database operation within Rust's type system. An async backend would need to choose an async integration or an appropriate blocking-execution strategy deliberately.

SeaORM's [community catalogue](https://github.com/SeaQL/sea-orm/blob/master/COMMUNITY.md) includes application frameworks, scaffolding and administrative tools. Related projects include [Seaography](https://github.com/SeaQL/seaography), which integrates entities with GraphQL. That makes application assembly a visible part of its ecosystem, though an integration's existence says little about whether Calendar needs it.

These are qualitative readings, not a community health survey. Stars, download counts and commit totals measure different things and can mislead. A serious adoption review would examine recent releases, maintenance of the exact PostgreSQL features we need, representative issue responses, upgrade guides and dependency compatibility. It would also ask a human question: when someone on this team gets stuck, which documentation and examples help them recover?

## The work around the library

The small recipe change should not hide the transition work. Each option needs Rust toolchain and dependency pins, a deployment artifact for migrations, connection settings and tests. PostgreSQL URLs also need correct credential encoding; pasting an arbitrary password into a URL is not sufficient.

Existing databases need a migration-history plan. An EF history table does not become a SQLx, Diesel or SeaORM history table simply because the schema is correct. We could retain EF's historical chain and hand over future changes at a documented boundary, or establish a reviewed baseline with a deliberate adoption procedure. Either approach must distinguish a fresh database from an existing one so the new runner does not try to recreate populated tables.

A runner change could happen independently of a complete backend rewrite, but that would leave EF's model and the new migration source needing an agreement check. Replacing the whole backend adds a much larger task: porting domain rules, queries, authentication, API contracts and tests. The Rust database library settles only part of that design.

CI would need to replace EF's pending-model check with checks appropriate to the chosen workflow. At minimum, we would want evidence that a fresh database can be created, a representative existing database can be upgraded, queries work with the migrated schema, and the application's role has the intended permissions. Query compilation alone cannot prove the completeness of migrations or the correctness of calendar semantics.

A useful comparison exercise would implement the same small slice three times: a task change with optimistic concurrency, a range-overlap read, and the overdue-task query with its partial-index-friendly branches. Review the migration, Rust code, diagnostics and query plans together. Such an exercise would supply evidence about this workload without pretending to evaluate an entire ecosystem.

The familiar command can survive all three approaches. What changes is the conversation beneath it: whether we describe the database primarily in SQL, in typed query expressions, or through entities and relationships. Understanding that difference gives a maintainer a fairer basis for asking the next question, whichever direction the project eventually takes.
