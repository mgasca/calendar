---
status: implemented
date: 2026-11-08
issue: https://github.com/mgasca/calendar/issues/497
pr:
  - https://github.com/mgasca/calendar/pull/537
  - https://github.com/mgasca/calendar/pull/542
adrs: ["0026", "0027", "0030"]
---

# 0049 Assert the partly tested SPA hosting requirements

## Story

> As the maintainer, I need the SPA hosting requirements of ADR-0026 and ADR-0030 to be asserted by tests, so that a regression in static files, API 404s, the 403 response or the session cookie attributes fails the build instead of reaching a deployment.

Tracked in issue #497, a follow-up deferred from epic #473 and [0045](0045-resolve-the-adr-sweep-findings-of-2026-11-07.md).

## Background

The API serves the built SPA (`UseStaticFiles` and `MapFallback` in `backend/src/Calendar.Api/Program.cs`). The 2026-11-07 amendments of [ADR-0026](../decisions/0026-client-side-routing-with-tanstack-router.md) and [ADR-0030](../decisions/0030-single-container-for-api-and-spa.md) name four requirements as only partly tested, and link #497. `backend/tests/Calendar.Api.Tests/Endpoints/HostingTests.cs` (`SpaRoutingAndCacheHeaders`) is where they belong. Story 0045 moved the tests out of its scope because it only resolved the sweep's documentation findings.

### Agreed scope

* **Asset served as a file:** an existing static asset returns 200 with its exact body, not only the `immutable` cache header.
* **Unknown `/api` path:** returns 404 with an `application/problem+json` body, not only a non-HTML 404.
* **403:** a hosting test covers a signed-in request that is denied by an authorization policy: an `/api` route returns 403 and does not redirect. The redirect branch of `RedirectOrStatus` for non-`/api` paths is unreachable today (no non-API route requires sign-in), so it is not tested. The 401 case stays as it is.
* **Session cookie attributes:** the `Set-Cookie` header written by the cookie scheme (observed on sign-out, which the existing cookie test also uses) carries `HttpOnly` and `SameSite=Lax`. A full Google sign-in is not run in tests.
* **ADR amendments:** ADR-0026 and ADR-0030 each get a short dated note that these requirements are now tested, linking the tests. The notes do not change the decisions or re-rate them.

### Not in this story

* **Deployment-only checks** (Azure ingress, picking up the assets of a new release): owned by #79 to #83.
* **Production code changes.** The behaviour is already implemented; if a test shows it is wrong, that is a separate bug issue.
* **New endpoints.** Any endpoint a 403 test needs exists only inside the test host.
* **The image smoke test** (`just image smoke`) is not extended.

### Acceptance criteria

1. **Given** a web root with an existing asset, **when** I request it, **then** the response is 200 and the body is the asset's content. Test: [`SpaRoutingAndCacheHeaders`](../../backend/tests/Calendar.Api.Tests/Endpoints/HostingTests.cs).
2. **Given** an unknown path under `/api`, **when** I request it, **then** the response is 404 with media type `application/problem+json` and a problem-details body whose `status` is 404. Test: [`SpaRoutingAndCacheHeaders`](../../backend/tests/Calendar.Api.Tests/Endpoints/HostingTests.cs).
3. **Given** a signed-in user who fails an authorization policy, **when** they request an `/api` route, **then** the response is 403 and not a redirect. Test: [`DeniedApiRequestIsForbiddenNotRedirected`](../../backend/tests/Calendar.Api.Tests/Endpoints/HostingTests.cs).
4. **Given** the cookie scheme writes the session cookie header (sign-out), **then** the `Set-Cookie` header contains `httponly` and `samesite=lax`. Test: [`SessionCookieIsHttpOnlyAndSameSiteLax`](../../backend/tests/Calendar.Api.Tests/Endpoints/HostingTests.cs).
5. **Given** ADR-0026 and ADR-0030, **when** I read their latest amendments, **then** they link the new tests and no longer call these four requirements partly tested.
6. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0026](../decisions/0026-client-side-routing-with-tanstack-router.md) | Deep links are served by the API; unknown `/api` paths stay 404 problem details | Source of the asset and problem-details requirements |
| [0027](../decisions/0027-google-oidc-bff-session.md) | Cookie session with a host-only HttpOnly, Secure, SameSite=Lax cookie | Source of the cookie attributes |
| [0030](../decisions/0030-single-container-for-api-and-spa.md) | One container serves the API and the SPA; 401/403 behaviour is retained | Source of the 403 requirement |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **Test, not change:** only tests and two dated doc notes change, because the issue asks for assertions about existing behaviour.
* **No probe endpoint:** no production route denies a signed-in user, so the test overrides the fallback authorization policy in the test host to require a claim nobody has, and sets the cookie scheme as the forbid scheme so the real `OnRedirectToAccessDenied` handler runs.

## Implementation notes

Delivered; see the PRs in the front matter.

### Where things live

| Area | Location |
| --- | --- |
| Hosting tests | `backend/tests/Calendar.Api.Tests/Endpoints/HostingTests.cs` |
| Fake sign-in used by tests | `backend/tests/Calendar.Api.Tests/FakeAuthenticationHandler.cs` |
| 401/403 handling under test | `backend/src/Calendar.Api/Endpoints/AuthEndpoints.cs` (`RedirectOrStatus`), `backend/src/Calendar.Api/Program.cs` |
| Amendments | `docs/decisions/0026-*.md`, `docs/decisions/0030-*.md` |

### API

No changes.

### Testing

* In-process hosting tests (`WebApplicationFactory`, no database connection) in `HostingTests`. Negative control: with `HttpOnly` off, `SameSite` set to Strict and the 403 handler returning 418, the cookie and 403 tests failed; the production file was then restored. The asset and problem-details assertions were not mutation-tested.

### Lessons learned, known issues and follow-ups

* Behaviour already matched the ADRs; no production change was needed. `/api/unknown` already returned `application/problem+json`.

## User guide

*No user-facing behaviour changed.*

No user-visible change: this story adds tests only.
