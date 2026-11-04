---
status: implemented
date: 2026-11-02
issue: https://github.com/mgasca/calendar/issues/34
pr:
  - https://github.com/mgasca/calendar/pull/191
  - https://github.com/mgasca/calendar/pull/192
  - https://github.com/mgasca/calendar/pull/211
  - https://github.com/mgasca/calendar/pull/212
adrs: ["0014", "0015", "0019", "0020", "0021", "0027", "0037", "0041"]
---

# 0017 Per-user calendar ownership: my events and tasks are mine alone

## Story

> As an allow-listed user, I need my events and tasks to be mine alone so that other signed-in users never see or change them.

Tracked in issue #34 and delivered across [story-card PR #191](https://github.com/mgasca/calendar/pull/191), [ADR-0041 PR #192](https://github.com/mgasca/calendar/pull/192), [backend PR #211](https://github.com/mgasca/calendar/pull/211) and this card update ([#212](https://github.com/mgasca/calendar/pull/212)).

## Background

Story [0005](0005-google-sign-in.md) added Google sign-in with a verified-email allow-list ([ADR-0027](../decisions/0027-google-oidc-bff-session.md)). Everyone on the allow-list can sign in, but the data is still shared: `events` and `tasks` have no owner column, every query reads the whole table, and the README's limitations paragraph says so. [ADR-0019](../decisions/0019-single-user-mode-with-authentication-deferred.md) wrote down the retrofit plan for exactly this moment: add a non-null `owner_id`, backfill it with the single owner, index it with the existing query indexes, and scope every query and write by the authenticated principal. ADR-0027 repeats that this must happen before a second user is supported.

Today the API knows a signed-in user only by the claims the Google handler puts in the session cookie: the Google subject (`sub`, mapped to the standard name-identifier claim), name, email, profile link and picture. `email_verified` is not a claim; the handler's `OnCreatingTicket` event reads it from the userinfo response when it checks the allow-list. Nothing in the database records who a user is, so there is nowhere to hang ownership. This story adds that record, assigns every existing and future row to a user, and makes every endpoint behave as if other users' rows did not exist.

The migration runs as `calendar_migrator` from `just db migrate` or the Azure migration bundle, which know nothing about the allow-list. So the migration cannot name the owner of the rows that exist today. It assigns them to a placeholder user instead, and the first sign-in by the first allow-listed email claims that placeholder. This is the "resolved to its user id on first sign-in" of the issue.

### Agreed scope

* **A `users` table, keyed by Google's stable subject.** One row per person who has signed in: the Google `sub` claim (unique; empty only on the legacy placeholder and on rows the seed scheme created, until a real sign-in fills it in), the lower-cased email (unique), display name, picture URL, created and last-signed-in instants. Email can change on Google's side; `sub` cannot, so `sub` is the identity key and email is refreshed at every sign-in. The row is found or created in the Google handler's `OnCreatingTicket` event, after the allow-list check, and its id travels in the session cookie as a claim.
* **A non-null `owner_id` on `events` and `tasks`,** a foreign key to `users`, set when a row is created from the signed-in user's id. The API never accepts a user identifier from the client, in a body, a query string or a header.
* **Backfill through a legacy-owner row.** The migration inserts one placeholder user with a fixed, documented id and assigns every existing event and task to it. The first sign-in by the first email in `Auth__AllowedEmails` claims the placeholder (fills in its subject, email and profile) instead of creating a new row, so pre-migration data appears for that account. Any later account gets a fresh row and an empty calendar.
* **Scoping by default, not by discipline.** The database context knows the current user and applies a global query filter (`owner_id = current user`) to events and tasks, so every read, count, set-based update and delete is scoped without a `Where` at each call site. A request with no user matches no rows. Inserts carry the current user's id, and the context refuses to save a row owned by anyone else.
* **Other users' rows do not exist.** Reading another user's event by id, or reading, completing, reopening or deleting another user's task by id, answers 404, the same as an unknown id. A bulk action that names another user's task ids reports them as `notFound`; a filter-based bulk action only ever touches the caller's rows.
* **Sessions carry the user id.** A cookie issued before this change has no user-id claim and is rejected with 401, so each user signs in once more after the deployment. The API does not look users up on every request.
* **Development seeding keeps working.** `just db seed` authenticates with the Development-only seed key and has no Google identity, so the seed scheme acts as the user of the first allow-listed email (finding, claiming or creating that row as a sign-in would). Seeded rows then show up when that account signs in. Seeding without a configured allow-list fails with a message that says what to set.
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

1. **Given** two allow-listed users, **when** each adds events and tasks, **then** each sees only their own in the day agenda, the week agenda and every task list view (upcoming, overdue, completed, no deadline), including the overdue counts. [Agendas across users](../../backend/tests/Calendar.Api.Tests/Endpoints/OwnershipTests.cs) (`DayAndWeekAgendas_ShowOnlyTheCallersRows`), [task list views](../../backend/tests/Calendar.Api.Tests/Endpoints/OwnershipTests.cs) (`TaskListViews_ShowOnlyTheCallersRows`), [rows created through the API carry their creator](../../backend/tests/Calendar.Api.Tests/Endpoints/OwnershipTests.cs) (`CreatedRows_BelongToTheCaller`), and the context-level rule behind them, [a context with a user sees only its rows](../../backend/tests/Calendar.Api.Tests/CalendarDbContextOwnershipTests.cs).
2. **Given** user A's event or task id, **when** user B requests it, or completes, reopens or deletes it (tasks), or names it in a bulk action (tasks), **then** the API responds as if it does not exist (404, or a `notFound` outcome in the bulk result) and A's row is unchanged. [Event by id](../../backend/tests/Calendar.Api.Tests/Endpoints/OwnershipTests.cs) (`AnotherUsersEvent_IsNotFound_AndTheOwnersIsFound`), [task read, complete, reopen, delete](../../backend/tests/Calendar.Api.Tests/Endpoints/OwnershipTests.cs) (`AnotherUsersTask_IsNotFoundForReadCompleteReopenAndDelete_AndStaysUnchanged`), [bulk by ids](../../backend/tests/Calendar.Api.Tests/Endpoints/OwnershipTests.cs) (`BulkByIds_ReportsAnotherUsersTasksAsNotFound_AndLeavesThemUnchanged`) and [bulk by filter](../../backend/tests/Calendar.Api.Tests/Endpoints/OwnershipTests.cs) (`BulkByFilter_OnlyTouchesTheCallersOverdueTasks`). The bulk tests use the complete and delete actions; the other bulk actions share the same filtered query.
3. **Given** data created before the migration, **when** the first allow-listed user signs in for the first time, **then** it appears for that user and for nobody else. [Backfill to the unclaimed placeholder](../../backend/tests/Calendar.Api.Tests/OwnershipMigrationTests.cs), [the first allow-listed email claims it in the Google callback](../../backend/tests/Calendar.Api.Tests/Endpoints/SignInTests.cs) (`AttachUser_LetsTheFirstAllowListedEmail_ClaimTheLegacyOwner`), [the lookup order, once only, never for other emails](../../backend/tests/Calendar.Api.Tests/UserDirectoryTests.cs). The Google round trip itself is not automated (as in story 0005).
4. **Given** the migration has run, **when** I inspect the schema, **then** `owner_id` is non-null on `events` and `tasks` with a foreign key to `users`, and the agenda and task-list queries still use their indexes. [Owner columns, keys and indexes](../../backend/tests/Calendar.Api.Tests/SchemaTests.cs) (`OwnerId_IsANonNullForeignKeyToUsers`, `OpenTaskDueIndex_ExcludesCompletedAndUndatedTasks`, `UsersIndex_IsUniqueAmongRowsThatHaveTheValue`). Index use is measured, not tested: the plans are in [PR #211](https://github.com/mgasca/calendar/pull/211) and summarised below.
5. **Given** a session cookie issued before this change (no user-id claim), **when** it is presented to any API endpoint, **then** the API answers 401. (The web app's existing 401 handling sends the user to sign in again; no web change is made.) [A real cookie ticket without the claim is rejected and signed out](../../backend/tests/Calendar.Api.Tests/Endpoints/SessionAndSeedTests.cs) (`CookieSession_IsAcceptedOnlyWithAUserId`), exercised on `/api/auth/me`; every data endpoint sits behind the same cookie validation.
6. **Given** a Development API with an allow-list, **when** I run `just db seed`, **then** every seeded row is owned by the user row of the first allow-listed email (the legacy-owner row when it was still unclaimed, otherwise a row created by the seed). [Seeded rows and the legacy claim](../../backend/tests/Calendar.Api.Tests/Endpoints/SessionAndSeedTests.cs) (`SeededRows_BelongToTheFirstAllowListedEmail_WhoAlsoClaimsTheLegacyOwner`), [seeding after the owner's real sign-in](../../backend/tests/Calendar.Api.Tests/Endpoints/SessionAndSeedTests.cs) (`SeedScheme_StillWorks_AfterTheOwnerHasSignedInForReal`), [no allow-list, no seeding, with the reason](../../backend/tests/Calendar.Api.Tests/Endpoints/SessionAndSeedTests.cs) (`SeedScheme_RequiresAnAllowList_AndSaysSo`). `just db seed` itself is exercised through the API, not run in a test.
7. **Given** the change is complete, **when** I run `just check`, **then** it passes, with tests proving cross-user isolation on every endpoint (events, tasks, bulk, agenda day and week) and the contract unchanged or regenerated. CI runs `just check` on [PR #211](https://github.com/mgasca/calendar/pull/211); the contract regenerated identically.

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
| [0041](../decisions/0041-per-user-data-ownership.md) | Scope every query and write with an EF Core global query filter keyed by the signed-in user | The decision this story implements: the identity key, the lookup order, the legacy-owner claim, the session claim, 404 for other users' ids, and row-level security as a later layer with its trigger |

[ADR-0041](../decisions/0041-per-user-data-ownership.md) was drafted with the `adr-draft` skill in [#192](https://github.com/mgasca/calendar/pull/192) and accepted by the product owner.

### Other decisions (not ADR-worthy)

* **404, not 403, for another user's id:** answering "forbidden" would confirm that the id exists. The issue asks for "as if it does not exist".
* **A fixed, documented legacy-owner id:** the migration and the claim logic share one constant, so the claim can be tested without reading the database first.
* **One lookup order for sign-in and seeding:** a user is found by Google `sub`; failing that, by lower-cased email, where a real sign-in only matches a row that has no subject yet (so another Google account never takes over a claimed row) while the seed scheme, which asserts no Google identity, matches its email whatever the row's subject; failing that, if the email is the first in `Auth__AllowedEmails`, the unclaimed legacy-owner placeholder (no subject, no email). A matched row without a subject gets the subject filled in by a real sign-in; the seed scheme never sets a subject. (The review of the backend PR found that the first wording, "among rows without a subject" for the seed too, broke seeding after the owner's real sign-in.) If the allow-list is reordered before the first sign-in, the new first email claims the placeholder: nothing in the code can tell which account "should" own the old rows.
* **Email is matched case-insensitively and stored lower-cased,** like the allow-list comparison in `ApiAuthentication.IsAllowed` (ordinal, ignoring case).
* **No owner column in the event range indexes:** a composite GiST with a uuid needs the `btree_gist` extension, which Azure Flexible Server only allows through its extension allow-list, and with a handful of users the span overlap is the selective predicate. `owner_id` leads the task B-tree indexes instead (due date, due instant, completed at and the open-task partial indexes), and the backend PR records `EXPLAIN (ANALYZE, BUFFERS)` plans before and after on about 100k rows, following the backend practice in `AGENTS.md`.
* **Profile columns are refreshed at each sign-in** (name, picture, email), so the row never goes stale.
* **A rejected old cookie is also signed out,** so the browser does not keep presenting it.
* **The foreign key restricts deletes,** so a `users` row cannot be removed while it owns rows. Removing users is out of scope.
* **Ownership is explicit in the domain:** `CalendarEvent.Create` and `TodoTask.Create` take the owner id, so a caller cannot forget it, and the database context double-checks it on save.
* **The backfill default stays on `owner_id`:** migrations run before the new revision starts (README, runbooks), so a row the previous revision still creates in that window lands on the legacy owner like the pre-existing rows; the application always names the owner. Dropping the default would have made those creates fail.

## Implementation notes

Delivered in [backend PR #211](https://github.com/mgasca/calendar/pull/211), after the card ([#191](https://github.com/mgasca/calendar/pull/191)) and the ADR ([#192](https://github.com/mgasca/calendar/pull/192)).

### Where things live

| Area | Location |
| --- | --- |
| User entity, the sign-in rules and the legacy-owner id | `backend/src/Calendar.Domain/Users/User.cs` (`User.LegacyOwnerId` = `11111111-1111-1111-1111-111111111111`) |
| `OwnerId` on events and tasks, required by the factories | `backend/src/Calendar.Domain/Events/CalendarEvent.cs`, `backend/src/Calendar.Domain/Tasks/TodoTask.cs` |
| Current-user abstraction | `backend/src/Calendar.Infrastructure/ICurrentUser.cs` (`ICurrentUser`, `FixedCurrentUser`) |
| Global query filters and the owner check on save | `backend/src/Calendar.Infrastructure/CalendarDbContext.cs` |
| Table mappings, keys and indexes | `backend/src/Calendar.Infrastructure/Configurations/UserConfiguration.cs`, `CalendarEventConfiguration.cs`, `TodoTaskConfiguration.cs` |
| Migration with the backfill | `backend/src/Calendar.Infrastructure/Migrations/20261102232144_PerUserOwnership.cs` |
| User lookup, claim and creation | `backend/src/Calendar.Api/Auth/UserDirectory.cs` |
| The claim and the request's current user | `backend/src/Calendar.Api/Auth/CalendarClaims.cs` (`urn:calendar:user-id`), `backend/src/Calendar.Api/Auth/HttpCurrentUser.cs` |
| Google callback and cookie validation | `backend/src/Calendar.Api/Program.cs` (`OnCreatingTicket`, `OnValidatePrincipal`), `backend/src/Calendar.Api/Endpoints/AuthEndpoints.cs` (`ApiAuthentication.AttachUserAsync`, `RequireUserIdAsync`) |
| Development seed scheme | `backend/src/Calendar.Api/DevSeedAuthenticationHandler.cs`; `tools/seed-dev/SeedPlan.cs` (the 401 message); `.claude/skills/run-calendar/SKILL.md` (starts the API with an allow-list) |
| Owner on create | `backend/src/Calendar.Api/Endpoints/EventEndpoints.cs`, `backend/src/Calendar.Api/Endpoints/TaskEndpoints.cs` |
| Tests | `backend/tests/Calendar.Api.Tests/` (`Endpoints/OwnershipTests.cs`, `Endpoints/SignInTests.cs`, `Endpoints/SessionAndSeedTests.cs`, `UserDirectoryTests.cs`, `CalendarDbContextOwnershipTests.cs`, `OwnershipMigrationTests.cs`, `SchemaTests.cs`), `backend/tests/Calendar.Domain.Tests/Users/UserTests.cs` |
| Documentation and the architecture model | `README.md`, `.github/pull_request_template.md`, `docs/architecture/calendar.architecture.json` (`per-user-data-isolation` control), `docs/architecture/controls/per-user-data-isolation.requirement.json` |

### API

No contract change: `contracts/openapi.json` and the TypeScript client regenerated identically. Behaviour: every event, task, bulk and agenda endpoint is scoped to the signed-in user; `GET /api/events/{id}`, `GET`/`complete`/`reopen`/`DELETE /api/tasks/{id}` answer 404 for another user's id; `POST /api/tasks/bulk` reports another user's ids as `notFound` and its filter target only ever covers the caller's rows; a cookie without the user-id claim answers 401 and is signed out; the Development seed scheme answers 401 with a reason when `Auth:AllowedEmails` is empty.

### Persistence

The `users` table (id, `google_subject` unique, `email` lower-cased and unique with a check constraint, display name, picture, created and last-signed-in instants), `owner_id` on `events` and `tasks` (non-null, `FOREIGN KEY users(id) ON DELETE RESTRICT`, default = the legacy owner), `owner_id` leading `ix_tasks_due_date`, `ix_tasks_due_at`, `ix_tasks_completed_at`, `ix_tasks_open_due_date` and `ix_tasks_open_due_at`, plus `ix_events_owner_id`; the GiST indexes `ix_events_span` and `ix_events_date_span` are unchanged.

### Testing

* **API tests (Testcontainers PostgreSQL):** the fake scheme acts as user A by default and as any user through the `X-Test-User` header (`ApiTestBase.ClientAs`); the base seeds two users. `OwnershipTests` covers every endpoint across users; `CalendarDbContextOwnershipTests` the context rules (a user sees only its rows, no user sees nothing, the save guard on every `SaveChanges` overload); `SignInTests` the Google callback glue through the same `OAuthCreatingTicketContext` the handler builds; `UserDirectoryTests` the lookup order, the legacy claim, seeding before and after the real sign-in, an email that moved to another Google account (the sign-in fails rather than taking the row over), and two concurrent first sign-ins (an interceptor interposes a competing insert; the retry converges on it); `SessionAndSeedTests` the old-cookie rejection and the seed scheme; `OwnershipMigrationTests` the backfill; `SchemaTests` the columns, keys and indexes.
* **Domain tests:** `UserTests` (normalisation, subject fill-in, profile kept when not given) and the empty-owner rejection in the event and task tests.
* **Measured, not committed:** a throwaway harness seeded 100k tasks and 60k events over seven years for two users, ran `ANALYZE` and `EXPLAIN (ANALYZE, BUFFERS)` on the SQL EF generates, as `calendar_app`, in three variants: before (unscoped, single-column indexes), the owner predicate on the old indexes, and after (scoped, owner-led indexes). The plans are in [PR #211](https://github.com/mgasca/calendar/pull/211).

### Measurements

| Query | Before (unscoped, single-column task indexes) | After (scoped, owner-led task indexes) |
| --- | --- | --- |
| Day agenda overdue list (two `UNION ALL` branches, top 20) | 13.1 ms; 9 582 index entries per branch; 19 164 heap rows | 5.0 ms; 3 194 entries per branch; 6 388 heap rows |
| Day agenda overdue count | 4.9 ms | 2.3 ms |
| Week agenda tasks due within the week | 0.15 ms | 0.20 ms |
| Week agenda timed events (GiST `ix_events_span`) | 0.19 ms; 115 entries, 115 heap rows | 0.13 ms; 115 entries, 69 rows after the owner filter |
| Week agenda all-day events (GiST `ix_events_date_span`) | 0.13 ms | 0.11 ms |
| Task list upcoming, first page | 0.68 ms; 418 entries per branch | 0.39 ms; 139 per branch |
| Task list overdue total | 3.0 ms | 1.7 ms |
| Task list completed, first page (`Index Scan Backward ix_tasks_completed_at`) | 0.14 ms | 0.12 ms |

Every query keeps its index. With the owner predicate on the old single-column indexes, the overdue list still read 9 582 entries per branch and filtered on the heap (6.3 ms): that is why `owner_id` leads the task indexes. The GiST range indexes stay single-column and filter the owner on the rows the overlap selects.

### Lessons learned, known issues and follow-ups

* **Write the lookup order down before coding it.** The card's first wording ("by email among rows without a subject", for the seed scheme too) was consistent on paper and broke `just db seed` the moment the owner signed in for real; the review of the backend PR caught it with a throwaway test. The seed scheme now matches its email whatever the subject.
* **Keep the backfill default.** The migration first dropped it so new rows had to name an owner; the rollout order (migrate, then start the new revision) means the previous revision keeps inserting for a while, so the default stays and the model knows it.
* **A no-user context reads nothing and inserts anything.** That is how the tests arrange rows for two users through the migrator context; reads across users in tests need an explicit `IgnoreQueryFilters()`, which application code never uses.
* **Known limit:** an email that moves to a different Google account (same email, new subject, old row claimed) cannot sign in: the lookup refuses to take the row over and the request fails. Merging or moving accounts is out of scope.
* **Known limit:** the legacy placeholder is claimed by whichever email is first in `Auth__AllowedEmails` at the time of the first sign-in or seed run. A person removed from the allow-list keeps their rows, invisible.
* **Deferred:** PostgreSQL row-level security as a second layer, with its trigger in [ADR-0041](../decisions/0041-per-user-data-ownership.md) and the PR template; removing users and their data; sharing between users.

## User guide

### Your calendar is yours

After you sign in with an allowed Google account, you see only the events and tasks you created. Another allowed account sees its own calendar and nothing of yours, in the day and week views, in **My tasks** and on the **Overdue tasks** page.

### After the update

Everyone signs in once more after this change is deployed. The events and tasks that existed before the change belong to the calendar owner, the first email on the allowed list: they appear for that account the first time it signs in. Any other account starts with an empty calendar.

### Other accounts' items

Nothing you do can read or change another account's events or tasks. The calendar behaves as if they did not exist: they never appear in your views, counts or lists.
