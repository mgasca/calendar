---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# .NET 10 LTS with ASP.NET Core Minimal APIs for the backend

## Context and Problem Statement

The backend is to be written in .NET (given requirement). Which version and API style should we use, and how should the projects be split?

## Decision Drivers

* Long support window
* Low ceremony and good OpenAPI support
* Domain logic testable without the web host

## Considered Options

* .NET 10 (LTS, Nov 2025) vs. .NET 11 (STS, not yet GA as of 2026-10)
* Minimal APIs vs. MVC controllers
* Project split: Domain + Api now vs. full Clean Architecture (Domain/Application/Infrastructure/Api) up front

## Decision Outcome

* **.NET 10 LTS**, pinned in `backend/global.json` (`10.0.100`, `rollForward: latestFeature`).
* **Minimal APIs**, with endpoints grouped per feature as `IEndpointRouteBuilder` extension methods in `Calendar.Api/Endpoints/`.
* **Two projects to start**: `Calendar.Domain` (no framework dependencies) and `Calendar.Api`. Application and Infrastructure projects are added when real use cases and persistence arrive, rather than created empty.
* ProblemDetails (RFC 9457) for error responses (`AddProblemDetails`, `UseExceptionHandler`, `UseStatusCodePages`).
* The `Program` class is not declared `public partial`: in .NET 10 the generated `Program` class is already accessible to `WebApplicationFactory<Program>`.

### Consequences

* Good, because LTS gives support until Nov 2028; the SDK floor lets patch and feature bands roll forward.
* Good, because the domain is testable without ASP.NET.
* Bad, because .NET 11 features are unavailable until we upgrade. Revisit when .NET 12 LTS ships.
* Neutral: `CalendarEvent` and `/api/health` are placeholders that prove the pipeline and are expected to change.
