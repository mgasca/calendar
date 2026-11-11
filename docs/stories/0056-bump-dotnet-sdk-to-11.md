---
status: planned
date: 2026-11-11
issue: https://github.com/mgasca/calendar/issues/657
pr:
  - https://github.com/mgasca/calendar/pull/658
adrs: ["0017", "0050", "0051"]
---

# 0056 Move the repository to the .NET 11 SDK and target framework

## Story

> As a calendar owner, I need the backend and repo tooling to build and run on .NET 11, so that the SDK, runtime and packages (including the `dotnet-ef` 11 already adopted) stay on one supported major version.

Tracked in issue #657. Wording derived from the issue; to be confirmed by the product owner.

**Scope change, 2026-11-11:** the backend is now Rust ([0051](../decisions/0051-rust-backend-on-axum-and-tokio.md)), so the backend parts of this card no longer exist: the backend target framework and `backend/global.json`, the ASP.NET Core and EF Core packages, `dotnet-ef`, the .NET container images and the contract regeneration. What remains is the repo tools' SDK pin and target framework ([0050](../decisions/0050-adopt-dotnet-11-once-the-providers-support-it.md), as amended). The sections below still describe the original scope and must be rewritten for the narrowed one before delivery.

## Background

The backend, the repo tools and the container images target .NET 10. [0002](../decisions/0002-dotnet-10-minimal-api-backend.md) chose ".NET 10 LTS". Dependabot has since moved `dotnet-ef` to 11.0.0 (#652), so the migration tool is a major version ahead of the SDK, runtime and EF Core packages it works against.

.NET 11 is a standard-term release, not LTS, but its support ends on the same date as .NET 10 (2028-11-14). The maintainer chose to adopt it in [0050](../decisions/0050-adopt-dotnet-11-once-the-providers-support-it.md), once the EF Core providers support it.

### Agreed scope

* **SDK pin:** `global.json` pins the exact .NET 11 SDK (the repo tools' lock files depend on the exact version); the floor in `backend/global.json` rises to 11.
* **Target framework:** `net11.0` in the backend, `tools/` and `.claude/skills/*` `Directory.Build.props`.
* **Container images:** the `Dockerfile` build and runtime stages use the 11.0 images, digest-pinned as today.
* **Packages:** Microsoft ASP.NET Core and EF Core packages in `backend/Directory.Packages.props` move to 11.x, with the Npgsql provider and `EFCore.NamingConventions` versions that support EF Core 11; every `packages.lock.json` is regenerated.
* **Generated artifacts:** `contracts/openapi.json` and the TS client are regenerated and any diff is committed.
* **Docs:** statements of the version in `AGENTS.md`, the architecture model and runbooks are updated.

### Not in this story

* **Language or API adoption:** using new C# or .NET 11 features; behaviour changes are follow-up stories.
* **New migrations:** none unless EF Core 11 changes the model snapshot; if it does, that is recorded here and delivered in the same PR.
* **Frontend toolchain:** Node, pnpm and TypeScript pins ([0010](../decisions/0010-toolchain-version-pins.md)) do not change.

### Dependencies

* [0050](../decisions/0050-adopt-dotnet-11-once-the-providers-support-it.md) is accepted. Delivery is gated on a stable `Npgsql.EntityFrameworkCore.PostgreSQL` 11.x (11.0.0-rc.3 is a pre-release today) and on `EFCore.NamingConventions` working on EF Core 11, or being replaced.
* Npgsql and `EFCore.NamingConventions` must publish releases that support EF Core 11; if they do not, the story waits or pins an earlier provider and says so.

### Acceptance criteria

1. **Given** the change is complete, **when** I run `just doctor`, **then** it reports the .NET 11 SDK from `global.json` as installed and matching.
2. **Given** every project in `Calendar.slnx`, `tools/` and `.claude/skills/`, **when** I read its target framework, **then** it is `net11.0`.
3. **Given** a clean checkout, **when** I restore with `--locked-mode`, **then** it succeeds with the committed lock files.
4. **Given** the `Dockerfile`, **when** I run `just image` build, **then** the image builds from the .NET 11 SDK and ASP.NET images and the app starts and answers its health endpoint.
5. **Given** the migrations, **when** I run `just db migrate` against a fresh database, **then** it applies with no pending model changes reported.
6. **Given** the API, **when** I run `just contracts`, **then** the committed `openapi.json` and TS client have no diff.
7. **Given** the change is complete, **when** I run `just check`, **then** it passes, including the regenerated contract.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0051](../decisions/0051-rust-backend-on-axum-and-tokio.md) | Rust backend on axum and tokio | The backend left .NET, so this story no longer touches it; it replaces the earlier rows for 0002 and 0006, which are superseded. |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | Repo tooling as .NET file-based apps | Tools and skills retarget and their lock files depend on the exact SDK. |

The version decision is [0050](../decisions/0050-adopt-dotnet-11-once-the-providers-support-it.md); no further ADR is expected.

### Other decisions (not ADR-worthy)

* **Start only at the gate:** the story stays `planned` until the provider ships; nothing in the repo changes before.
* **One PR for the move:** target framework, images, packages and lock files change together, because a partial move does not restore or build.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| SDK pins | `global.json`, `backend/global.json` |
| Target framework | `backend/Directory.Build.props`, `tools/Directory.Build.props`, `.claude/skills/*/Directory.Build.props` |
| Packages | `backend/Directory.Packages.props`, `packages.lock.json` files |
| Images | `Dockerfile` |
| Contract | `contracts/openapi.json`, `frontend/packages/api-client` |

### API

No changes expected; the regenerated contract should have no diff.

### Testing

* Existing suites are the check: backend unit and API tests (Docker needed), `just tools test`, `just check`.
* Run the container image and the migration against a throwaway database (`run-calendar` skill).

### Lessons learned, known issues and follow-ups

* To be completed on delivery.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

No user-visible change: the calendar looks and behaves as before.
