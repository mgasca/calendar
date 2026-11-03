---
status: planned
date: 2026-11-02
issue: https://github.com/mgasca/calendar/issues/34
pr:
  - https://github.com/mgasca/calendar/pull/191
adrs: ["0014", "0015", "0019", "0020", "0021", "0027", "0037"]
---

# 0017 Per-user calendar ownership: my events and tasks are mine alone

## Story

> As an allow-listed user, I need my events and tasks to be mine alone so that other signed-in users never see or change them.

Tracked in issue #34.

## Background

Story [0005](0005-google-sign-in.md) added Google sign-in with a verified-email allow-list ([ADR-0027](../decisions/0027-google-oidc-bff-session.md)). Everyone on the allow-list can sign in, but the data is still shared: `events` and `tasks` have no owner column, every query reads the whole table, and the README's limitations paragraph says so. [ADR-0019](../decisions/0019-single-user-mode-with-authentication-deferred.md) wrote down the retrofit plan for exactly this moment: add a non-null `owner_id`, backfill it with the single owner, index it with the existing query indexes, and scope every query and write by the authenticated principal. ADR-0027 repeats that this must happen before a second user is supported.

Today the API knows a signed-in user only by the claims the Google handler puts in the session cookie: the Google subject (`sub`, mapped to the standard name-identifier claim), name, email, profile link and picture. `email_verified` is not a claim; the handler's `OnCreatingTicket` event reads it from the userinfo response when it checks the allow-list. Nothing in the database records who a user is, so there is nowhere to hang ownership. This story adds that record, assigns every existing and future row to a user, and makes every endpoint behave as if other users' rows did not exist.

The migration runs as `calendar_migrator` from `just db-migrate` or the Azure migration bundle, which know nothing about the allow-list. So the migration cannot name the owner of the rows that exist today. It assigns them to a placeholder user instead, and the first sign-in by the first allow-listed email claims that placeholder. This is the "resolved to its user id on first sign-in" of the issue.

### Agreed scope

* **A `users` table, keyed by Google's stable subject.** One row per person who has signed in: the Google `sub` claim (unique; empty only on the legacy placeholder and on rows the seed scheme created, until a real sign-in fills it in), the lower-cased email (unique), display name, picture URL, created and last-signed-in instants. Email can change on Google's side; `sub` cannot, so `sub` is the identity key and email is refreshed at every sign-in. The row is found or created in the Google handler's `OnCreatingTicket` event, after the allow-list check, and its id travels in the session cookie as a claim.
* **A non-null `owner_id` on `events` and `tasks`,** a foreign key to `users`, set when a row is created from the signed-in user's id. The API never accepts a user identifier from the client, in a body, a query string or a header.
* **Backfill through a legacy-owner row.** The migration inserts one placeholder user with a fixed, documented id and assigns every existing event and task to it. The first sign-in by the first email in `Auth__AllowedEmails` claims the placeholder (fills in its subject, email and profile) instead of creating a new row, so pre-migration data appears for that account. Any later account gets a fresh row and an empty calendar.
* **Scoping by default, not by discipline.** The database context knows the current user and applies a global query filter (`owner_id = current user`) to events and tasks, so every read, count, set-based update and delete is scoped without a `Where` at each call site. A request with no user matches no rows. Inserts carry the current user's id, and the context refuses to save a row owned by anyone else.
* **Other users' rows do not exist.** Reading another user's event by id, or reading, completing, reopening or deleting another user's task by id, answers 404, the same as an unknown id. A bulk action that names another user's task ids reports them as `notFound`; a filter-based bulk action only ever touches the caller's rows.
* **Sessions carry the user id.** A cookie issued before this change has no user-id claim and is rejected with 401, so each user signs in once more after the deployment. The API does not look users up on every request.
* **Development seeding keeps working.** `just db-seed` authenticates with the Development-only seed key and has no Google identity, so the seed scheme acts as the user of the first allow-listed email (finding, claiming or creating that row as a sign-in would). Seeded rows then show up when that account signs in. Seeding without a configured allow-list fails with a message that says what to set.
* **Indexes follow the queries.** The agenda and task-list queries stay index-backed once they are scoped by owner (acceptance criterion 4); the backend PR shows the measured plans before and after.
* **Documentation and contract.** The README limitations paragraph and the pull request template checklist stop saying that accounts share data. `contracts/openapi.json` and the TypeScript client are regenerated if the contract changes (none is expected: the response shapes do not change).

### Not in this story

* **Sharing calendars, roles, permissions or an admin UI** for users or the allow-list (as the issue says).
* **Removing a user or their data.** A person taken off the allow-list can no longer sign in, but their `users` row and their events and tasks stay in the database. Deleting them is an operator task for a later story.
* **PostgreSQL row-level security** as a second line of defence beside the query filter. It is a possible follow-up and would need its own ADR.
* **Bearer authentication for non-browser clients** (ADR-0027 follow-up, issue #84).
* **Any web UI change.** The header already shows the signed-in name and avatar; ownership is invisible to the client. `GET /api/auth/me` keeps its shape.
* **Merging two accounts** or moving rows between users.

### Acceptance criteria

1. **Given** two allow-listed users, **when** each adds events and tasks, **then** each sees only their own in the day agenda, the week agenda and every task list view (upcoming, overdue, completed, no deadline), including the overdue counts.
2. **Given** user A's event or task id, **when** user B requests it, or completes, reopens or deletes it (tasks), or names it in a bulk action (tasks), **then** the API responds as if it does not exist (404, or a `notFound` outcome in the bulk result) and A's row is unchanged.
3. **Given** data created before the migration, **when** the first allow-listed user signs in for the first time, **then** it appears for that user and for nobody else.
4. **Given** the migration has run, **when** I inspect the schema, **then** `owner_id` is non-null on `events` and `tasks` with a foreign key to `users`, and the agenda and task-list queries still use their indexes.
5. **Given** a session cookie issued before this change (no user-id claim), **when** it is presented to any API endpoint, **then** the API answers 401. (The web app's existing 401 handling sends the user to sign in again; no web change is made.)
6. **Given** a Development API with an allow-list, **when** I run `just db-seed`, **then** every seeded row is owned by the user row of the first allow-listed email (the legacy-owner row when it was still unclaimed, otherwise a row created by the seed).
7. **Given** the change is complete, **when** I run `just check`, **then** it passes, with tests proving cross-user isolation on every endpoint (events, tasks, bulk, agenda day and week) and the contract unchanged or regenerated.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0014](../decisions/0014-postgresql-database-engine.md) | PostgreSQL as the engine, with least-privilege roles (superseded by [0037](../decisions/0037-postgresql-only-no-sqlite-fallback.md), which keeps the engine choice) | The `users` table, the foreign keys and the index changes are plain PostgreSQL; `calendar_app` reaches the new table through the migrator's default privileges |
| [0015](../decisions/0015-ef-core-data-access.md) | EF Core code-first with migrations applied only by the migrator | The migration adds the table and the column and backfills in SQL; the global query filter is an EF Core feature |
| [0019](../decisions/0019-single-user-mode-with-authentication-deferred.md) | Auth deferred, with a retrofit plan (superseded) | This story is that retrofit plan: non-null `owner_id`, backfill, indexes, scoped queries and cross-user tests |
| [0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md) | Agenda reads are one read-only snapshot | The scoped queries run inside the same snapshot; the shape of the agenda does not change |
| [0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md) | The client supplies `today` and `timeZone` | Unchanged; ownership is orthogonal to the day rules |
| [0027](../decisions/0027-google-oidc-bff-session.md) | Google OIDC with a BFF cookie and an allow-list | The user id is resolved in the sign-in callback and carried in that cookie; the allow-list still decides who gets in |
| [0037](../decisions/0037-postgresql-only-no-sqlite-fallback.md) | PostgreSQL only, no SQLite fallback | PostgreSQL-specific features (partial indexes, GiST ranges) can be used freely when the indexes gain an owner column |

A new ADR records the ownership model (identity key, scoping mechanism and legacy-owner claim). It is drafted with the `adr-draft` skill in its own PR, right after this card, and is added to the `adrs` list above when it exists.

### Other decisions (not ADR-worthy)

* **404, not 403, for another user's id:** answering "forbidden" would confirm that the id exists. The issue asks for "as if it does not exist".
* **A fixed, documented legacy-owner id:** the migration and the claim logic share one constant, so the claim can be tested without reading the database first.
* **One lookup order for sign-in and seeding:** a user is found by Google `sub`; failing that, by lower-cased email among rows that have no subject yet (a row the seed scheme created or claimed); failing that, if the email is the first in `Auth__AllowedEmails`, the unclaimed legacy-owner placeholder (no subject, no email). A matched row without a subject gets the subject filled in by a real sign-in; the seed scheme never sets a subject. If the allow-list is reordered before the first sign-in, the new first email claims the placeholder: nothing in the code can tell which account "should" own the old rows.
* **Email is matched case-insensitively and stored lower-cased,** like the allow-list comparison in `ApiAuthentication.IsAllowed` (ordinal, ignoring case).
* **No owner column in the event range indexes:** a composite GiST with a uuid needs the `btree_gist` extension, which Azure Flexible Server only allows through its extension allow-list, and with a handful of users the span overlap is the selective predicate. `owner_id` leads the task B-tree indexes instead (due date, due instant, completed at and the open-task partial indexes), and the backend PR records `EXPLAIN (ANALYZE, BUFFERS)` plans before and after on about 100k rows, following the backend practice in `AGENTS.md`.
* **Profile columns are refreshed at each sign-in** (name, picture, email), so the row never goes stale.
* **A rejected old cookie is also signed out,** so the browser does not keep presenting it.
* **The foreign key restricts deletes,** so a `users` row cannot be removed while it owns rows. Removing users is out of scope.
* **Ownership is explicit in the domain:** `CalendarEvent.Create` and `TodoTask.Create` take the owner id, so a caller cannot forget it, and the database context double-checks it on save.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| User entity and the legacy-owner id | `backend/src/Calendar.Domain/Users/` |
| `OwnerId` on events and tasks | `backend/src/Calendar.Domain/Events/CalendarEvent.cs`, `backend/src/Calendar.Domain/Tasks/TodoTask.cs` |
| Current-user abstraction and global query filters | `backend/src/Calendar.Infrastructure/CalendarDbContext.cs` |
| Table mappings and indexes | `backend/src/Calendar.Infrastructure/Configurations/` |
| Migration with the backfill | `backend/src/Calendar.Infrastructure/Migrations/` |
| User lookup, claim and creation at sign-in and seeding | `backend/src/Calendar.Api/` (auth setup in `Program.cs`, the dev seed scheme, a user directory service) |
| Owner on create | `backend/src/Calendar.Api/Endpoints/EventEndpoints.cs`, `backend/src/Calendar.Api/Endpoints/TaskEndpoints.cs` |
| Isolation, migration and schema tests | `backend/tests/Calendar.Api.Tests/` |
| Limitations text | `README.md`, `.github/pull_request_template.md` |

### API

No contract changes expected. Behaviour changes: every event, task, bulk and agenda endpoint is scoped to the signed-in user; another user's id answers 404 (or `notFound` in a bulk result); a session without a user id answers 401.

### Testing

* **API tests (Testcontainers PostgreSQL)** with a fake authentication scheme that can act as two different users: each endpoint is exercised across users, including the bulk endpoint's id and filter targets and the agenda overdue counts.
* **Migration test:** apply the migrations up to the one before ownership, insert events and tasks, migrate forward, and assert the legacy owner owns them; then the claim at first sign-in makes them visible to that account.
* **Schema tests:** the foreign keys, the non-null columns and the index definitions.
* **Sign-in tests:** a cookie principal without the user-id claim is rejected; the seed scheme resolves the first allow-listed email.
* **Domain tests:** the owner id is required on create.
* **Measurement, not committed:** about 100k rows across two users, `ANALYZE`, `EXPLAIN (ANALYZE, BUFFERS)` on the generated SQL before and after the index change; plans go in the backend PR.

### Lessons learned, known issues and follow-ups

*Filled in on delivery.*

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Your calendar is yours

After you sign in with an allowed Google account, you see only the events and tasks you created. Another allowed account sees its own calendar and nothing of yours, in the day and week views, in **My tasks** and on the **Overdue tasks** page.

### After the update

Everyone signs in once more after this change is deployed. The events and tasks that existed before the change belong to the calendar owner, the first email on the allowed list: they appear for that account the first time it signs in. Any other account starts with an empty calendar.

### Other accounts' items

Nothing you do can read or change another account's events or tasks. The calendar behaves as if they did not exist: they never appear in your views, counts or lists.
