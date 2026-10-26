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

`frontend/apps/web` builds to `dist/` with `pnpm build` in CI. Once the container follow-up from [ADR-0002](0002-dotnet-10-minimal-api-backend.md) is done, the API image serves those assets.

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
