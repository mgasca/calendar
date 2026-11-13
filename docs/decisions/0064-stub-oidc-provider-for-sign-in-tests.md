---
status: proposed
date: 2026-11-13
decision-makers: mgasca, Claude (AI assistant)
---

# Stub OIDC provider for sign-in tests, reached only through Development-only loopback settings

## Context and Problem Statement

The API signs people in with Google through the OpenID Connect authorization-code flow and a cookie session ([ADR-0027](0027-google-oidc-bff-session.md)). It sends the browser to Google's authorization endpoint with `state`, a PKCE challenge and a `nonce`. It then redeems the code at Google's token endpoint, checks the ID token's audience, issuer, expiry and nonce, reads `email` and `email_verified` from the userinfo endpoint, and applies the allow-list (`calendar-api/src/auth/google.rs`). The endpoints are a `GoogleEndpoints` value that only tests can replace, through `AppOptions`, and the accepted issuers are a constant. The Rust API tests already run the round trip against an in-process fake of the token and userinfo endpoints (`calendar-api/tests/google_sign_in.rs`).

The end-to-end `sign-in-flow` test ([ADR-0061](0061-end-to-end-ui-tests-with-playwright-test-bound-to-the-architecture-flows.md), #736) needs a provider the *browser* can visit, in the throwaway stack ([ADR-0063](0063-docker-compose-profiles-for-local-backing-services-instead-of-aspire.md)). #104's API-level tests may reuse it. Which stub provider should stand in for Google, how is the API pointed at it, and what keeps it out of staging and production?

## Decision Drivers

* **D1 Fidelity to the Google round trip**: authorization endpoint with `state`, PKCE (S256) and `nonce` echoed into the ID token; token endpoint; userinfo endpoint; a fixed issuer, so the API's real code path runs unchanged.
* **D2 Per-test control of claims**: a test chooses who signs in, including an email that is not allow-listed and an unverified one, without a user store to maintain.
* **D3 Kept out of staging and production**: the stub, and any setting that points the API at it, cannot take effect in a deployed environment, even by misconfiguration.
* **D4 Weight and start-up**: starts quickly with little memory beside PostgreSQL, LGTM, the API and Chromium on a CI runner.
* **D5 Supply chain and maintenance**: a pinned image from an active, permissively licensed project, or code the repository owns, with no licence condition that bites later.
* **D6 Reuse and effort**: little new code, and usable by #104 without Docker where the in-process fake already serves.

## Considered Options

* `navikt/mock-oauth2-server`
* Soluto `oidc-server-mock`
* Dex with static users
* Keycloak in development mode
* A stub written in the repository in Rust, grown from the test fake

## Decision Outcome

Chosen option: "`navikt/mock-oauth2-server`", because it implements the whole authorization-code flow with PKCE, userinfo and a stable issuer (D1). Its interactive login page lets a browser test type the username and the claims (`email`, `email_verified`) of each sign-in, with no user store (D2). It is MIT-licensed and actively released (D5), and it costs the repository no server code (D6). The guard in the API (D3) is the same whichever stub is used and is part of this decision.

| Driver | **`navikt/mock-oauth2-server` (chosen)** | Soluto `oidc-server-mock` | Dex with static users | Keycloak in development mode | In-repository Rust stub |
| --- | :---: | :---: | :---: | :---: | :---: |
| D1 Fidelity to the Google round trip | ★★★ | ★★☆ | ★★☆ | ★★★ | ★★☆ |
| D2 Per-test control of claims | ★★★ | ★☆☆ | ★☆☆ | ★★☆ | ★★★ |
| D3 Kept out of staging and production | ★★★ | ★★★ | ★★★ | ★★★ | ★★☆ |
| D4 Weight and start-up | ★★☆ | ★★☆ | ★★★ | ☆☆☆ | ★★★ |
| D5 Supply chain and maintenance | ★★★ | ★☆☆ | ★★★ | ★★★ | ★★☆ |
| D6 Reuse and effort | ★★☆ | ★★☆ | ★★☆ | ★☆☆ | ★★☆ |

### Pointing the API at the stub

* **Settings:** four new optional settings, named like the existing ones: `Auth__Google__AuthorizationEndpoint`, `Auth__Google__TokenEndpoint`, `Auth__Google__UserInfoEndpoint` and `Auth__Google__Issuer`. When set, they replace the matching `GoogleEndpoints` field and the accepted issuer. With none set, the API uses Google's endpoints and issuers as today.
* **Stub configuration:** the stub runs in the end-to-end stack and, opt-in, in development (`sign-in-stub` profile, [ADR-0063](0063-docker-compose-profiles-for-local-backing-services-instead-of-aspire.md)). Its issuer id is the first path segment (for example `http://127.0.0.1:<port>/google`). The client id and secret are fixed test values in the stack's environment, never in Key Vault.
* **Who signs in:** the sign-in test fills the stub's login form with the email and `email_verified` it needs. The other flows keep signing in with the development seed-key scheme ([story 0021](../stories/0021-sign-in-locally-without-google.md)).

### Guard

* **Development only:** the API refuses to start when any override is set and the environment is not `Development`. That is already the boundary of the development seed-key scheme, so the end-to-end stack runs the API as `Development`.
* **Loopback only:** the API refuses to start when an override names a host other than `127.0.0.1`, `::1` or `localhost`. A Development configuration copied to a server still cannot send sign-ins elsewhere.
* **Never deployed:** Bicep, the parameter files and Key Vault never carry these settings, and the stub never appears in `infra/`. Staging and production keep their own Google clients ([ADR-0035](0035-separate-staging-and-production-environments.md)).
* **Tested:** unit tests in `calendar-api/src/config.rs` prove both refusals and the no-override default (#730).
* **ID token signature:** the API does not verify the ID token's signature. It relies on receiving the token directly from the token endpoint over TLS (OpenID Connect Core, section 3.1.3.7). Against the stub that channel is plain HTTP on loopback, acceptable only because of the two refusals above.

### #104

#104's API-level tests keep the in-process fake in `google_sign_in.rs` where it suffices, since they need no browser and no extra container. They use the stub only for a case the fake cannot express. #104 re-posts its design and says which gaps remain.

### Consequences

* Good, because `sign-in-flow` runs the real login, callback, session and `returnUrl` path in a browser.
* Good, because the override settings are inert outside a loopback Development run.
* Bad, because the API gains configuration surface on its authentication path, which the guard and its tests must keep honest.
* Bad, because the stub is a JVM service of unmeasured start-up time in the end-to-end stack; #730 measures it.
* Neutral, because the stub is not Google: Google-specific behaviour (consent screens, account choosers, real tokens) stays checked by hand per story 0005.

### Confirmation

* Config unit tests prove the refusals and the default (#730).
* `sign-in-flow`'s end-to-end test passes through the stub (#736).
* Review rule: a change that sets an `Auth__Google__*Endpoint` or `Auth__Google__Issuer` value in `infra/` is rejected.

## Pros and Cons of the Options

### `navikt/mock-oauth2-server`

* Good, because **D1 Fidelity to the Google round trip**: authorization code with PKCE (`plain` and `S256`), token and userinfo endpoints, discovery, and an issuer taken from the first path segment.
* Good, because **D2 Per-test control of claims**: the standalone interactive login page posts a username and optional claims JSON; `requestMappings` can also map usernames to claims.
* Good, because **D3 Kept out of staging and production**: an image used only by Compose profiles; the guard does the rest.
* Neutral, because **D4 Weight and start-up**: a JVM service; its start-up and memory were not measured at the time of writing.
* Good, because **D5 Supply chain and maintenance**: MIT, released on 2026-11-09, published to `ghcr.io`, and documented as for testing only.
* Neutral, because **D6 Reuse and effort**: no server code to write, but #104's Docker-free tests cannot use a container and keep the in-process fake.

### Soluto `oidc-server-mock`

* Good, because **D1 Fidelity to the Google round trip**: a full OpenID Connect server (Duende IdentityServer), with PKCE configurable per client.
* Bad, because **D2 Per-test control of claims**: users and claims are fixed in configuration, or managed through an extra endpoint.
* Good, because **D3 Kept out of staging and production**: same as any image used only locally.
* Neutral, because **D4 Weight and start-up**: a .NET server.
* Bad, because **D5 Supply chain and maintenance**: last release in May 2025, and IdentityServer needs a commercial Duende licence outside development and testing.
* Neutral, because **D6 Reuse and effort**: no server code, but a users file to maintain.

### Dex with static users

* Good, because **D1 Fidelity to the Google round trip**: PKCE, userinfo and a configured issuer.
* Bad, because **D2 Per-test control of claims**: static users only, and its static password connector offers no unverified-email case.
* Good, because **D3 Kept out of staging and production**: same as any image used only locally.
* Good, because **D4 Weight and start-up**: a single Go binary.
* Good, because **D5 Supply chain and maintenance**: Apache-2.0, a CNCF project, actively released.
* Neutral, because **D6 Reuse and effort**: a configuration file per user set.

### Keycloak in development mode

* Good, because **D1 Fidelity to the Google round trip**: a complete OpenID Connect provider.
* Neutral, because **D2 Per-test control of claims**: users and attributes come from a realm import or the admin API.
* Good, because **D3 Kept out of staging and production**: same as any image used only locally.
* Bad, because **D4 Weight and start-up**: by far the heaviest option; its own sizing guide starts at 1250 MB per pod for production.
* Good, because **D5 Supply chain and maintenance**: Apache-2.0 and actively released.
* Bad, because **D6 Reuse and effort**: realm configuration to write and keep current.

### A stub written in the repository in Rust, grown from the test fake

* Neutral, because **D1 Fidelity to the Google round trip**: does exactly what the API uses and no more, so it cannot reveal a mismatch with a real provider.
* Good, because **D2 Per-test control of claims**: anything the tests need.
* Neutral, because **D3 Kept out of staging and production**: a binary in the Cargo workspace, which must stay out of the container image by review.
* Good, because **D4 Weight and start-up**: a small axum binary.
* Neutral, because **D5 Supply chain and maintenance**: no third-party image, but the repository maintains an authorization page, a token endpoint and PKCE checks.
* Neutral, because **D6 Reuse and effort**: shares code with #104's fake, but is new code to build, lint and test.

## More Information

* **Versions and sources at the time of writing (2026-11-13):**
  * `navikt/mock-oauth2-server` 6.1.5 (MIT, 2026-11-09).
  * Soluto `oidc-server-mock` v0.12.1 (Apache-2.0, 2025-05-04).
  * Dex v2.46.1 (Apache-2.0, 2026-10-21).
  * Keycloak 26.8.2 (Apache-2.0, 2026-11-05).
  * Sources: each project's GitHub README and releases; the Keycloak memory and CPU sizing guide.
  * Not measured: memory and start-up time.
* **Related:** story [0005](../stories/0005-google-sign-in.md) (Google sign-in), [ADR-0056](0056-session-cookie-sealed-with-a-database-held-key.md) (session cookie).
* **Answered on #729 (2026-11-13, the maintainer through the epic coordinator):** no new environment. The end-to-end stack runs the API as `Development`, the overrides are honoured only there and only for loopback URLs, and the API refuses to start otherwise.
* **Delivery:** #730 (the stub in the stack and the API's guarded settings), #736 (`sign-in-flow`) and #104 (API-level gaps).
