---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# React + Vite + TypeScript for the web UI

## Context and Problem Statement

The primary UI is a web front end, with more UIs possibly later. Which framework and build tool should it use?

## Decision Drivers

* Mature ecosystem for calendar and scheduling widgets and date handling
* Strong static typing
* Fast dev loop and simple static deployment
* Skills and code that carry over to future UIs (e.g. React Native)

## Considered Options

* React 19 + Vite + TypeScript (SPA)
* Angular
* Blazor WebAssembly (C# end to end)
* Next.js (React with SSR)
* Vue / Svelte

## Decision Outcome

Chosen option: "React 19 + Vite + TypeScript SPA", because it has the largest ecosystem (including calendar components), it is a static build served next to or in front of the API, and React Native is a path to mobile UIs. **TanStack Query** manages server state (caching, retries, loading and error states). In dev, Vite proxies `/api` to the backend (`CALENDAR_API_URL`, default `http://localhost:5041`), so the browser always calls same-origin and needs no CORS.

### Consequences

* Good, because a static bundle is cheap to host and the backend stays the only server.
* Bad, because there's no SSR. That's acceptable for an authenticated, app-like calendar where SEO doesn't matter.
* Bad, because the UI uses a second language from the backend. This is mitigated by generating TS types from the API contract (ADR-0004).

## Pros and Cons of the Options

### Blazor WebAssembly

* Good, because it shares C# models with the backend.
* Bad, because of a large initial download, a smaller UI component ecosystem, and no reuse in non-.NET UIs.

### Angular

* Good, because it's batteries-included and opinionated.
* Bad, because it's heavier and doesn't carry over to mobile as directly.

### Next.js

* Bad, because SSR and a Node server add a second backend with no current need.
