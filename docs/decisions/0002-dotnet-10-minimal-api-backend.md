---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# .NET 10 LTS with ASP.NET Core Minimal APIs, Domain + Api projects

## Context and Problem Statement

The backend is to be written in .NET (given requirement) and will be deployed as a single container that also serves the built web UI. Which .NET version, API style and initial project structure should we use?

## Decision Drivers

* **D1 Support window**: avoid forced framework upgrades soon after launch.
* **D2 Low ceremony**: little boilerplate per endpoint; mainstream, well-documented patterns that AI agents produce reliably.
* **D3 OpenAPI quality**: accurate, build-time OpenAPI output, which is the contract for all clients ([ADR-0004](0004-openapi-contract-and-generated-client.md)).
* **D4 Domain testability**: business rules testable without the web host.
* **D5 Right-sized structure**: no empty or speculative projects; structure grows with real needs.
* **D6 Container fit**: small, fast-starting single-container deployment.

## Considered Options

* .NET 10 LTS + Minimal APIs + Domain/Api projects
* .NET 10 LTS + MVC controllers + Domain/Api projects
* .NET 10 LTS + Minimal APIs + full Clean Architecture up front (Domain/Application/Infrastructure/Api)
* .NET 11 STS + Minimal APIs + Domain/Api projects

## Decision Outcome

Chosen option: ".NET 10 LTS + Minimal APIs + Domain/Api projects", because it combines the longest support window (D1) with the least ceremony (D2) and a structure sized to the current scope (D5).

| Driver | **.NET 10 + Minimal APIs + Domain/Api (chosen)** | .NET 10 + MVC controllers | .NET 10 + Clean Architecture up front | .NET 11 STS + Minimal APIs |
| --- | :---: | :---: | :---: | :---: |
| D1 Support window | ★★★ | ★★★ | ★★★ | ★☆☆ |
| D2 Low ceremony | ★★★ | ★★☆ | ★☆☆ | ★★★ |
| D3 OpenAPI quality | ★★★ | ★★★ | ★★★ | ★★★ |
| D4 Domain testability | ★★★ | ★★★ | ★★★ | ★★★ |
| D5 Right-sized | ★★★ | ★★★ | ★☆☆ | ★★★ |
| D6 Container fit | ★★★ | ★★☆ | ★★★ | ★★★ |

Details:

* The SDK is pinned in `backend/global.json` (`10.0.100`, `rollForward: latestFeature`).
* Endpoints are grouped per feature as `IEndpointRouteBuilder` extension methods in `Calendar.Api/Endpoints/`.
* ProblemDetails (RFC 9457) is used for errors (`AddProblemDetails`, `UseExceptionHandler`, `UseStatusCodePages`).
* `Calendar.Domain` has no framework dependencies. Application and Infrastructure projects are added when real use cases and persistence arrive.

### Consequences

* Good, because .NET 10 is supported until Nov 2028.
* Good, because the domain is testable without ASP.NET (`Calendar.Domain.Tests`).
* Bad, because .NET 11 features are unavailable until we upgrade. Revisit when .NET 12 LTS ships (Nov 2027).
* Follow-up: to meet the single-container goal, the API must serve the built SPA (`UseStaticFiles` + `MapFallbackToFile("index.html")`), with a multi-stage Dockerfile. This isn't implemented yet.
* Neutral: `CalendarEvent` and `/api/health` are placeholders that prove the pipeline.

### Confirmation

`backend/global.json` pins the SDK, and CI's `setup-dotnet` reads it. Reviewers check that new endpoints follow the `Endpoints/` extension-method pattern.

## Pros and Cons of the Options

### .NET 10 LTS + Minimal APIs + Domain/Api

* Good, because **D1 Support window**: LTS, 3 years of support.
* Good, because **D2 Low ceremony**: one lambda or method per endpoint; this is the default in current Microsoft docs and templates.
* Good, because **D3 OpenAPI quality**: `TypedResults` give precise response schemas to `Microsoft.AspNetCore.OpenApi`.
* Good, because **D4 Domain testability**: domain rules live in a framework-free project.
* Good, because **D5 Right-sized**: two projects, both with content.
* Good, because **D6 Container fit**: minimal APIs are trimming/AOT-friendly and start fast.

### .NET 10 LTS + MVC controllers

* Good, because **D1**, **D3**, **D4**, **D5**: same as the chosen option.
* Bad, because **D2 Low ceremony**: controller classes, attributes and action filters add boilerplate for a small API.
* Bad, because **D6 Container fit**: MVC is not Native-AOT compatible and has a larger startup cost.

### .NET 10 LTS + Clean Architecture up front

* Good, because **D4 Domain testability**: enforces separation from day one.
* Bad, because **D5 Right-sized**: Application and Infrastructure projects would be empty, with nothing to persist or orchestrate yet.
* Bad, because **D2 Low ceremony**: mediator/handler layers add indirection that every feature (and agent) must follow.

### .NET 11 STS + Minimal APIs

* Good, because **D2**, **D3**: the newest framework features.
* Bad, because **D1 Support window**: not GA as of 2026-10 (pre-release builds only). Once released, its 24-month STS support ends around the same time as .NET 10 LTS (Nov 2028), so it gains no support time but carries pre-release risk now.

## More Information

* The `Program` class is not declared `public partial`: in .NET 10 the generated `Program` class is already accessible to `WebApplicationFactory<Program>`. Adding the declaration triggers Sonar S1118.
