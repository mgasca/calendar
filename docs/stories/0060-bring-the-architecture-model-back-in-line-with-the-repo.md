---
status: implemented
date: 2026-11-11
issue: https://github.com/mgasca/calendar/issues/689
pr:
  - https://github.com/mgasca/calendar/pull/690
adrs: ["0039", "0047", "0048", "0051", "0052", "0056"]
---

# 0060 Bring the architecture model back in line with the repo

## Story

> As a reader of the documentation site's Architecture section, I need the CALM model to describe the system the repository actually builds, so that the diagrams, controls and flows can be trusted without checking the code.

Tracked in issue #689.

## Background

The architecture model, `docs/architecture/calendar.architecture.json`, is the FINOS CALM description of the system chosen in [ADR-0039](../decisions/0039-architecture-model-and-visualization-tooling.md) and rendered by the documentation site. AGENTS.md asks that it change in the same PR as a new component, endpoint, Azure resource or ADR. Story [0058](0058-move-the-backend-from-dotnet-to-rust.md) moved the backend from .NET to Rust and updated the model's ADR entries, the ADR links on the backend nodes and the note about tzdata in the container image.

A comparison of the model with the repository on `main` at 56b17db9b found that its inventory still matches. All 17 OpenAPI operations, every route the API registers, the 7 web routes, every Azure resource in `infra/` and all 148 repository paths the model cites are present, and the model names nothing the repository lacks. Two kinds of drift remain:

* **Stale descriptions.** Seven fields were found first, and a scan of the model for type and method names that no longer exist in the code found about twenty more. They describe the .NET mechanisms the Rust port replaced: Kestrel, ForwardLimit and KnownProxies, `UseHsts` and `UseHttpsRedirection`, the authorization fallback policy, `OnValidatePrincipal`, the EF Core global query filter (`CalendarDbContext`, `IgnoreQueryFilters`, `ExecuteUpdate` / `ExecuteDelete`), `AsNoTracking`, EF `Concat`, the SQL "EF generates", `LoggerMessage` logging, Microsoft.AspNetCore.OpenApi, the C# query and builder class names, and an "EF model/migrations check" among the quality gates. The observability control also says the API sends telemetry to Application Insights, although nothing in the Rust API or the Bicep connects it. The web app's theme field still says dark mode follows the system, from before the switchable themes of story [0039](0039-switchable-light-and-dark-themes.md).
* **Missing elements.** The `ci-trend.yml` workflow, the `@calendar/theme` package and the Development-only OpenAPI route have no place in the model, and the model README's list of flows leaves out the two edit flows.

The issue holds the full list, with the code that each description is checked against.

### Agreed scope

* **This card first (PR 0):** a docs-only card with the scope and acceptance criteria (Refs #689).
* **Model update (delivery PR):** stacked on the card branch, it rewords the stale descriptions, adds `ci-trend.yml` to the CI workflows, adds a node for `@calendar/theme` with relationships from the web app and the docs site, adds the Development-only OpenAPI route to the API, and adds the edit flows to the README. It closes #689 and marks this card implemented.

### Not in this story

* **Repository tools** such as `seed-dev`, `agent-hooks`, `handover-watch`, `tool-versions` and `doctor`. These are developer and agent tooling, not parts of the running system, and the model has never described them.
* **The tooling ADRs and the tool descriptions** that story 0059 (#686) changes. The delivery PR leaves `metadata.adrs` and `metadata.stories` alone so that it does not conflict with #686.
* **Automating the drift check.** This card records a one-off comparison. A repeatable check is a separate story if it is wanted.

### Acceptance criteria

1. **Given** the model on the delivery branch, **when** a reader looks up how the API listens, trusts forwarded headers, enforces HTTPS, requires a signed-in user, scopes data to its owner, rejects a session without a user id, finds overdue tasks, logs or is gated in CI, **then** each description names the Rust mechanism in `backend/crates`, and no description names a .NET type, method or setting except in ADR titles and in the record of what was ported.
2. **Given** the web app's accessibility control, **when** a reader reads its theme field, **then** it describes the switchable light and dark themes chosen by a `data-theme` attribute (ADR-0047).
3. **Given** the `ci-workflows` interface, **when** it is compared with `.github/workflows/`, **then** every workflow file is listed, including `ci-trend.yml`.
4. **Given** the containers view, **when** the documentation site renders it, **then** `@calendar/theme` appears as a library that the web app and the docs site depend on, linked to ADR-0047 and ADR-0048.
5. **Given** the API node, **when** its interfaces are compared with the routes in `calendar-api/src/app.rs`, **then** every route appears, the Development-only `GET /openapi/v1.json` included.
6. **Given** the change, **when** `just docs architecture` and `just docs test` run, **then** the strict CALM validation reports no errors or warnings and the docs-site tests pass.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0039](../decisions/0039-architecture-model-and-visualization-tooling.md) | FINOS CALM model rendered by the docs site | The model this story corrects, and its validation |
| [0047](../decisions/0047-semantic-css-tokens-selected-by-a-data-theme-attribute.md) | Semantic CSS tokens selected by a `data-theme` attribute | What the theme field and the new theme node describe |
| [0048](../decisions/0048-self-host-theme-fonts-with-fontsource-packages.md) | Self-hosted Fontsource theme fonts | The fonts that `@calendar/theme` ships |
| [0051](../decisions/0051-rust-backend-on-axum-and-tokio.md) | Rust backend on axum and tokio | Replaces the Kestrel and ForwardLimit wording |
| [0052](../decisions/0052-diesel-data-access-with-embedded-sql-migrations.md) | Diesel with embedded SQL migrations | Replaces the EF query and schema-check wording |
| [0056](../decisions/0056-session-cookie-sealed-with-a-database-held-key.md) | Session cookie sealed with a database-held key | Replaces the OnValidatePrincipal wording |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **Model the theme package as a library node.** `@calendar/theme` is shared by two UIs, like `@calendar/api-client`, so it gets the same node type and `connects` relationships rather than a note on each UI.
* **Keep the dev-only OpenAPI route on the API node.** It is an interface of the running API, available only in Development, not a separate component.
* **Repository tools stay out of the model**, as they always have been. See "Not in this story".

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| Model | `docs/architecture/calendar.architecture.json` |
| Model conventions | `docs/architecture/README.md` |

### What changed

* **Descriptions:** the backend interfaces, the authentication, ownership, time, read-consistency, query-performance, observability and transport-security controls, the quality gates, and the read and bulk steps of the flows now name the Rust code: the axum server and `ASPNETCORE_URLS`, the `CurrentUser` extractor, `queries::owned_events` / `owned_tasks`, the sealed session ticket, `FieldErrors::require_date` / `require_time_zone`, Diesel row structs and `union_all`, `queries::task_list::for_view`, the endpoint modules `agenda_builder.rs` and `agenda_order.rs`, `hosting.rs` for forwarded headers, HSTS and the HTTPS redirect, and `tracing`.
* **Correction to the first finding:** the agenda's overdue list still combines its open and completed-within-today branches with `UNION ALL`, now through Diesel's `union_all` (`calendar-infrastructure/src/agenda.rs`). Only the names in that field were stale. The single `OR` predicate in `queries/task_list.rs` belongs to the task list's overdue view.
* **Telemetry:** Application Insights is provisioned (`infra/modules/monitoring.bicep`), but the container app gets no connection string and the API has no telemetry SDK, so the observability control now says so. Whether to wire telemetry is a separate decision, not part of this story.
* **New elements:** a `theme-package` library node with `web-app-uses-theme` and `docs-site-uses-theme` relationships, in the `calendar-system` composition and the containers view; an `api-openapi-document` interface for the Development-only `GET /openapi/v1.json`; and `ci-trend.yml` in `ci-workflows`.
* **README:** the list of nodes names the theme package, and the list of flows includes editing an event and editing a task.

### Testing

* `just docs architecture` (strict CALM validation) reports no errors and no warnings, and `just docs test` and `just docs build` pass on the delivery branch.
* A scan of the model for PascalCase type and method names that do not occur in the backend, frontend, tool, Bicep or workflow sources now finds only `AcrPull` (an Azure role), `NodaTime` and `StyleCop` (in ADR titles). It was run by hand and is not a committed check.

### Lessons learned, known issues and follow-ups

* The first comparison, built on a knowledge graph of the repository, matched inventories (operations, routes, resources, paths) well but missed most of the stale prose. The name scan found it. A future drift check should do both.
* The `.NET 10 file-based app` wording of the infra and dashboard tool nodes belongs to story 0059 (#686), which moves the tools to Deno.

## User guide

### The task the user performs

Open the documentation site's **Architecture** section. The **Containers and deployment** diagram shows the theme package beside the API client, and the controls and flows describe what the Rust backend does.
