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
* Bad, because static-file fallback and caching need explicit implementation and tests. The API didn't provide them when this was decided. PR #108 added them later, as the amendment below records.
* Neutral: Azure Container Apps scales replicas of a revision together; the replica settings are a separate infrastructure decision.

### Confirmation

The hosting and image PRs must add tests for `/`, a deep link, missing assets, unknown and unauthorized API routes, cache headers and cookie behavior. Run the built image and smoke-test the SPA, API health and deep links; deployment checks verify HTTPS, cookie attributes and absence of CORS headers. Review the Dockerfile and deployment for one image containing both outputs. The amendment of 2026-11-07 below records which of these checks exist and which are still outstanding.

### Amendment, 2026-11-07: static-file and SPA hosting delivered

Recorded for the ADR sweep epic [#473](https://github.com/mgasca/calendar/issues/473) in [issue #479](https://github.com/mgasca/calendar/issues/479), with the maintainer's approval. The decision is unchanged and is not re-rated. The context above describes the hosting as decided on 2026-10-29, when the API did not yet serve static files.

#### What was delivered

* **Hosting**, [PR #108](https://github.com/mgasca/calendar/pull/108) (merged 2026-10-29, issue #76). `backend/src/Calendar.Api/Program.cs` makes these changes:
  * It runs `UseStaticFiles` only for paths outside `/api`.
  * It sends `Cache-Control: no-cache` for `index.html`.
  * It sends `public, max-age=31536000, immutable` only for files under `/assets/` whose names carry an 8-character content hash, and no `Cache-Control` for other files.
  * It maps `/api/{**path}` to a 404.
  * Every other path goes to a fallback that returns 404 for a path with a file extension, and `index.html` (`no-cache`) for the rest.
  * The fallbacks are anonymous, and the authenticated-user fallback authorization policy still guards the API endpoints.
  * Forwarded headers are trusted for one hop.
* **Image**, [PR #114](https://github.com/mgasca/calendar/pull/114) (merged 2026-10-29, closes #75). The root `Dockerfile` builds the web app with the pinned Node and pnpm, publishes the API and copies the web build into `wwwroot/` of one non-root runtime image. The CI `Container image` job builds that image and runs `just image smoke` (`image.just`) against it.

#### Confirmation checks

The tests below are in `backend/tests/Calendar.Api.Tests/Endpoints/`, and the links point to them at commit `0b579c435`.

* **`/` and a deep link:** tested. [`HostingTests.SpaRoutingAndCacheHeaders`](https://github.com/mgasca/calendar/blob/0b579c4352c79c669c0b58f026bff24195038c48/backend/tests/Calendar.Api.Tests/Endpoints/HostingTests.cs#L14-L60) checks that `/` and `/day/2026-10-29` return `index.html`. The image smoke test checks `/` and `/week`.
* **Missing assets:** tested. `/assets/missing.js` returns 404 in the same test.
* **Unknown API routes:** tested. `/api/unknown` returns a 404 that is not HTML, in the same test and the image smoke test.
* **Unauthorized API routes:** tested for 401. Anonymous `/api/auth/me` returns 401 in the same test, and anonymous `/api/tasks` returns 401 in the smoke test. No hosting test checks a 403; follow-up [#497](https://github.com/mgasca/calendar/issues/497).
* **Cache headers:** tested in the same test: `no-cache` for `index.html`, `immutable` for a hashed asset, and none for an unhashed one.
* **Cookie behavior:** partly tested. [`HostingTests.ForwardedHttpsSetsGoogleRedirectAndSecureCookie`](https://github.com/mgasca/calendar/blob/0b579c4352c79c669c0b58f026bff24195038c48/backend/tests/Calendar.Api.Tests/Endpoints/HostingTests.cs#L62-L99) checks that, behind a forwarded HTTPS hop, the Google redirect uses the public origin and the cookies set by the sign-in challenge and by sign-out are `Secure`. `HttpOnly` and `SameSite=Lax` are configured in `Program.cs`, but no test asserts them; follow-up [#497](https://github.com/mgasca/calendar/issues/497).
* **No CORS headers:** tested in-process. [`AuthenticationTests.CrossOriginRequestHasNoCorsHeaders`](https://github.com/mgasca/calendar/blob/0b579c4352c79c669c0b58f026bff24195038c48/backend/tests/Calendar.Api.Tests/Endpoints/AuthenticationTests.cs#L101-L109) checks that a cross-origin request gets no `Access-Control-Allow-Origin`.
* **One image with both outputs:** checked. The `Dockerfile` produces one image, and the CI image job builds and smoke-tests it.
* **Deployment checks:** not verified. No Azure deployment has run, so none of these has been checked in Azure Container Apps: HTTPS, cookie attributes and the absence of CORS headers at the public origin, header behavior through the ingress, and asset replacement on a release. They remain open with the deployment issues #79 and #83.

#### Where the checks ran

The `Backend` and `Container image` CI jobs passed on `main` at `082c64e08` (CI run [42406004961](https://github.com/mgasca/calendar/actions/runs/42406004961)). Both hosting tests also passed locally on 2026-11-07.

**Update, 2026-11-08 ([#497](https://github.com/mgasca/calendar/issues/497), [story 0049](../stories/0049-assert-the-partly-tested-spa-hosting-requirements.md)):** the 403 response and the cookie attributes are now asserted in `backend/tests/Calendar.Api.Tests/Endpoints/HostingTests.cs`. `DeniedApiRequestIsForbiddenNotRedirected` shows a signed-in user who fails the authorization policy gets 403 with no redirect from an `/api` route. `SessionCookieIsHttpOnlyAndSameSiteLax` shows the `Set-Cookie` header the cookie scheme writes (on sign-out) carries `httponly` and `samesite=lax`. The decision is unchanged and not re-rated. No Azure deployment check has run.

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
* **Amendment, 2026-11-07:** the static-file and SPA hosting was delivered by PR #108 and the single image by PR #114, with in-process hosting tests and a CI image smoke test. A 403 response and the `HttpOnly` and `SameSite` cookie attributes are not asserted (follow-up #497). No deployment check has run in Azure. The decision is unchanged and not re-rated, so this ADR was amended, not superseded.
* **Amendment, 2026-11-11:** the single image now holds the Rust API binary, the `calendar-migrate` binary and the web app on a distroless base, instead of an ASP.NET runtime image ([ADR-0051](0051-rust-backend-on-axum-and-tokio.md)). The decision stands: one container serves the API and the SPA, with the same static-file and fallback rules.
