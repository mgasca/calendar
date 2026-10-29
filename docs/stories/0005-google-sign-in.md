---
status: implemented
date: 2026-10-28
pr: https://github.com/mgasca/calendar/pull/38
adrs: ["0004", "0016", "0019", "0026", "0027"]
---

# 0005 Google sign-in

## Story

> As the calendar owner, I need to sign in with my Google account so that only people I allow can see or change my calendar once it is on the internet.

## Background

The internet-facing deployment trigger in [ADR-0019](../decisions/0019-single-user-mode-with-authentication-deferred.md) has fired. [ADR-0027](../decisions/0027-google-oidc-bff-session.md) replaces its deferred-auth constraints with Google sign-in and an allow-list. Data remains shared until ownership scoping is implemented.

### Scope

* Google OIDC sign-in, verified-email allow-list and protected API endpoints; health and OpenAPI stay public.
* Sign-in page, account display and sign-out, with deep-link restoration and expired-session handling.
* HTTPS proxy configuration, secure cookies, setup documentation and regenerated API contract.

### Not in this story

* `owner_id` and per-user query scoping; open sign-up, roles, permissions or allow-list administration.
* Bearer authentication for non-browser clients; hosting and infrastructure-as-code.

### Acceptance criteria

1. **Given** I am signed out, **when** I open any web page, **then** I see the sign-in page. [Redirect to sign-in](../../frontend/apps/web/src/features/auth/auth.test.tsx) (`redirects signed-out visitors and preserves a deep link`).
2. **Given** I am signed out and open `/day/2026-10-29`, **when** I sign in with an allow-listed Google account, **then** I land on that day. [Deep link kept in the login URL](../../frontend/apps/web/src/features/auth/auth.test.tsx) (`redirects signed-out visitors and preserves a deep link`); [Local return URLs only](../../backend/tests/Calendar.Api.Tests/Endpoints/AuthenticationTests.cs) (`ReturnUrlsAreLocal`). The return trip through Google itself is not automated; it was checked by hand.
3. **Given** I sign in with an account that is not on the allow-list (or has an unverified email), **when** Google returns, **then** I see an access-denied message and no session is created. [Allow-list and verified-email rule](../../backend/tests/Calendar.Api.Tests/Endpoints/AuthenticationTests.cs) (`OnlyVerifiedAllowedEmailsPass`) and [Access-denied message](../../frontend/apps/web/src/features/auth/auth.test.tsx) (`shows access denied`). (The callback's redirect to `/signin?error=access_denied` and the absence of a session are not covered by an automated test.)
4. **Given** I am signed out, **when** any `/api` route other than health or OpenAPI is called, **then** it returns 401. [Anonymous requests](../../backend/tests/Calendar.Api.Tests/Endpoints/AuthenticationTests.cs) (`AnonymousRoutesReturnUnauthorized`); [Public routes](../../backend/tests/Calendar.Api.Tests/Endpoints/AuthenticationTests.cs) (`PublicRoutesAreAccessible`).
5. **Given** I am signed in, **when** I look at the header, **then** my name/avatar is shown, and **when** I choose **Sign out**, **then** the session ends and I return to the sign-in page. [Header and sign-out](../../frontend/apps/web/src/features/auth/auth.test.tsx) (`shows the user and signs out`); [Cookie cleared](../../backend/tests/Calendar.Api.Tests/Endpoints/AuthenticationTests.cs) (`LogoutClearsCookie`).
6. **Given** my session expires mid-use, **when** the next API call returns 401, **then** I am sent to sign-in and returned to where I was after signing in. [Expired session](../../frontend/apps/web/src/features/auth/auth.test.tsx) (`redirects on an expired session with the current URL`).
7. **Given** the app runs behind an HTTPS proxy, **when** I sign in, **then** the cookie is `Secure`, `HttpOnly` and `SameSite`, and the OIDC redirect URI uses the public HTTPS origin. Configured in `backend/src/Calendar.Api/Program.cs` (`HttpOnly`, `SameSite=Lax`, `Secure` outside Development, forwarded headers). (Not covered by an automated test.)
8. **Given** the API is running, **when** a request arrives from another origin, **then** no CORS headers permit it. [No CORS headers](../../backend/tests/Calendar.Api.Tests/Endpoints/AuthenticationTests.cs) (`CrossOriginRequestHasNoCorsHeaders`).
9. **Given** the change is complete, **when** I run `make check`, **then** it passes, including the contract-freshness check. CI runs `make check` and fails on a stale `contracts/openapi.json` (`.github/workflows/ci.yml`).


## Design decisions

[ADR-0027](../decisions/0027-google-oidc-bff-session.md) chooses Google OIDC with a same-origin BFF cookie and explains the follow-ups. [ADR-0004](../decisions/0004-openapi-contract-and-generated-client.md) governs the API contract; [ADR-0026](../decisions/0026-client-side-routing-with-tanstack-router.md) governs routing. Google is external, so [ADR-0016](../decisions/0016-local-database-provisioning.md)'s Aspire trigger remains pending.

## Implementation notes

The API provides `GET /api/auth/login?returnUrl`, `GET /api/auth/callback/google`, `GET /api/auth/me` and `POST /api/auth/logout`. The web sign-in route is `/signin`. Configure `Auth__Google__ClientId`, `Auth__Google__ClientSecret` and `Auth__AllowedEmails`. API tests use a fake authentication scheme; web tests cover sign-in and return paths. For local seeding, `make db-seed` authenticates with a Development-only key (`Auth__DevSeedKey`, see ADR-0027); `make dev-api` loads `.env`, and `GET /api/auth/login` explains a missing Google configuration with a 503. Known gaps: the Google round trip, the callback's denial path and the cookie/proxy settings have no automated tests; signing in with a real Google account was checked by hand only. Regenerate the contract with `make contracts` and run `make check`.

## User guide

Open the calendar and choose **Sign in with Google**. Select an account whose verified email is on the configured allow-list. After sign-in, the calendar returns to the page you requested. Your name and avatar appear in the header; choose **Sign out** to end your session. If access is denied, ask the calendar owner to check the allow-list and your verified Google email. If your session expires, sign in again to return to your page.
