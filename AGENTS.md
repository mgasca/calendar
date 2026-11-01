# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, Cursor, etc.) when working with code in this repository.

## Overview

"Calendar": a monorepo with a .NET 10 backend (`backend/`, solution `Calendar.slnx`) and a pnpm/React/Vite/TypeScript frontend (`frontend/`). The API serves events, tasks, day and week agendas, and Google sign-in (cookie session, allow-listed emails), backed by PostgreSQL. The web app shows day, week and task views. Product stories live in `docs/stories/`. Significant choices are recorded as ADRs in `docs/decisions/`: read the relevant ADR before changing tooling, layout, dependencies or API conventions, and don't contradict an accepted one (supersede it instead).

## Commands

`just` is a thin task runner over native tooling (`just` with no arguments lists the recipes; the minimum version is in `.just-version`). Linux/WSL only.

- `just setup` — `doctor` + restore .NET packages + `pnpm install --frozen-lockfile`
- `just dev-api` (http://localhost:5041) / `just dev-web` (proxies `/api` to the API)
- `just test` — backend + frontend tests; `just lint` — analyzers, `dotnet format --verify-no-changes`, ESLint, tsc, tooling, ADR check; `just check` — everything CI runs
- `just format` — auto-format everything
- `just contracts` — rebuild the API and regenerate `contracts/openapi.json` and the TS client. **Commit the result**; CI fails if the contract is stale.
- `just tooling` / `just adr-check` — test/lint repo tooling; validate ADRs (for example `just adr-check --fix-links` or `just adr-check --next-number`)
- `just db-up` / `db-migrate` / `db-seed` / `db-psql` / `db-reset` / `db-down` — local PostgreSQL via Docker Compose (`compose.yaml`, `.env` from `.env.example`). Migrations are applied only by `db-migrate`, as `calendar_migrator`, never by the app (ADR-0015).
- `just dev-docs` / `build-docs` — the ADR documentation site (`frontend/apps/docs`)
- `just bench-docs` — run the docs benchmark by hand; results are recorded in `docs/benchmarks/` (see its README). Never part of `just test` or CI.

Single tests:
- Backend (run from `backend/` so `global.json` applies; uses Microsoft.Testing.Platform, xUnit v3): `dotnet test --project tests/Calendar.Domain.Tests --filter-method "*MethodName*"` (or `--filter-class`)
- Frontend: `pnpm --dir frontend --filter @calendar/web test -- <file-or-pattern>` (Vitest)

## Architecture

- **Contract-first across stacks**: the backend build generates `contracts/openapi.json`; `frontend/packages/api-client` generates a typed client from it (`schema.gen.ts`, do not hand-edit), shared by all TS UIs. Any new UI should consume the contract, not backend code.
- **Backend**: `Calendar.Domain` (no framework dependencies; time-zone and day rules in `Time/` and `Agenda/DayInclusion`) ← `Calendar.Infrastructure` (EF Core code-first on PostgreSQL via Npgsql, ADR-0014/0015: `CalendarDbContext`, `Configurations/`, `Migrations/`, and SQL forms of the domain rules in `Queries/`) ← `Calendar.Api` (ASP.NET Core minimal API, endpoints in `Endpoints/`, contracts in `Contracts/`).
  - The app connects as the least-privilege `calendar_app` role.
  - Agenda reads are one read-only snapshot (ADR-0020).
  - The client supplies `today` and `timeZone`; the server never decides what day it is (ADR-0021).
  - Every endpoint requires an authenticated user (fallback policy) except health and the sign-in endpoints (ADR-0027).
- **Backend tests**: one xUnit project per src project, plus the shared `Calendar.Testing` (Testcontainers PostgreSQL, `PostgresTestDatabase`).
  - API tests use `WebApplicationFactory` with a `FakeTimeProvider` (`ApiTestBase`). They need Docker.
  - `*AgreementTests` assert that the SQL query forms and `DayInclusion` agree.
- **Dependencies**: NuGet Central Package Management (`backend/Directory.Packages.props`) with `packages.lock.json` per project (CI restores with `--locked-mode`, so commit lock file changes). Warnings are errors; Roslyn analyzers + SonarAnalyzer are enforced at build time.
- **Frontend**: `frontend/apps/web` (feature folders such as `features/day`, `week`, `tasks`, `agenda`; TanStack Router (ADR-0026) and TanStack Query; Vitest + Testing Library + MSW), `frontend/apps/docs` (Astro Starlight ADR site), `frontend/packages/api-client`. TypeScript is pinned to 6.0 and ESLint to 9 (ADR-0010).
- **Repo tooling** (ADR-0017): scripts are .NET 10 *file-based apps* (`dotnet run x.cs`), located in `.claude/skills/<skill>/` or `tools/<name>/`, each folder with its own analyzers, `.editorconfig` and xUnit tests. The only exception is `tools/doctor/doctor.sh` (shellcheck). Don't write new tooling in Python/Node/shell.
- **ADRs**: MADR 4.0 with decision drivers, a star-rating table and driver-tagged pros/cons; the index in `docs/decisions/README.md` is validated by `just adr-check`. To write one, use the `adr-draft` skill. **Decision status is independent of delivery**: an ADR becomes `accepted` when the user approves the decision, in that same PR before it merges, and never waits for the implementation, build or rollout. Delivery is tracked in issues and PRs, not in the ADR status.

## Stories and issues

- **The card is the source of truth.** GitHub issues help people manage and drive the work; the long-lived truth about a story is its card in `docs/stories/` (see `docs/stories/README.md` and `story-template.md`). Don't leave decisions, scope or learnings only on an issue.
- **A story that starts as an issue always begins with PR 0**: a docs-only PR that adds the card, written from the issue plus any extra input from the people involved (scope, acceptance criteria, answered questions). It references the issue (`Refs #N`) and doesn't close it. Take the next story number after fetching, and add the row to the stories index.
- **A later PR updates the card** with what was built and learned: status, the `pr` list, test links per acceptance criterion (saying honestly what isn't directly tested), implementation notes, measurements and the user guide. It can be a card-only PR or part of another PR, but the story isn't done until its card is. The PR that completes the story carries `Closes #N`.
- **`issue` in the card's front matter points at the GitHub issue** the story started from (omit it only when there was no issue). Link the card from the issue too.
- **`pr` in the card's front matter is a list** of pull request URLs in delivery order (`[]` until there is one), because a story generally takes several PRs.
- Order for a typical story: PR 0 (card) → backend → frontend → card update, each branch based on fresh `origin/main` (or stacked until its base merges).
- Never hard-code the set of stories in tests; derive it from `docs/stories/` (see `adr.test.ts`).

## Frontend practices (lessons from the performance review, issues #42–#49)

- **Date formatting**: don't build an `Intl.DateTimeFormat` per call or per item, because construction costs far more than formatting. Use the cached `dateTimeFormat(locale, options)` in `features/agenda/dayTime.ts`. Never construct one inside a sort comparator.
- **Clock subscriptions**: `useNow()` re-renders its component every minute. Call it in the smallest component that actually shows minute-sensitive state: the now line, today's event statuses, past-due flags. Never call it at the top of a whole view. Use `useToday(zone)` when only the date matters. Both share one timer, and both refresh on focus and visibility changes and roll over at midnight. Memoize layouts, groupings and sorts on their real inputs (data, date, zone, view), and keep the props passed to `memo` children stable.
- **Controlled forms**: anything expensive derived from form state, such as `deadlineInstants` (a 361-step DST scan), gets a `useMemo` keyed on the specific input string, so unrelated keystrokes don't recompute it.
- **TanStack Query defaults**: create clients with `createQueryClient()` (`src/queryClient.ts`, `staleTime: 30_000`), in the app and in tests. Don't call `new QueryClient()` directly. Data is fresh for 30 s, so focus and remount don't refetch within that window.
- **Optimistic mutations** (`features/agenda/useToggleTask.ts` is the reference):
  - Disable an item while its own mutation is pending, rather than disabling the whole list.
  - To refetch once after a burst of mutations, count in-flight mutations yourself in `onMutate`/`onSettled`. Don't use `queryClient.isMutating()` inside `onSettled`: mutations that settle in the same tick all still count as pending there, so the refetch never happens.
  - Invalidate right away after an error.
  - Reuse the shared hook instead of writing a second mutation for the same endpoint.
- **Code splitting**: routes can be lazy-loaded with code-based `.lazy()` + `createLazyRoute` (ADR-0026). The gain was only about 2% of the entry chunk, because React, the router and Query make up most of it. Measure `vite build` output before and after any bundle change, and put the numbers in the PR.
- **Performance claims**: say whether a finding is measured or inferred from the code. Every fix needs a test that fails without it, for example a React `Profiler` render count, an MSW request counter, or a `vi.spyOn` call count. For race fixes, confirm the new test fails against the old code before trusting it.

## Backend practices (lessons from the performance review, issues #50–#55)

- **Measure queries, don't guess**: for any query or index change, seed about 100k realistic rows (history spread over years) in a throwaway Testcontainers test. Run `ANALYZE`, then `EXPLAIN (ANALYZE, BUFFERS)` on the SQL EF actually generates (`ToQueryString()`, with parameters inlined as literals). Put the before and after plans in the PR (time and buffers), and don't commit the harness. In #52 the obvious fix (new indexes) changed nothing on its own; only the plan showed it.
- **Partial indexes need an implied predicate**: Postgres uses `WHERE completed_at IS NULL` only if the query's condition implies it. A single `completed_at IS NULL OR completed_at in [S, E)` defeats it and falls back to a seq scan. Split the OR into disjoint branches combined with EF `Concat` (`UNION ALL`, so no duplicates), each matching its own index (`AgendaQueries.OverdueFor`).
- **Overlap lookups use ranges + GiST**: a B-tree on `(start, end)` can't narrow `start < X AND end > Y`, because the first condition matches every past row. Store a generated half-open range (`tstzrange` for timed events, `daterange` for all-day events, `NULL` otherwise) with a GiST index, and query with `&&` / `@>` through `NpgsqlRangeDbFunctionsExtensions`. See `CalendarEventConfiguration` (`span`, `date_span`).
- **Npgsql translation pitfalls**:
  - `TimeZoneInfo.ConvertTimeBySystemTimeZoneId` translates to `AT TIME ZONE` only for a UTC `DateTime`. Pass `dueAt.Value.UtcDateTime`, not the `DateTimeOffset`, and wrap the result in `DateOnly.FromDateTime(...)` to get `::date`.
  - `Guid.CompareTo` translates (uuid ordering).
  - Untranslatable expressions fail only at runtime with a 500, so cover every query shape with an API test.
- **Keyset pagination** (`TaskListQueries`, `TaskListCursor`):
  - Do every comparison in SQL, so uuid and collation ordering stay consistent with the `ORDER BY`. Avoid case-insensitive title tie-breakers, which depend on collation.
  - Expand the seek predicate by hand around nullable keys. Row-value comparisons with NULLs are wrong.
  - Fetch `limit + 1` to decide whether there is a next page.
  - Make the cursor opaque (base64url JSON) and tied to its view, and reject a malformed cursor with 400.
  - Test paging at limits 1, 2 and 3 with ties at every key, asserting every item appears exactly once and in order.
- **"Today" comes from the client** (ADR-0021): any endpoint that judges overdue or upcoming takes `today` + `timeZone`, validated with `FieldErrors.RequireDate` / `RequireTimeZone`, and marked required in OpenAPI with `RequireQueryParameters` (`Endpoints/OpenApiExtensions.cs`).
- **In-memory ordering**:
  - Comparers must short-circuit. A `params ReadOnlySpan<int>` "first difference" helper evaluates every key on every comparison.
  - Compute expensive keys (time-zone conversions) once per item with `OrderBy(key)`, not inside the comparator.
  - When replacing a comparer or a bucketing algorithm, add a randomized test against a copy of the old implementation (heavy ties, case-only title differences, DST dates, a skipped date such as `Pacific/Apia` 2011-12-30) to prove the output is identical (`AgendaOrderTests`, `AgendaBucketingTests`).
- **Range bucketing**: don't test every item against every day. Narrow the candidate days by binary search over the sorted `DayWindow` boundaries, but keep `DayInclusion` as the final arbiter, so the per-day rules keep one implementation.
- **Analyzer traps that break the build** (warnings are errors):
  - S2699 needs an assertion, even in a scratch test.
  - IDE0011 needs braces.
  - IDE0005 flags an unused `using` after code moves.
  - S8969 flags a redundant `!`.
  - Layout (ADR-0036): SA1501 forbids single-line blocks such as `if (y) { Foo(); }`. SA1116/SA1117 require a wrapped parameter or argument list to start on a new line with one item per line. SA1117 still accepts all the items together on the continuation line, so don't write that either. `dotnet format` fixes these.
  - S103 caps lines at 140 characters. Nothing fixes it automatically, so wrap long lines by hand. Split long strings with `+` and long `<summary>` text over several lines; a split summary adds a soft line break to the OpenAPI description, so run `just contracts`.
  - IDE0008 wants an explicit type unless the type is apparent or built in.
  - Every rule in the `Performance` category is a warning, including ones off by default. CA1848 requires `LoggerMessage` source-generated logging methods instead of `logger.LogX(...)` calls.
  - RS0030 bans `DateTime.Now`/`UtcNow`/`Today`, `DateTimeOffset.Now`/`UtcNow` and `TimeZoneInfo.Local` in `backend/src`. Use the injected `TimeProvider`.
  - `dotnet format` doesn't accept file-based apps. To apply code fixes to a tool, `dotnet project convert` it into a scratch folder inside its own directory (so `.editorconfig` and `Directory.Build.props` apply), format that, then copy the code back, keeping the `#!`/`#:` header lines.

## Testing notes

- Run the frontend checks from `frontend/` as CI does: `corepack pnpm lint` (type-aware ESLint, which can take minutes, so don't kill it as hung), `typecheck`, `format:check`, `test`.
- Vitest's 5 s timeout is tight for a few heavy tests, notably WeekView "back and forward restore the weeks" and the docs "reads every repository ADR". Under load they time out on any branch. Don't run several full suites in parallel. Before treating a timeout as a regression, rerun the file with `--maxWorkers=1` and compare against a branch without your change.
- Clock tests fake only `Date` by default (`useFakeClock` in `DayView.test.tsx`). Query staleness reads `Date.now()`, so `vi.setSystemTime` past 30 s makes data stale, for example to test a refetch on focus.
- DST tests depend on the host's time-zone data. If they fail only in one environment, check `TZ` and tzdata before the code.
- Frontend type errors:
  - Run `tsc -b` (the `typecheck` script), not `tsc -p .`, which can pass while the project references fail.
  - Hundreds of ESLint `no-unsafe-*` errors at once usually mean a broken `node_modules`. Rerun `corepack pnpm install --frozen-lockfile` before touching code.
  - In `useInfiniteQuery`, put `queryFn` before `getNextPageParam`, or the page type infers as `unknown`.
  - With `exactOptionalPropertyTypes`, omit absent query params (`...(cursor && { cursor })`) instead of passing `undefined`.
- Backend API tests need Docker (Testcontainers Postgres). Their logs, including generated SQL, are printed only for failing tests. To inspect SQL, write it to a file from a throwaway test with `ToQueryString()`.
- Sandboxed agents may have no network or Docker. Restore offline with `dotnet restore -p:NuGetAudit=false` (packages are cached), run what can run (build, format, domain and pure unit tests), and state exactly which suites didn't run. Never report a change as verified when its integration tests were skipped.

## Working on several changes at once

- Give each branch its own `git worktree` based on fresh `origin/main`, and never edit the main checkout. Each worktree needs its own `pnpm install --frozen-lockfile` in `frontend/`.
- For work driven by issues, use one issue per defect and one PR per issue, with `Closes #N`. Labels: `performance` for slow or wasteful behaviour, `bug` for wrong behaviour. Before opening PRs, compare which files each branch touches. Merge the self-contained and correctness fixes first, and leave wide refactors (e.g. render restructuring across views) last, to be rebased once.
- Keep the decision trail on the issue: post the concrete design (API shape, ordering, limits) as an issue comment before implementing, and record each answered question and deferral there, e.g. opening a new story for deferred scope, as with #56. Re-read the issue's comments before starting, because approvals and changes of direction arrive there.
- Two branches that each add an EF migration conflict in `CalendarDbContextModelSnapshot.cs`. Stack the second PR on the first (`--base <first-branch>`) and retarget it to `main` after the first merges. Postpone a change that rewrites code several open PRs touch (e.g. #51 on #50, #52 and #54) until they merge, and say so on its issue.
- Breaking contract changes (e.g. a list becoming `{ items, nextCursor }`) go in one PR with the regenerated `openapi.json` and TS client and every consumer updated. Find consumers with a grep for the path (e.g. `'/api/tasks'`) across `frontend/`, including MSW handlers in tests.

## Notes

- `.plan/` and `.env` are git-ignored scratch/local files.
- Toolchain pins: .NET SDK from `backend/global.json`, Node from `frontend/.node-version`, pnpm via Corepack (`packageManager` in `frontend/package.json`; don't install globally). `just doctor` verifies them.
