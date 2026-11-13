---
status: accepted
date: 2026-11-13
decision-makers: mgasca, Claude (AI assistant)
---

# End-to-end UI tests with Playwright Test in frontend/apps/e2e, bound to the architecture flows

## Context and Problem Statement

[ADR-0008](0008-frontend-testing-stack.md) chose Vitest, Testing Library and MSW for the frontend and deferred Playwright end-to-end tests "until there are real user flows". The architecture model now defines seven user-facing flows ([ADR-0039](0039-architecture-model-and-visualization-tooling.md)), and epic #728 (story [0064](../stories/0064-test-every-user-flow-end-to-end-and-prove-it-is-observable.md)) asks for one browser test per flow against the real web app, API and PostgreSQL, each also asserting the flow's telemetry ([ADR-0062](0062-opentelemetry-over-otlp-with-grafana-lgtm-locally-and-application-insights-in-azure.md)). The repository already drives Chromium from Deno for the run-calendar skill ([ADR-0058](0058-typescript-on-deno-for-repository-tooling.md)). Which runner, home and binding should the end-to-end suite use?

## Decision Drivers

* **D1 Real-stack fidelity**: the test navigates the built web app in a real browser, through the API to PostgreSQL, including the cross-origin redirect to an identity provider and back.
* **D2 Flow binding**: each test can carry its CALM flow `unique-id`, the suite can list tests with their tags without a browser, and one flow can be run alone, so a check can bind the model's flows to tests.
* **D3 Diagnosability**: a failed nightly run, which nobody watched, leaves enough to see what happened: a step-by-step trace, screenshots and an HTML report as CI artifacts.
* **D4 Workspace fit**: lives in the pnpm workspace with TypeScript 6, ESLint 9 and the generated contract client like every other UI consumer ([ADR-0005](0005-pnpm-workspace-for-frontend.md), [ADR-0010](0010-toolchain-version-pins.md)), without a second runtime for application tests.
* **D5 Cost and CI weight**: no paid service for parallel runs or reports; runs nightly on a GitHub-hosted runner.
* **D6 AI familiarity**: mainstream, with abundant examples, so agents write and repair tests reliably.

## Considered Options

* Playwright Test in a pnpm workspace package
* Playwright library driven from Deno (the run-calendar driver)
* Vitest Browser Mode
* Cypress

## Decision Outcome

Chosen option: "Playwright Test in a pnpm workspace package", because it is the only option that runs whole-app flows across origins (D1), lists and filters tests by tag (D2), records a trace per test (D3) and sits in the existing workspace (D4) at no cost (D5), with the most examples (D6).

| Driver | **Playwright Test in a pnpm workspace package (chosen)** | Playwright library driven from Deno | Vitest Browser Mode | Cypress |
| --- | :---: | :---: | :---: | :---: |
| D1 Real-stack fidelity | ★★★ | ★★★ | ★☆☆ | ★★☆ |
| D2 Flow binding | ★★★ | ★☆☆ | ★★☆ | ★★☆ |
| D3 Diagnosability | ★★★ | ★☆☆ | ★★☆ | ★★☆ |
| D4 Workspace fit | ★★★ | ★☆☆ | ★★★ | ★★☆ |
| D5 Cost and CI weight | ★★★ | ★★★ | ★★★ | ★★☆ |
| D6 AI familiarity | ★★★ | ★☆☆ | ★☆☆ | ★★★ |

### Conventions

* **Home:** `frontend/apps/e2e`, a private workspace package with `@playwright/test`, its own `playwright.config.ts`, and the same lint, format and type-check rules as the other apps. It may import `@calendar/api-client` to seed data through the API, never backend code.
* **Browser:** one project, `chromium` (`devices['Desktop Chrome']`). Another browser is a new decision.
* **Stack:** the suite runs against its own throwaway stack ([ADR-0063](0063-docker-compose-profiles-for-local-backing-services-instead-of-aspire.md)), never the shared `calendar` Compose project, its volume or port 5432. The stub OIDC provider stands in for Google in the sign-in flow ([ADR-0064](0064-stub-oidc-provider-for-sign-in-tests.md)); other flows sign in with the development seed-key scheme as a fixture.
* **Determinism:** each test pins the browser clock and time zone, since the client decides what day it is ([ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md)), and seeds its own data.
* **Tags:** every test carries `tag: '@flow:<unique-id>'` for the flow it exercises; `--grep @flow:<id>` runs one flow.
* **Binding check:** a flow is user-facing when one of its transitions uses the `user-uses-web-app` relationship (today `sign-in-flow`, `view-today-flow`, `add-event-flow`, `edit-event-flow`, `edit-task-flow`, `toggle-task-flow` and `overdue-triage-flow`; `database-migration-flow` and `publish-docs-flow` are not). The check reads the model and `playwright test --list --reporter=json` and fails when a user-facing flow has no tagged test or a tag names a flow the model does not define. A committed pending list holds the flows whose slice has not landed; the check fails if a pending flow has a test, and the list ends empty. The check needs no browser or stack, so it runs with the frontend tests on every pull request. Each flow's model entry links its test.
* **Cadence:** nightly on `main` and on `workflow_dispatch`, plus a `just` recipe that brings the stack up, runs the suite and tears it down. Not on every pull request. Traces are kept on failure (`trace: 'retain-on-failure'`), and the HTML report and traces are uploaded as artifacts.

### Consequences

* Good, because each user-facing flow gets one test that drives the real stack, and the model and the suite cannot drift apart silently.
* Good, because a failed nightly run can be replayed step by step in the trace viewer.
* Bad, because a regression that only the browser suite catches is found the next morning, not on the pull request.
* Bad, because the workspace gains a Chromium download and a second set of browser-driving code beside the run-calendar driver.
* Neutral, because [ADR-0008](0008-frontend-testing-stack.md)'s component tests stay the first line of defence; the E2E suite covers the flows end to end, not every state.

### Confirmation

* The binding check runs on every pull request with the frontend tests and fails on an uncovered or unknown flow.
* The nightly workflow runs the whole suite and uploads its report (#737).
* Review rule: a new user-facing flow in the model comes with its test or a pending entry.

## Pros and Cons of the Options

### Playwright Test in a pnpm workspace package

* Good, because **D1 Real-stack fidelity**: drives Chromium over CDP from outside the page, so redirects to another origin (the stub OIDC provider) and back are ordinary navigation.
* Good, because **D2 Flow binding**: tests take a `tag` option and `--grep`, and `--list` with the JSON reporter enumerates tests and tags without launching a browser.
* Good, because **D3 Diagnosability**: the trace viewer records actions, DOM snapshots, network and console per test, and the HTML reporter writes a self-contained folder.
* Good, because **D4 Workspace fit**: an npm package in the pnpm workspace, TypeScript-native, with the contract client importable.
* Good, because **D5 Cost and CI weight**: Apache-2.0, sharding and reports built in, no hosted service.
* Good, because **D6 AI familiarity**: the most widely used browser test runner for new projects.
* Bad, because **D4 Workspace fit**: adds a browser download to installs that run the suite, which the recipe and CI cache must handle.

### Playwright library driven from Deno (the run-calendar driver)

* Good, because **D1 Real-stack fidelity**: the same browser engine and API as Playwright Test.
* Good, because **D5 Cost and CI weight**: no extra package; the driver already exists.
* Bad, because **D2 Flow binding**: the library has no test runner, so tags, listing, filtering, retries and fixtures would be built by hand.
* Bad, because **D3 Diagnosability**: no HTML report or per-test trace management without the runner.
* Bad, because **D4 Workspace fit**: puts application tests on the tooling runtime that [ADR-0058](0058-typescript-on-deno-for-repository-tooling.md) scoped to repository tooling, outside the pnpm workspace; Playwright Test has no Deno support and a reported Chromium launch hang on Deno 2.1.5 and later is open.
* Bad, because **D6 AI familiarity**: few examples of Playwright on Deno.

### Vitest Browser Mode

* Good, because **D4 Workspace fit**: the runner the web app already uses ([ADR-0008](0008-frontend-testing-stack.md)), with its config and transforms.
* Good, because **D5 Cost and CI weight**: no service, and the Playwright provider is a separate small package.
* Neutral, because **D2 Flow binding**: tests can be named and filtered, but the binding would rest on naming conventions rather than a first-class tag listing.
* Bad, because **D1 Real-stack fidelity**: it runs test code inside the page Vite serves, aimed at component tests; navigating a separately served app and a cross-origin sign-in is not what it is built for.
* Bad, because **D3 Diagnosability**: screenshots on failure, but no trace of a whole multi-page flow.
* Bad, because **D6 AI familiarity**: browser mode left experimental only in Vitest 4, so examples of full-flow tests are rare.

### Cypress

* Good, because **D6 AI familiarity**: long established, with many examples.
* Good, because **D3 Diagnosability**: time-travel snapshots in the runner and screenshots and videos in CI.
* Neutral, because **D1 Real-stack fidelity**: runs inside the browser; a cross-origin sign-in needs `cy.origin`, and Chromium-family, Firefox and experimental WebKit are supported.
* Bad, because **D2 Flow binding**: tags need a plugin, and listing tests with tags without running them is not built in.
* Bad, because **D4 Workspace fit**: its own bundler and command chain beside Vite, and a binary download outside the npm package.
* Bad, because **D5 Cost and CI weight**: parallel runs require recording to Cypress Cloud.

## More Information

* **Relation to [ADR-0008](0008-frontend-testing-stack.md):** this record adds the end-to-end layer that [ADR-0008](0008-frontend-testing-stack.md) deferred; [ADR-0008](0008-frontend-testing-stack.md)'s choices stand and carry an amendment pointing here.
* **Versions at the time of writing (2026-11-13):** `@playwright/test` 1.65.0 (Apache-2.0); `vitest`, `@vitest/browser` and `@vitest/browser-playwright` 5.1.0 (MIT); Cypress 16.3.0 (MIT). Sources: `npm view`; playwright.dev (test annotations, projects, reporters); vitest.dev blog "Vitest 4" (browser mode no longer experimental); docs.cypress.io (launching browsers, parallelization requires `--record`); microsoft/playwright#3146 and denoland/deno#27623 (Deno support).
* **Delivery:** epic #728, children #733 (harness, binding, first flow), #734 to #736 (flows) and #737 (nightly workflow).
* **Revisit** when a second browser engine matters to users, or when pull-request feedback from the suite is worth its CI time.
