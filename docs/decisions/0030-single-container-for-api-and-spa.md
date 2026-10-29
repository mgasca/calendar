---
status: accepted
date: 2026-10-29
decision-makers: mgasca, Claude (AI assistant)
---

# Single container for the API and SPA

## Context and Problem Statement

[ADR-0002](0002-dotnet-10-minimal-api-backend.md) envisages one container, [ADR-0026](0026-client-side-routing-with-tanstack-router.md) requires SPA deep links, and [ADR-0027](0027-google-oidc-bff-session.md) requires a same-origin BFF cookie. The API does not yet serve static files, and the Azure deployment plan targets a single user or a few allow-listed users with low operational cost. How should the API and built SPA be packaged and served?

## Decision Drivers

* **D1 Simplicity and cost**: keep deployment and operations manageable for a small, cost-conscious installation.
* **D2 Same-origin security**: preserve the BFF cookie and avoid cross-origin browser configuration.
* **D3 Release coherence**: deploy compatible SPA and API versions predictably.
* **D4 Independent operation**: allow each component to release and scale according to its own needs.
* **D5 Routing and caching**: support deep links and efficient, safe static asset caching.

## Considered Options

* One image serving the API and SPA
* Separate web and API containers

## Decision Outcome

Chosen option: "One image serving the API and SPA", because one deployment is simpler for the expected small workload (D1), directly preserves the same origin (D2), and ships a coherent pair (D3). The loss of independent releases and scaling (D4) is acceptable at this scale.

| Driver | **One image serving the API and SPA (chosen)** | Separate web and API containers |
| --- | :---: | :---: |
| D1 Simplicity and cost | ★★★ | ★☆☆ |
| D2 Same-origin security | ★★★ | ★★☆ |
| D3 Release coherence | ★★★ | ★★☆ |
| D4 Independent operation | ★☆☆ | ★★★ |
| D5 Routing and caching | ★★★ | ★★★ |

### Hosting conventions

* A multi-stage Dockerfile builds the frontend with the pinned Node and pnpm toolchain, publishes the API, and copies the built SPA into the runtime image's web root. Both ship as one versioned image; local Vite development retains its API proxy.
* Serve static files and client-side non-file deep links from the API. Exclude `/api` from SPA fallback: unknown API routes return 404, authenticated endpoints retain their 401/403 behavior, and missing assets return 404, as required by [ADR-0026](0026-client-side-routing-with-tanstack-router.md). Public SPA assets must not make API endpoints anonymous.
* Send `Cache-Control: no-cache` for `index.html`; allow long-lived immutable caching only for content-hashed assets, not arbitrary files. Test headers and asset replacement on deployment.
* Keep the browser and API on the same public HTTPS origin without CORS, with the host-only HttpOnly, Secure, SameSite=Lax session cookie and trusted forwarded headers required by [ADR-0027](0027-google-oidc-bff-session.md). Cookie scope is not an authorization boundary for static files; the API remains protected.
* Compute is covered separately by [ADR-0029](0029-azure-container-apps-compute-platform.md). Container image and hosting implementation are tracked in [#75](https://github.com/mgasca/calendar/issues/75) and [#76](https://github.com/mgasca/calendar/issues/76).

### Consequences

* Good, because a single image and origin reduce deployment coordination and browser configuration.
* Bad, because frontend-only changes rebuild and release the API image, and both components scale together.
* Bad, because static-file fallback and caching need explicit implementation and tests; the current API does not provide them.
* Neutral: Azure Container Apps scales replicas of a revision together; the replica settings are a separate infrastructure decision.

### Confirmation

The hosting and image PRs must add tests for `/`, a deep link, missing assets, unknown and unauthorized API routes, cache headers and cookie behavior. Run the built image and smoke-test the SPA, API health and deep links; deployment checks verify HTTPS, cookie attributes and absence of CORS headers. Review the Dockerfile and deployment for one image containing both outputs.

## Pros and Cons of the Options

### One image serving the API and SPA

* Good, because **D1 Simplicity and cost**: one deployable and serving process avoid a separate web service and its operations.
* Good, because **D2 Same-origin security**: the browser addresses one origin and the existing BFF cookie configuration applies without CORS.
* Good, because **D3 Release coherence**: one image bundles compatible API and SPA artifacts.
* Bad, because **D4 Independent operation**: both artifacts release and scale together, even if only one needs resources.
* Good, because **D5 Routing and caching**: ASP.NET Core can serve files, set cache headers and handle SPA fallback, subject to the explicit exclusions above.

### Separate web and API containers

* Bad, because **D1 Simplicity and cost**: an additional service and routing configuration increase operational work and may increase cost.
* Neutral, because **D2 Same-origin security**: a shared-origin reverse proxy can preserve the cookie and avoid CORS, but needs correct routing and proxy configuration.
* Neutral, because **D3 Release coherence**: independently versioned deployments require compatibility and release coordination.
* Good, because **D4 Independent operation**: separate services can be released and scaled independently.
* Good, because **D5 Routing and caching**: a web server can serve static assets, cache them and route SPA deep links; it must also route `/api` correctly.

## More Information

* Microsoft documents [ASP.NET Core static files and response headers](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/static-files?view=aspnetcore-10.0) and [Container Apps revision scaling](https://learn.microsoft.com/en-us/azure/container-apps/scale-app). No pricing or regional availability claim is needed for this decision.
* If measured traffic or release needs make independent scaling or deployment valuable, revisit the topology with a new ADR. The accepted single-container expectation is also recorded in [ADR-0002](0002-dotnet-10-minimal-api-backend.md) and [ADR-0026](0026-client-side-routing-with-tanstack-router.md).
