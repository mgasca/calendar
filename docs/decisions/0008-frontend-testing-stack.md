---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# Vitest, Testing Library and MSW for frontend tests

## Context and Problem Statement

Which tools should the TypeScript packages use for unit and component tests, and how should tests fake the backend API?

## Decision Drivers

* **D1 Toolchain integration**: reuses Vite's config and transforms; native ESM and TypeScript with no Babel or ts-jest.
* **D2 Feedback speed**: fast runs and watch mode.
* **D3 Tests reflect user behavior**: tests assert what users see (roles, text), not implementation details, so refactors don't break them.
* **D4 Realistic API faking**: the real API client and TanStack Query stack run in tests; fakes are typed against the contract and reusable.
* **D5 AI familiarity**: mainstream tools with abundant examples.

## Considered Options

### Test runner

* Vitest
* Jest
* `node:test`

### Component testing

* React Testing Library (+ jest-dom, user-event) in jsdom
* Vitest Browser Mode (real browser)
* Enzyme-style shallow rendering

### API faking

* Mock Service Worker (MSW)
* Module mocking (`vi.mock` of the API client)
* Stubbing `fetch` directly

## Decision Outcome

Chosen: **Vitest** + **React Testing Library in jsdom** + **MSW**, with `@vitest/coverage-v8` for coverage.

**Runner:** Vitest, because it shares Vite's pipeline (D1) and is fast (D2).

| Driver | **Vitest (chosen)** | Jest | `node:test` |
| --- | :---: | :---: | :---: |
| D1 Toolchain integration | ★★★ | ★☆☆ | ★☆☆ |
| D2 Feedback speed | ★★★ | ★★☆ | ★★★ |
| D5 AI familiarity | ★★★ | ★★★ | ★☆☆ |

**Component testing:** React Testing Library in jsdom, because it tests user-visible behavior (D3) with fast feedback (D2).

| Driver | **Testing Library + jsdom (chosen)** | Vitest Browser Mode | Enzyme-style shallow rendering |
| --- | :---: | :---: | :---: |
| D2 Feedback speed | ★★★ | ★★☆ | ★★★ |
| D3 User behavior | ★★★ | ★★★ | ☆☆☆ |
| D5 AI familiarity | ★★★ | ★☆☆ | ★☆☆ |

**API faking:** MSW, because it intercepts at the network layer, so the real client stack runs (D4) and tests stay behavior-focused (D3).

| Driver | **MSW (chosen)** | Module mocking (`vi.mock`) | Stubbing `fetch` |
| --- | :---: | :---: | :---: |
| D3 User behavior | ★★★ | ★★☆ | ★★☆ |
| D4 Realistic API faking | ★★★ | ★☆☆ | ★★☆ |
| D5 AI familiarity | ★★★ | ★★★ | ★★☆ |

Implementation:

* Shared default handlers live in `src/test/server.ts`, typed with `Schemas` from `@calendar/api-client`, and are overridden per test with `server.use(...)`.
* Unhandled requests fail the test (`onUnhandledFrame: 'error'`, the MSW 3 API).
* `renderWithProviders` wraps components in a fresh `QueryClient` with retries disabled.

### Consequences

* Good, because component tests cover the real client, query and component path, and contract changes break the typed handlers.
* Neutral: jsdom doesn't do layout. Visual and layout-dependent behavior (calendar grids, drag-and-drop) will need browser tests. **Playwright** end-to-end tests are deferred until there are real user flows, and Vitest Browser Mode can be reconsidered for layout-heavy components.

### Confirmation

`pnpm test` / `pnpm test:coverage` run in CI on every PR ([ADR-0012](0012-ci-and-dependency-updates.md)).

## Pros and Cons of the Options

### Vitest

* Good, because **D1 Toolchain integration**: same `vite.config.ts`, aliases and plugins as the app; native ESM/TS.
* Good, because **D2 Feedback speed**: worker-based parallelism and instant watch mode.
* Good, because **D5 AI familiarity**: Jest-compatible API (`describe`/`it`/`expect`/`vi`).

### Jest

* Good, because **D5 AI familiarity**: the longest-established JS test runner.
* Bad, because **D1 Toolchain integration**: needs Babel or ts-jest and separate module mapping; ESM support is still awkward.
* Bad, because **D2 Feedback speed**: slower startup and transforms than Vitest on Vite projects.

### `node:test`

* Good, because **D2 Feedback speed**: built into Node, with zero dependencies.
* Bad, because **D1 Toolchain integration**: no Vite transform, JSX or DOM environment without extra loaders.
* Bad, because **D5 AI familiarity**: few React testing examples.

### React Testing Library + jsdom

* Good, because **D3 User behavior**: queries by role and text; encourages accessible markup.
* Good, because **D2 Feedback speed**: jsdom runs in-process.
* Good, because **D5 AI familiarity**: the de facto React testing standard.
* Bad, because **D3 User behavior**: jsdom has no layout or CSS, so some user-visible behavior can't be asserted.

### Vitest Browser Mode

* Good, because **D3 User behavior**: real browser rendering, layout and events.
* Bad, because **D2 Feedback speed**: needs a browser via Playwright; slower and heavier in CI.
* Bad, because **D5 AI familiarity**: newer, with fewer examples.

### Enzyme-style shallow rendering

* Good, because **D2 Feedback speed**: shallow renders are fast.
* Bad, because **D3 User behavior**: tests component internals; brittle under refactors.
* Bad, because **D5 AI familiarity**: Enzyme is unmaintained and has no React 18/19 adapter.

### MSW

* Good, because **D4 Realistic API faking**: intercepts at the network level, so `openapi-fetch`, TanStack Query and error handling all run for real.
* Good, because **D3 User behavior**: tests describe server responses, not internal calls.
* Good, because **D4 Realistic API faking**: handlers are reusable later in Storybook, the browser or Playwright.
* Bad, because **D4 Realistic API faking**: `openapi-fetch` captures `fetch` at creation time, so the client must pass a late-bound `fetch` (done in `src/api/client.ts`).

### Module mocking (`vi.mock`)

* Good, because **D5 AI familiarity**: simple and common.
* Bad, because **D4 Realistic API faking**: bypasses the client, query and error paths, so bugs there go untested.
* Bad, because **D3 User behavior**: couples tests to module structure.

### Stubbing `fetch`

* Good, because **D4 Realistic API faking**: the client code still runs.
* Bad, because **D4 Realistic API faking**: manual URL matching per test, which isn't reusable across tests or tools.
* Neutral, because **D3 User behavior**: OK, but the setup noise obscures intent.
