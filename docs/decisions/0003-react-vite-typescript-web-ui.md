---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# React + Vite + TypeScript SPA for the web UI

## Context and Problem Statement

The primary UI is a web front end. Mobile apps, a desktop app and CLI integrations are expected later. UI code will be mostly written by AI agents, and the app will be deployed as a single container in which the .NET API serves the built UI. Which framework and build tool should the web UI use?

## Decision Drivers

* **D1 AI-agent proficiency**: a mainstream stack with abundant documentation and examples, strong typing and fast feedback, so agents write correct code reliably.
* **D2 Calendar ecosystem**: mature calendar/scheduling components, date/time and accessibility libraries.
* **D3 Reuse for future UIs**: skills, patterns and code that carry over to mobile and desktop clients.
* **D4 Single-container fit**: produces static assets the API can serve; no second server process.
* **D5 Dev loop speed**: fast startup, HMR and test feedback.

## Considered Options

* React 19 + Vite + TypeScript (SPA)
* Angular
* Blazor WebAssembly (C# end to end)
* Next.js (React with SSR)
* Vue or Svelte with Vite

## Decision Outcome

Chosen option: "React 19 + Vite + TypeScript SPA", because it leads on AI-agent proficiency (D1), calendar ecosystem (D2) and reuse toward mobile and desktop (D3), and builds to static assets that fit the single container (D4).

| Driver | **React + Vite + TS SPA (chosen)** | Angular | Blazor WebAssembly | Next.js (SSR) | Vue / Svelte + Vite |
| --- | :---: | :---: | :---: | :---: | :---: |
| D1 AI-agent proficiency | ★★★ | ★★☆ | ★☆☆ | ★★★ | ★★☆ |
| D2 Calendar ecosystem | ★★★ | ★★☆ | ★☆☆ | ★★★ | ★★☆ |
| D3 Reuse for future UIs | ★★★ | ★☆☆ | ★★☆ | ★★★ | ★☆☆ |
| D4 Single-container fit | ★★★ | ★★★ | ★★★ | ★☆☆ | ★★★ |
| D5 Dev loop speed | ★★★ | ★★☆ | ★☆☆ | ★★☆ | ★★★ |

Related implementation choices:

* **TanStack Query** manages server state (caching, retries, loading and error states).
* In dev, Vite proxies `/api` to the backend (`CALENDAR_API_URL`, default `http://localhost:5041`). The browser always calls same-origin, which matches production, where the API serves the SPA, and needs no CORS.

### Consequences

* Good, because mobile (React Native / Expo) and desktop (Electron or Tauri) clients can share TypeScript, hooks and `@calendar/api-client`.
* Bad, because there's no SSR. That's acceptable for an authenticated, app-like calendar where SEO doesn't matter.
* Bad, because the UI language differs from the backend's. Mitigated by generating TS types from the API contract ([ADR-0004](0004-openapi-contract-and-generated-client.md)).

### Confirmation

`frontend/apps/web` builds to `dist/` in CI: the `Frontend` job type-checks the app with `tsc -b`, then runs `vite build`. The API image serves those assets: the CI `Container image` job builds the root `Dockerfile`, which copies `dist/` into the API's `wwwroot/`, and smoke-tests the running image with `just image smoke`. The amendment below records when that was delivered and what is still unverified.

### Amendment, 2026-11-07: the API image serves the web UI

Recorded for the ADR sweep epic [#473](https://github.com/mgasca/calendar/issues/473) in [issue #477](https://github.com/mgasca/calendar/issues/477), with the maintainer's approval. The decision is unchanged and is not re-rated. The context above describes the web UI as decided on 2026-10-26, when the API did not yet serve it. Confirmation used to say that the API image would serve the built assets once the container follow-up from [ADR-0002](0002-dotnet-10-minimal-api-backend.md) was done. That follow-up has since been delivered:

* **SPA serving**, [PR #108](https://github.com/mgasca/calendar/pull/108) (merged 2026-10-29). `backend/src/Calendar.Api/Program.cs` serves the built files from the web root outside `/api`, and answers other paths without a file extension with `index.html`.
* **Image**, [PR #114](https://github.com/mgasca/calendar/pull/114) (merged 2026-10-29, closes #75). The root `Dockerfile` builds `@calendar/web` with the pinned Node and pnpm, and copies its `dist/` into the runtime image's `wwwroot/`.
* **Verified by automated checks:**
  * `HostingTests.SpaRoutingAndCacheHeaders` (`backend/tests/Calendar.Api.Tests/Endpoints/HostingTests.cs`) runs the API in-process against a temporary web root, not the real `dist/`. It checks `index.html` for `/` and a deep link, the cache headers of a hashed asset, and a 404 for a missing asset.
  * The CI `Container image` job builds the image from the real web build and runs `just image smoke` (`image.just`). The smoke test checks that `/` returns an HTML document and that `/week` returns the same `index.html`. It doesn't fetch a JavaScript or CSS asset.
  * Both checks passed on `main` at `082c64e08` (CI run [42406004961](https://github.com/mgasca/calendar/actions/runs/42406004961)). Under [ADR-0046](0046-run-ci-jobs-only-for-the-paths-they-check.md) the image job runs only when a pull request changes the image's inputs, and on every push to `main`.
* **Not verified:** no Azure deployment has run, so serving the web UI from Azure Container Apps, including picking up new hashed assets after a release, is a deployment check (#79, #83).

## Pros and Cons of the Options

### React 19 + Vite + TypeScript SPA

* Good, because **D1 AI-agent proficiency**: the most widely used UI library, with the most training data and docs; TS strict mode and fast Vitest feedback catch agent mistakes.
* Good, because **D2 Calendar ecosystem**: many maintained calendar/scheduler components (e.g. FullCalendar, react-big-calendar, Schedule-X) and a11y libraries.
* Good, because **D3 Reuse for future UIs**: React Native/Expo for mobile and Electron/Tauri for desktop reuse the same language, patterns and API client.
* Good, because **D4 Single-container fit**: `vite build` emits static files served by ASP.NET Core.
* Good, because **D5 Dev loop speed**: Vite dev server and HMR are near-instant.
* Bad, because **D1 AI-agent proficiency**: React is unopinionated, so conventions (routing, state, forms) must be chosen and documented.

### Angular

* Good, because **D1 AI-agent proficiency**: opinionated, batteries-included structure gives agents fewer choices to get wrong.
* Good, because **D4 Single-container fit**: static build output.
* Bad, because **D3 Reuse for future UIs**: no mainstream path to native mobile (Ionic/Capacitor are web views).
* Bad, because **D2 Calendar ecosystem**: smaller selection of calendar components than React.
* Bad, because **D5 Dev loop speed**: heavier framework and build compared with Vite + React.

### Blazor WebAssembly

* Good, because **D3 Reuse for future UIs**: C# models are shared with the backend, and .NET MAUI Blazor Hybrid can host the same components on mobile and desktop.
* Good, because **D4 Single-container fit**: static files served by ASP.NET Core.
* Bad, because **D1 AI-agent proficiency**: much less public code and fewer examples than React, so agents make more mistakes.
* Bad, because **D2 Calendar ecosystem**: few free calendar components; most are commercial suites.
* Bad, because **D5 Dev loop speed**: slower builds and hot reload, and a large initial download for users.

### Next.js (SSR)

* Good, because **D1**, **D2**, **D3**: same React ecosystem.
* Bad, because **D4 Single-container fit**: SSR needs a Node server process alongside the .NET API, or a second container.
* Bad, because **D5 Dev loop speed**: server/client component boundaries add complexity with no current benefit (no SEO need).

### Vue or Svelte with Vite

* Good, because **D4**, **D5**: static output and the same fast Vite tooling.
* Bad, because **D3 Reuse for future UIs**: no native mobile path comparable to React Native.
* Bad, because **D1 AI-agent proficiency** and **D2 Calendar ecosystem**: smaller communities than React.

## More Information

* **Amendment, 2026-11-07:** the API image serves the built web UI since PR #108 and PR #114. Confirmation now names the CI build and the image smoke test that check it; no Azure deployment has verified it yet. The decision is unchanged and not re-rated, so this ADR was amended, not superseded.
