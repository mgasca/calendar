---
status: accepted
date: 2026-10-27
decision-makers: mgasca, Claude (AI assistant)
---

# Client-side routing with TanStack Router and code-based route definitions

## Context and Problem Statement

The web UI ([ADR-0003](0003-react-vite-typescript-web-ui.md)) has had a single screen, the Today view. Story 0002 (week view) needs addressable screens: `/` for today, `/day/:date` for any day and `/week/:weekStart?` for a week. Dates and weeks must live in the URL so they can be bookmarked and restored with back and forward, and an invalid date in the URL must get a clear page instead of a broken view. The app is a static SPA that, once deployed, the API serves from a single container ([ADR-0002](0002-dotnet-10-minimal-api-backend.md)), so every deep link must reach `index.html`. Which client-side router should the web UI use, and how are routes defined?

## Decision Drivers

* **D1 Type safety**: route paths, params and links are checked by `tsc`, so an agent that renames a route or passes a wrong param gets a compile error rather than a dead link.
* **D2 AI-agent proficiency**: mainstream and well documented, so agents write correct routing code without guessing ([ADR-0003](0003-react-vite-typescript-web-ui.md)).
* **D3 Stack fit**: works with React 19, Vite, TanStack Query and the TypeScript 6.0 pin ([ADR-0010](0010-toolchain-version-pins.md)) without extra build plugins or generated files.
* **D4 URL state handling**: built-in validation of path params, not-found handling and redirects (such as snapping `/week/2026-10-28` to its Monday), with room for typed search params later.
* **D5 Testability**: routes render in Vitest with Testing Library and MSW ([ADR-0008](0008-frontend-testing-stack.md)) from an in-memory history, without a browser.
* **D6 Maintenance burden**: little code of our own to own, and a small, actively maintained dependency footprint that Dependabot keeps current ([ADR-0012](0012-ci-and-dependency-updates.md)).

## Considered Options

* TanStack Router with code-based route definitions
* React Router in library mode
* Hand-rolled History API router

## Decision Outcome

Chosen option: "TanStack Router with code-based route definitions", because it is the only option whose params, paths and links are fully typed without code generation (D1, D3), and it validates params, throws not-found and redirects as part of route matching (D4). It is less widespread than React Router (D2), but it comes from the same project as TanStack Query, which the app already uses, and the product owner chose it.

| Driver | **TanStack Router, code-based (chosen)** | React Router in library mode | Hand-rolled History API router |
| --- | :---: | :---: | :---: |
| D1 Type safety | ★★★ | ★☆☆ | ★☆☆ |
| D2 AI-agent proficiency | ★★☆ | ★★★ | ★☆☆ |
| D3 Stack fit | ★★★ | ★★★ | ★★★ |
| D4 URL state handling | ★★★ | ★★☆ | ★☆☆ |
| D5 Testability | ★★☆ | ★★★ | ★★☆ |
| D6 Maintenance burden | ★★☆ | ★★☆ | ★☆☆ |

### Conventions

* **Package:** `@tanstack/react-router` in `frontend/apps/web` (a production dependency). No `@tanstack/router-plugin` and no generated `routeTree.gen.ts`: routes are declared in code with `createRootRouteWithContext` and `createRoute`.
* **Where routes live:** `frontend/apps/web/src/router.tsx` builds the route tree and exports `createAppRouter({ history?, timeZone?, locale? })`. It registers the router type (`declare module '@tanstack/react-router' { interface Register … }`) so `Link`, `useParams` and `navigate` are typed app-wide. `App.tsx` holds the root layout (navigation, `<Outlet />`, footer) and the not-found page; `main.tsx` creates the router and renders it.
* **Router context:** the IANA time zone and locale are passed as router context, defaulting to the browser's. Tests pass fixed values.
* **Params:** date params are validated in `params.parse`. A value that isn't a real `YYYY-MM-DD` date in the supported range (1900–2200, the same as the API) throws `notFound()`, which renders the route's invalid-date page. Route components can then rely on the param being valid.
* **Adding a route:** one `createRoute({ getParentRoute: () => rootRoute, path: '/week/$weekStart', params: { parse, stringify }, beforeLoad, component })`, added to `rootRoute.addChildren([...])`. Redirects such as week snapping throw `redirect({ to, params })` from `beforeLoad`.
* **Tests:** `createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) })`, rendered inside the usual `QueryClientProvider`. Route matching is asynchronous, so tests wait with `findBy…`.

### Deep links

* **Development:** Vite's dev server and `vite preview` default to `appType: 'spa'`, so any path that isn't a file and isn't proxied (only `/api` is proxied) is answered with `index.html`. Deep links and reloads on `/day/2026-10-26` work with no extra configuration.
* **Deployed (single container, [ADR-0002](0002-dotnet-10-minimal-api-backend.md)):** the API doesn't serve the SPA yet; that is the open follow-up in [ADR-0002](0002-dotnet-10-minimal-api-backend.md). When it does, the hosting must meet these requirements, each covered by an API test:
  * Static assets from the built `dist/` are served as files, and a missing asset (a path with a file extension, such as `/assets/missing.js`) is a 404, not `index.html`.
  * Any other unknown path outside `/api` (such as `/day/2026-10-26` or `/week`) returns `index.html` with status 200, so the router can take over. In ASP.NET Core that is `UseStaticFiles()` plus a fallback such as `MapFallbackToFile("{*path:nonfile}", "index.html")`.
  * Unknown `/api/*` paths stay 404 problem details. A plain `MapFallbackToFile` would answer them with `index.html`, so the fallback must exclude the `/api` prefix (for example with a route constraint, or an explicit `/api/{**rest}` endpoint that returns 404).
  * `index.html` is served with `Cache-Control: no-cache`, so a new deployment's hashed asset names are picked up.
* **Client side:** unknown paths render the root not-found page, and invalid dates render the day route's invalid-date page. Neither depends on the server.

### Dependency updates

* `.github/dependabot.yml` already covers the `/frontend` npm workspace. `@tanstack/react-router` is a production dependency, so its minor and patch releases join the weekly `frontend-prod` group and majors arrive as individual PRs. No configuration change is needed.
* TanStack Router publishes patch releases very often. The weekly grouped PR absorbs that churn; the lockfile pins the exact version between updates.

### Consequences

* Good, because a wrong param or a link to a route that doesn't exist fails `make lint` (`tsc`), not at runtime.
* Good, because invalid URLs are rejected while matching, so views only ever receive valid dates.
* Good, because there is no generated route file to keep in sync and no Vite plugin, unlike file-based routing.
* Bad, because code-based routes need the `getParentRoute` and `addChildren` boilerplate, and route-level code splitting (`lazyRouteComponent`) is manual. That is acceptable for a handful of routes.
* Bad, because fewer examples exist than for React Router, so agents must follow the code-based (not file-based) parts of the TanStack docs. The conventions above and the existing routes are the reference.
* Bad, because the package brings in a few transitive dependencies (`@tanstack/router-core`, `@tanstack/history`, `@tanstack/react-store`, `isbot`).
* Neutral: until the API serves the SPA, the deployed-deep-link requirements above are a checklist for that follow-up, not running code.

### Confirmation

* Routing tests in `frontend/apps/web/src/App.test.tsx` render the app from a memory history and cover `/` as today, `/day/<date>`, an invalid date, an unknown path and the link back to today. They run in `make test` and CI.
* `tsc` in `make lint` checks every `Link`, `useParams` and `navigate` against the registered route tree.
* Review rule: new routes are added in `router.tsx` with validated params; a PR that adds `@tanstack/router-plugin` or file-based routes needs a superseding ADR.
* When the API starts serving the SPA, its PR adds the fallback tests listed under *Deep links*.

## Pros and Cons of the Options

### TanStack Router with code-based route definitions

* Good, because **D1 Type safety**: path params, search params and `Link` targets are inferred from the route tree once the router type is registered, with no code generation.
* Good, because **D4 URL state handling**: `params.parse` validates and types params, `notFound()` and `redirect()` can be thrown during matching, and search params get schema validation when needed.
* Good, because **D3 Stack fit**: it is from the same project as TanStack Query, works without the Vite plugin, supports React 19 (peer `react >=18 || >=19`) and compiles under TypeScript 6.0.
* Neutral, because **D3 Stack fit**: it has its own loader cache, which this app doesn't use; data stays in TanStack Query.
* Bad, because **D2 AI-agent proficiency**: far less public code than React Router, and most docs and examples assume file-based routing.
* Neutral, because **D5 Testability**: `createMemoryHistory` makes routes easy to render in tests, but initial matching is asynchronous, so the first assertion must wait.
* Neutral, because **D6 Maintenance burden**: a stable 1.x line with very frequent releases and a handful of transitive dependencies.

### React Router in library mode

* Good, because **D2 AI-agent proficiency**: the most widely used React router, with the most examples and answers.
* Good, because **D5 Testability**: `MemoryRouter` and `createMemoryRouter` are the standard, well-documented way to test routed components.
* Good, because **D3 Stack fit**: library mode needs no build plugin and works with Vite and React 19.
* Bad, because **D1 Type safety**: in library mode `useParams()` returns `string | undefined` for every param and `<Link to>` is an unchecked string. Generated route types only exist in framework mode, which brings in its Vite plugin and conventions.
* Neutral, because **D4 URL state handling**: data-mode loaders can redirect and throw responses, but param validation is hand-written in each route.
* Neutral, because **D6 Maintenance burden**: a small footprint, but majors come about once a year (v7 to v8, 8.5.0 at the time of writing), each with migration work.

### Hand-rolled History API router

* Good, because **D3 Stack fit**: no dependency at all; three routes are a small `switch` on `location.pathname`.
* Good, because **D6 Maintenance burden**: nothing to update through Dependabot.
* Bad, because **D6 Maintenance burden**: we would own link handling, active-link state, `popstate`, scroll restoration and focus management, and every new route adds to that code.
* Bad, because **D1 Type safety** and **D4 URL state handling**: typed params, validation, not-found and redirects would all be custom code with no conventions to lean on.
* Bad, because **D2 AI-agent proficiency**: agents have no documentation for a bespoke router and tend to reinvent pieces inconsistently.
* Neutral, because **D5 Testability**: it can be tested by setting `window.history` in jsdom, but with no ready-made test helpers.

## More Information

* Versions at the time of writing (`npm view`): `@tanstack/react-router` 1.170.46 (MIT), `react-router` 8.5.0 (MIT; latest 7.x is 7.18.4).
* Story [0002](../stories/0002-week-view.md) plans this decision as number 0022, but that number was taken by [ADR-0022](0022-astro-starlight-documentation-ui.md) before this record was written, so it is ADR-0024.
* The single-container SPA hosting is the follow-up recorded in [ADR-0002](0002-dotnet-10-minimal-api-backend.md); the *Deep links* section above lists what it must do for routing.
* Revisit file-based routing (the `@tanstack/router-plugin` Vite plugin) if the app grows past roughly ten routes or needs automatic route-level code splitting. That would supersede this ADR.
