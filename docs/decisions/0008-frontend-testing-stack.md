---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# Vitest, Testing Library and MSW for frontend tests

## Context and Problem Statement

Which tools should the frontend use for unit and component tests?

## Considered Options

* Vitest vs. Jest
* React Testing Library vs. Enzyme-style shallow rendering
* Mock Service Worker (MSW) vs. mocking modules or fetch directly

## Decision Outcome

* **Vitest** shares Vite's config and transform pipeline, is ESM- and TS-native with no Babel/ts-jest, and is Jest-compatible. jsdom is the test environment for the web app.
* **@testing-library/react** + **jest-dom** + **user-event** test behavior the way users see it (roles, text), not implementation details.
* **MSW** mocks at the network layer, with shared default handlers in `src/test/server.ts`, typed with the generated API schema, and overridden per test with `server.use(...)`. Unhandled requests fail the test (`onUnhandledFrame: 'error'`, the MSW 3 API).
* **@vitest/coverage-v8** for coverage.

### Consequences

* Good, because components are tested through the real API client and TanStack Query stack.
* Neutral: browser end-to-end tests (Playwright) aren't set up yet. Add them when there are real user flows worth covering.
