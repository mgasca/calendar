---
status: proposed
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# Single-user mode with authentication deferred: no auth and no owner column yet

## Context and Problem Statement

The first feature, the Today view, shows one person's events and tasks. There are no users, accounts or sharing yet, and the app currently runs only on a developer machine, with the database bound to `127.0.0.1` ([ADR-0016](0016-local-database-provisioning.md)). Future clients (mobile, desktop, CLI) and a single-container deployment ([ADR-0002](0002-dotnet-10-minimal-api-backend.md), [ADR-0004](0004-openapi-contract-and-generated-client.md)) will eventually need real identity. Should authentication and per-user data ownership be built now, or deferred, and what must hold in the meantime?

## Decision Drivers

* **D1 Delivery focus**: the first vertical slice should prove the stack end to end, without an identity subsystem.
* **D2 Exposure safety**: unauthenticated data and write endpoints must not be reachable by untrusted parties.
* **D3 Retrofit cost**: how hard it is to add authentication and ownership later (schema, API, tests).
* **D4 Multi-client readiness**: the eventual auth design has to suit browser, mobile, CLI and third-party clients, so it should be chosen deliberately, not as a side effect of the first feature.
* **D5 Clarity of the interim contract**: the limits of the interim state are written down and findable, so nobody ships it by accident.
* **D6 AI-agent proficiency & ecosystem**: mainstream, well-documented auth stacks.

## Considered Options

* Defer entirely: no authentication, no owner column
* Add an `owner_id` column filled with a constant, no authentication
* Implement authentication now with ASP.NET Core Identity
* Implement authentication now with an external OpenID Connect provider

## Decision Outcome

Chosen option: "Defer entirely", because it keeps the first slice focused (D1) and avoids choosing an auth design before the client set and hosting are known (D4). The price is that the service is **unsafe to expose**, so the constraints below are part of this decision (D2, D5).

| Driver | **Defer entirely (chosen)** | `owner_id` constant | ASP.NET Core Identity now | External OIDC now |
| --- | :---: | :---: | :---: | :---: |
| D1 Delivery focus | ★★★ | ★★☆ | ★☆☆ | ★☆☆ |
| D2 Exposure safety | ★☆☆ | ★☆☆ | ★★★ | ★★★ |
| D3 Retrofit cost | ★★☆ | ★★★ | ★★★ | ★★★ |
| D4 Multi-client readiness | ★★★ | ★★☆ | ★☆☆ | ★★☆ |
| D5 Clarity of the interim contract | ★★☆ | ★☆☆ | ★★★ | ★★★ |
| D6 AI-agent proficiency & ecosystem | ★★★ | ★★★ | ★★★ | ★★☆ |

### Constraints while auth is deferred

* **No public or shared exposure.** The API and database must run only on the developer's machine or a network the owner alone controls. No internet-facing deployment, no shared dev server and no port forwarding. The database stays bound to `127.0.0.1` ([ADR-0016](0016-local-database-provisioning.md)).
* **No permissive CORS.** The API does not enable CORS for arbitrary origins. In development the web UI uses same-origin access or the dev proxy, so a web page open in the developer's browser cannot call the local API cross-origin.
* **No personal or sensitive data** beyond what the developer is happy to keep in a local database.
* **No owner column.** Tables have no `owner_id`/`user_id`, and the API accepts no user identifier. Every request means "the one user".
* **Authorization-shaped code is not faked.** No placeholder `[Authorize]`, fake users or hard-coded tokens that suggest a security boundary exists.

### Revisit trigger

> Write an auth ADR (identity provider, token format, client flows) and implement it **before the first of**: a deployment reachable from outside the owner's machine or trusted network; a second user; or a non-browser client (mobile, desktop, CLI, integration) that has to call the API.

The trigger is recorded here, and the implementation PR for the Today view must also add it to the README's status or limitations section and to the PR template's checklist, as [ADR-0016](0016-local-database-provisioning.md) does for Aspire.

### Retrofit plan (for the future auth ADR)

* Add a non-null `owner_id` to `events` and `tasks` in a migration, backfilled with the single owner's id, and index it with the existing query indexes.
* Scope every query and write by the authenticated principal, and add tests that one user cannot read or change another's rows.
* Because only seed and test data exist, the migration is small today. It grows with real data, which is a reason not to wait long after the trigger.

### Consequences

* Good, because the first feature ships without an identity subsystem, and the auth design is decided with the real client and hosting picture ([ADR-0004](0004-openapi-contract-and-generated-client.md)).
* Good, because the schema, API and tests stay minimal and honest about the current scope.
* Bad, because anyone who can reach the API can read and change everything. The safety depends on the constraints above being respected, and nothing in the code enforces them.
* Bad, because the later migration touches every table and every query, so the retrofit is a cross-cutting change.
* Neutral, because the revisit trigger relies on documentation and review, not tooling.

### Confirmation

* Code review checks that new PRs do not add public hosting, permissive CORS or deployment config for an internet-facing environment while this ADR is in force.
* The README and PR template carry the revisit trigger (added with the Today view implementation).
* Compose keeps `127.0.0.1` binding (existing check in review, [ADR-0016](0016-local-database-provisioning.md)).

## Pros and Cons of the Options

### Defer entirely: no authentication, no owner column

* Good, because **D1 Delivery focus**: no auth code, configuration, user table or login UI in the first slice.
* Good, because **D4 Multi-client readiness**: the future auth design is not pre-empted by a shortcut taken now.
* Good, because **D6 AI-agent proficiency & ecosystem**: nothing extra for agents to maintain.
* Neutral, because **D3 Retrofit cost**: adding `owner_id` and query scoping later is mechanical but cross-cutting, and cheap while data is test data.
* Neutral, because **D5 Clarity of the interim contract**: the limits are stated in this ADR, but the code does not show them.
* Bad, because **D2 Exposure safety**: nothing stops an exposed instance from serving data to anyone.

### `owner_id` column with a constant, no authentication

* Good, because **D3 Retrofit cost**: the column and indexes exist, so the later migration only has to start enforcing real values.
* Good, because **D6 AI-agent proficiency & ecosystem**: a plain column.
* Neutral, because **D1 Delivery focus**: small extra work on every entity and query.
* Neutral, because **D4 Multi-client readiness**: the column shape (a GUID? a string subject id?) depends on the identity provider, so the guess may be wrong.
* Bad, because **D2 Exposure safety**: it looks like a security boundary but is not one.
* Bad, because **D5 Clarity of the interim contract**: a constant owner in every row suggests multi-tenancy that does not exist, and queries that "work" without scoping would be easy to copy later.

### Implement authentication now with ASP.NET Core Identity

* Good, because **D2 Exposure safety**: the API is protected from the start.
* Good, because **D3 Retrofit cost** and **D5 Clarity of the interim contract**: ownership and scoping exist from day one.
* Good, because **D6 AI-agent proficiency & ecosystem**: first-party and heavily documented.
* Bad, because **D1 Delivery focus**: adds a user store (EF Core Identity tables, version 10.0.14 at the time of writing), registration and login flows, and password handling, before any user has asked for them.
* Bad, because **D4 Multi-client readiness**: ASP.NET Core Identity's cookie and bearer-token endpoints are aimed at first-party browser or SPA use. Third-party and native clients would likely need a standards-based flow (OIDC) later, so the work may be redone.

### Implement authentication now with an external OpenID Connect provider

* Good, because **D2 Exposure safety**, **D3 Retrofit cost** and **D5 Clarity of the interim contract**: the API only accepts valid tokens, and ownership is the token's subject.
* Good, because **D4 Multi-client readiness**: standard OIDC flows (authorization code with PKCE) suit browser, mobile and CLI clients, and credentials are not stored by the app.
* Neutral, because **D6 AI-agent proficiency & ecosystem**: JWT bearer validation is mainstream, but provider setup varies and is harder for agents to verify offline.
* Bad, because **D1 Delivery focus**: needs a provider (hosted or a second backing service, which also triggers the Aspire re-evaluation in [ADR-0016](0016-local-database-provisioning.md)), plus client login flows, before hosting or users exist.

## More Information

* Related: [ADR-0002](0002-dotnet-10-minimal-api-backend.md) (single container serves API and SPA), [ADR-0004](0004-openapi-contract-and-generated-client.md) (future clients), [ADR-0014](0014-postgresql-database-engine.md) (roles and row-level security are available later), [ADR-0016](0016-local-database-provisioning.md) (localhost-only database, backing-service revisit trigger).
* Versions checked on 2026-10-26: `Microsoft.AspNetCore.Identity.EntityFrameworkCore` 10.0.14.
* Row-level security in PostgreSQL ([ADR-0014](0014-postgresql-database-engine.md)) is an option for the future auth ADR, as defence in depth beside query scoping.
