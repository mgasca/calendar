# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, Cursor, etc.) when working with code in this repository.

## Overview

"Calendar": a monorepo with a .NET 10 backend (`backend/`, solution `Calendar.slnx`) and a pnpm/React/Vite/TypeScript frontend (`frontend/`). Early stage: the API currently has only health endpoints and a `CalendarEvent` domain type. Significant choices are recorded as ADRs in `docs/decisions/` — read the relevant ADR before changing tooling, layout or dependencies, and don't contradict an accepted one (supersede it instead).

## Commands

`make` is a thin wrapper over native tooling (`make help` lists targets). Linux/WSL only.

- `make setup` — `doctor` + restore .NET packages + `pnpm install --frozen-lockfile`
- `make dev-api` (http://localhost:5041) / `make dev-web` (proxies `/api` to the API)
- `make test` — backend + frontend tests; `make lint` — analyzers, `dotnet format --verify-no-changes`, ESLint, tsc, tooling, ADR check; `make check` — everything CI runs
- `make format` — auto-format everything
- `make contracts` — rebuild the API and regenerate `contracts/openapi.json` and the TS client. **Commit the result**; CI fails if the contract is stale.
- `make tooling` / `make adr-check` — test/lint repo tooling; validate ADRs (`ARGS=--fix-links`, `ARGS=--next-number`)

Single tests:
- Backend (run from `backend/` so `global.json` applies; uses Microsoft.Testing.Platform, xUnit v3): `dotnet test --project tests/Calendar.Domain.Tests --filter-method "*MethodName*"` (or `--filter-class`)
- Frontend: `pnpm --dir frontend --filter @calendar/web test -- <file-or-pattern>` (Vitest)

## Architecture

- **Contract-first across stacks**: the backend build generates `contracts/openapi.json`; `frontend/packages/api-client` generates a typed client from it (`schema.gen.ts`, do not hand-edit), shared by all TS UIs. Any new UI should consume the contract, not backend code.
- **Backend**: `Calendar.Domain` (no framework dependencies) ← `Calendar.Api` (ASP.NET Core minimal API, endpoints in `Endpoints/`). One xUnit test project per src project; API tests use `WebApplicationFactory`. Planned: PostgreSQL + EF Core code-first (ADR-0014/0015), Docker Compose locally, Testcontainers in tests.
- **Dependencies**: NuGet Central Package Management (`backend/Directory.Packages.props`) with `packages.lock.json` per project (CI restores with `--locked-mode`, so commit lock file changes). Warnings are errors; Roslyn analyzers + SonarAnalyzer are enforced at build time.
- **Frontend**: `frontend/apps/web` (feature folders, e.g. `features/health`; Vitest + Testing Library + MSW), `frontend/packages/api-client`. TypeScript is pinned to 6.0 and ESLint to 9 (ADR-0010).
- **Repo tooling** (ADR-0017): scripts are .NET 10 *file-based apps* (`dotnet run x.cs`), located in `.claude/skills/<skill>/` or `tools/<name>/`, each folder with its own analyzers, `.editorconfig` and xUnit tests. The only exception is `tools/doctor/doctor.sh` (shellcheck). Don't write new tooling in Python/Node/shell.
- **ADRs**: MADR 4.0 with decision drivers, a star-rating table and driver-tagged pros/cons; the index in `docs/decisions/README.md` is validated by `make adr-check`. To write one, use the `adr-draft` skill.

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

## Testing notes

- Run the frontend checks from `frontend/` as CI does: `corepack pnpm lint` (type-aware ESLint, which can take minutes, so don't kill it as hung), `typecheck`, `format:check`, `test`.
- Vitest's 5 s timeout is tight for a few heavy tests, notably WeekView "back and forward restore the weeks" and the docs "reads every repository ADR". Under load they time out on any branch. Don't run several full suites in parallel. Before treating a timeout as a regression, rerun the file with `--maxWorkers=1` and compare against a branch without your change.
- Clock tests fake only `Date` by default (`useFakeClock` in `DayView.test.tsx`). Query staleness reads `Date.now()`, so `vi.setSystemTime` past 30 s makes data stale, for example to test a refetch on focus.
- DST tests depend on the host's time-zone data. If they fail only in one environment, check `TZ` and tzdata before the code.

## Working on several changes at once

- Give each branch its own `git worktree` based on fresh `origin/main`, and never edit the main checkout. Each worktree needs its own `pnpm install --frozen-lockfile` in `frontend/`.
- For work driven by issues, use one issue per defect and one PR per issue, with `Closes #N`. Labels: `performance` for slow or wasteful behaviour, `bug` for wrong behaviour. Before opening PRs, compare which files each branch touches. Merge the self-contained and correctness fixes first, and leave wide refactors (e.g. render restructuring across views) last, to be rebased once.

## Notes

- `.plan/` and `.env` are git-ignored scratch/local files.
- Toolchain pins: .NET SDK from `backend/global.json`, Node from `frontend/.node-version`, pnpm via Corepack (`packageManager` in `frontend/package.json`; don't install globally). `make doctor` verifies them.
