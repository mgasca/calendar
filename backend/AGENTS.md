# Backend practices

Practices for the .NET backend in `backend/`: tests, queries, indexes and analyzer traps you meet only when editing here. The root `AGENTS.md` still applies and nothing here overrides it. Most of this was learned in the performance review (issues #50–#55, story 0015).

## Running tests

- One project or test: `just backend test --project tests/Calendar.Domain.Tests --filter-method "*MethodName*"` (or `--filter-class`). The recipe runs `dotnet test` in `backend/`, so `global.json` applies (Microsoft.Testing.Platform, xUnit v3), and passes its arguments through.
- API tests use `WebApplicationFactory` with a `FakeTimeProvider` (`ApiTestBase`) and need Docker (Testcontainers PostgreSQL via `Calendar.Testing`, `PostgresTestDatabase`). Their logs, including generated SQL, are printed only for failing tests; to inspect SQL, write it to a file from a throwaway test with `ToQueryString()`.
- `*AgreementTests` assert that the SQL query forms and `DayInclusion` agree. Untranslatable expressions fail only at runtime with a 500, so cover every query shape with an API test.
- RS0030 bans `DateTime.Now`/`UtcNow`/`Today`, `DateTimeOffset.Now`/`UtcNow` and `TimeZoneInfo.Local` in `backend/src`. Use the injected `TimeProvider`.

## Measure queries, don't guess

For any query or index change, seed about 100k realistic rows (history spread over years) in a throwaway Testcontainers test. Run `ANALYZE`, then `EXPLAIN (ANALYZE, BUFFERS)` on the SQL EF actually generates (`ToQueryString()`, with parameters inlined as literals). Put the before and after plans in the PR (time and buffers), and don't commit the harness. In #52 the obvious fix (new indexes) changed nothing on its own; only the plan showed it.

## Indexes

- **Partial indexes need an implied predicate**: Postgres uses `WHERE completed_at IS NULL` only if the query's condition implies it. A single `completed_at IS NULL OR completed_at in [S, E)` defeats it and falls back to a seq scan. Split the OR into disjoint branches combined with EF `Concat` (`UNION ALL`, so no duplicates), each matching its own index (`AgendaQueries.OverdueFor`).
- **Overlap lookups use ranges + GiST**: a B-tree on `(start, end)` can't narrow `start < X AND end > Y`, because the first condition matches every past row. Store a generated half-open range (`tstzrange` for timed events, `daterange` for all-day events, `NULL` otherwise) with a GiST index, and query with `&&` / `@>` through `NpgsqlRangeDbFunctionsExtensions`. See `CalendarEventConfiguration` (`span`, `date_span`).

## Npgsql translation pitfalls

- `TimeZoneInfo.ConvertTimeBySystemTimeZoneId` translates to `AT TIME ZONE` only for a UTC `DateTime`. Pass `dueAt.Value.UtcDateTime`, not the `DateTimeOffset`, and wrap the result in `DateOnly.FromDateTime(...)` to get `::date`.
- `Guid.CompareTo` translates (uuid ordering).

## Keyset pagination (`TaskListQueries`, `TaskListCursor`)

- Do every comparison in SQL, so uuid and collation ordering stay consistent with the `ORDER BY`. Avoid case-insensitive title tie-breakers, which depend on collation.
- Expand the seek predicate by hand around nullable keys. Row-value comparisons with NULLs are wrong.
- Fetch `limit + 1` to decide whether there is a next page.
- Make the cursor opaque (base64url JSON) and tied to its view, and reject a malformed cursor with 400.
- Test paging at limits 1, 2 and 3 with ties at every key, asserting every item appears exactly once and in order.

## "Today" comes from the client (ADR-0021)

Any endpoint that judges overdue or upcoming takes `today` + `timeZone`, validated with `FieldErrors.RequireDate` / `RequireTimeZone`, and marked required in OpenAPI with `RequireQueryParameters` (`Endpoints/OpenApiExtensions.cs`).

## In-memory ordering and bucketing

- Comparers must short-circuit. A `params ReadOnlySpan<int>` "first difference" helper evaluates every key on every comparison.
- Compute expensive keys (time-zone conversions) once per item with `OrderBy(key)`, not inside the comparator.
- When replacing a comparer or a bucketing algorithm, add a randomized test against a copy of the old implementation (heavy ties, case-only title differences, DST dates, a skipped date such as `Pacific/Apia` 2011-12-30) to prove the output is identical (`AgendaOrderTests`, `AgendaBucketingTests`).
- **Range bucketing**: don't test every item against every day. Narrow the candidate days by binary search over the sorted `DayWindow` boundaries, but keep `DayInclusion` as the final arbiter, so the per-day rules keep one implementation.

## Analyzer traps that break the build (warnings are errors)

These apply to the repo tools under `tools/` and `.claude/skills/` too.

- S2699 needs an assertion, even in a scratch test.
- IDE0011 needs braces.
- IDE0005 flags an unused `using` after code moves.
- S8969 flags a redundant `!`.
- Layout (ADR-0036): SA1501 forbids single-line blocks such as `if (y) { Foo(); }`. SA1116/SA1117 require a wrapped parameter or argument list to start on a new line with one item per line. SA1117 still accepts all the items together on the continuation line, so don't write that either. `dotnet format` fixes these.
- S103 caps lines at 140 characters. Nothing fixes it automatically, so wrap long lines by hand (the `post-edit` hook lists them). Split long strings with `+` and long `<summary>` text over several lines; a split summary adds a soft line break to the OpenAPI description, so run `just contracts`.
- IDE0007/IDE0008 want `var` when the type is built in or apparent on the right-hand side, and an explicit type otherwise.
- Every rule in the `Performance` category is a warning, including ones off by default. CA1848 requires `LoggerMessage` source-generated logging methods instead of `logger.LogX(...)` calls.

<!-- throwaway proof for #418, not to be merged -->
