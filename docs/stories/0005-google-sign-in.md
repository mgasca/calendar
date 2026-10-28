---
status: in-progress
date: 2026-10-28
pr: TBD
adrs: [0004, 0016, 0019, 0026, 0027]
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

1. **Given** I am signed out, **when** I open any web page, **then** I see the sign-in page.
2. **Given** I am signed out and open `/day/2026-10-29`, **when** I sign in with an allow-listed Google account, **then** I land on that day.
3. **Given** I sign in with an account that is not on the allow-list (or has an unverified email), **when** Google returns, **then** I see an access-denied message and no session is created.
4. **Given** I am signed out, **when** any `/api` route other than health or OpenAPI is called, **then** it returns 401.
5. **Given** I am signed in, **when** I look at the header, **then** my name/avatar is shown, and **when** I choose **Sign out**, **then** the session ends and I return to the sign-in page.
6. **Given** my session expires mid-use, **when** the next API call returns 401, **then** I am sent to sign-in and returned to where I was after signing in.
7. **Given** the app runs behind an HTTPS proxy, **when** I sign in, **then** the cookie is `Secure`, `HttpOnly` and `SameSite`, and the OIDC redirect URI uses the public HTTPS origin.
8. **Given** the API is running, **when** a request arrives from another origin, **then** no CORS headers permit it.
9. **Given** the change is complete, **when** I run `make check`, **then** it passes, including the contract-freshness check.


Test links are to be added by the parent when the implementation and test names are final.

## Design decisions

[ADR-0027](../decisions/0027-google-oidc-bff-session.md) chooses Google OIDC with a same-origin BFF cookie and explains the follow-ups. [ADR-0004](../decisions/0004-openapi-contract-and-generated-client.md) governs the API contract; [ADR-0026](../decisions/0026-client-side-routing-with-tanstack-router.md) governs routing. Google is external, so [ADR-0016](../decisions/0016-local-database-provisioning.md)'s Aspire trigger remains pending.

## Implementation notes

The API provides `GET /api/auth/login?returnUrl`, `GET /api/auth/callback/google`, `GET /api/auth/me` and `POST /api/auth/logout`. The web sign-in route is `/signin`. Configure `Auth__Google__ClientId`, `Auth__Google__ClientSecret` and `Auth__AllowedEmails`. API tests use a fake authentication scheme; web tests cover sign-in and return paths. Regenerate the contract with `make contracts` and run `make check`.

## User guide

Open the calendar and choose **Sign in with Google**. Select an account whose verified email is on the configured allow-list. After sign-in, the calendar returns to the page you requested. Your name and avatar appear in the header; choose **Sign out** to end your session. If access is denied, ask the calendar owner to check the allow-list and your verified Google email. If your session expires, sign in again to return to your page.
