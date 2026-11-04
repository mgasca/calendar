# Frontend practices

Practices for the pnpm workspace in `frontend/`: checks, rendering, data fetching and the docs site, which matter only when editing here. The root `AGENTS.md` still applies and nothing here overrides it. Most of this was learned in the performance review (issues #42–#49, story 0018 records #48).

## Running checks

- Run the checks CI runs: `just frontend lint` (type-aware ESLint, which can take minutes, so don't kill it as hung), `just frontend typecheck`, `just frontend test`, and `corepack pnpm --dir frontend format:check` (no recipe only checks formatting; `just format` rewrites the files). One test file: `just frontend test-web <file-or-pattern>` (Vitest, in `@calendar/web`); `just frontend test` runs every package and takes no arguments.
- Type-check with `tsc -b` (what `just frontend typecheck` runs), not `tsc -p .`, which can pass while the project references fail.
- Hundreds of ESLint `no-unsafe-*` errors at once usually mean a broken `node_modules`. Rerun `just frontend install` before touching code.
- Vitest's default timeout is 5 s, and a full suite run in parallel with another can push a normal test past it. Don't run several full suites in parallel. Before treating a timeout as a regression, rerun the file with `--maxWorkers=1` and compare against a branch without your change. A test that genuinely needs more than 5 s sets an explicit timeout with a comment saying why, as the triage batch tests do.
- Clock tests fake only `Date` by default (`useFakeClock` in `DayView.test.tsx`). Query staleness reads `Date.now()`, so `vi.setSystemTime` past 30 s makes data stale, for example to test a refetch on focus.
- DST tests depend on the host's time-zone data. If they fail only in one environment, check `TZ` and tzdata before the code.

## Dates and clocks

- Don't build an `Intl.DateTimeFormat` per call or per item, because construction costs far more than formatting. Use the cached `dateTimeFormat(locale, options)` in `features/agenda/dayTime.ts`. Never construct one inside a sort comparator.
- `useNow()` re-renders its component every minute. Call it in the smallest component that actually shows minute-sensitive state: the now line, today's event statuses, past-due flags. Never call it at the top of a whole view. Use `useToday(zone)` when only the date matters. Both share one timer, refresh on focus and visibility changes, and roll over at midnight.
- Memoize layouts, groupings and sorts on their real inputs (data, date, zone, view), and keep the props passed to `memo` children stable.

## Forms

Anything expensive derived from form state, such as `deadlineInstants` (a 361-step DST scan), gets a `useMemo` keyed on the specific input string, so unrelated keystrokes don't recompute it.

## TanStack Query

- Create clients with `createQueryClient()` (`src/queryClient.ts`, `staleTime: 30_000`), in the app and in tests. Don't call `new QueryClient()` directly. Data is fresh for 30 s, so focus and remount don't refetch within that window.
- The client carries the one retry policy (`shouldRetry`): never on a 4xx, at most twice otherwise. For it to work, a failed query must throw `ApiError` with the HTTP status; build it with `apiError(result, fallback)` from `src/api/apiError.ts` instead of a plain `Error`, and don't set `retry` per query. The test renderer turns retries off, so a test about retrying opts in with `{ retry: true }` and counts requests with an MSW handler.
- In `useInfiniteQuery`, put `queryFn` before `getNextPageParam`, or the page type infers as `unknown`. With `exactOptionalPropertyTypes`, omit absent query params (`...(cursor && { cursor })`) instead of passing `undefined`.

## Optimistic mutations (`features/agenda/useToggleTask.ts` is the reference)

- Disable an item while its own mutation is pending, rather than disabling the whole list.
- To refetch once after a burst of mutations, count in-flight mutations yourself in `onMutate`/`onSettled`. Don't use `queryClient.isMutating()` inside `onSettled`: mutations that settle in the same tick all still count as pending there, so the refetch never happens.
- Invalidate right away after an error.
- Reuse the shared hook instead of writing a second mutation for the same endpoint.

## Code splitting

Routes can be lazy-loaded with code-based `.lazy()` + `createLazyRoute` (ADR-0026). The gain was only about 2% of the entry chunk, because React, the router and Query make up most of it. Measure `vite build` output before and after any bundle change, and put the numbers in the PR.

## Proving a performance fix

Say whether a finding is measured or inferred from the code. Every fix needs a test that fails without it, for example a React `Profiler` render count, an MSW request counter, or a `vi.spyOn` call count. For race fixes, confirm the new test fails against the old code before trusting it. Before closing a measured concern without a code change, preserve the workload, source revision, environment, sampling method, results and limits in its story card with the source issue linked, and state what would justify measuring again (story 0018's record of #48). A repeatable benchmark belongs in `docs/benchmarks/` with its harness; a result whose harness was discarded is reported evidence, not a benchmark. Do not infer complete browser-frame performance from timing only a layout function.

## Docs site (`apps/docs`)

The site is built from the `docs/*` folders by `src/lib/docs-loader.ts`; `src/lib/adr.ts` parses and validates the cards and ADRs, and `src/lib/architecture.ts` renders the CALM model. Never hard-code the set of stories (or ADRs) in tests; derive it from `docs/stories/` (see `adr.test.ts`). Run the corpus tests with `just docs test` (a file or pattern narrows it) and the publication checks with `just docs build`.
