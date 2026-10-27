# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, Cursor, etc.) when working with code in this repository.

## Overview

"Calendar": a monorepo with a .NET 10 backend (`backend/`, solution `Calendar.slnx`) and a pnpm/React/Vite/TypeScript frontend (`frontend/`). Early stage: the API currently has only health endpoints and a `CalendarEvent` domain type. Significant choices are recorded as ADRs in `docs/decisions/` — read the relevant ADR before changing tooling, layout or dependencies, and don't contradict an accepted one (supersede it instead).

## Commands

`make` is a thin wrapper over native tooling (`make help` lists targets). Linux/WSL only.

- `make setup` — `doctor` + restore .NET packages + `pnpm install --frozen-lockfile`
- `make dev-api` (http://localhost:5041) / `make dev-web` (proxies `/api` to the API)
- `make test` — backend + frontend tests; `make lint` — analyzers, `dotnet format --verify-no-changes`, ESLint, tsc, tooling, ADR check; `make check` — everything CI runs
- `make format` — auto-format everything
- `make contracts` — rebuild the API and regenerate `contracts/openapi.json` and the TS client. **Commit the result**; CI fails if the contract is stale.
- `make tooling` / `make adr-check` — test/lint repo tooling; validate ADRs (`ARGS=--fix-links`, `ARGS=--next-number`)

Single tests:
- Backend (run from `backend/` so `global.json` applies; uses Microsoft.Testing.Platform, xUnit v3): `dotnet test --project tests/Calendar.Domain.Tests --filter-method "*MethodName*"` (or `--filter-class`)
- Frontend: `pnpm --dir frontend --filter @calendar/web test -- <file-or-pattern>` (Vitest)

## Architecture

- **Contract-first across stacks**: the backend build generates `contracts/openapi.json`; `frontend/packages/api-client` generates a typed client from it (`schema.gen.ts`, do not hand-edit), shared by all TS UIs. Any new UI should consume the contract, not backend code.
- **Backend**: `Calendar.Domain` (no framework dependencies) ← `Calendar.Api` (ASP.NET Core minimal API, endpoints in `Endpoints/`). One xUnit test project per src project; API tests use `WebApplicationFactory`. Planned: PostgreSQL + EF Core code-first (ADR-0014/0015), Docker Compose locally, Testcontainers in tests.
- **Dependencies**: NuGet Central Package Management (`backend/Directory.Packages.props`) with `packages.lock.json` per project (CI restores with `--locked-mode`, so commit lock file changes). Warnings are errors; Roslyn analyzers + SonarAnalyzer are enforced at build time.
- **Frontend**: `frontend/apps/web` (feature folders, e.g. `features/health`; Vitest + Testing Library + MSW), `frontend/packages/api-client`. TypeScript is pinned to 6.0 and ESLint to 9 (ADR-0010).
- **Repo tooling** (ADR-0017): scripts are .NET 10 *file-based apps* (`dotnet run x.cs`), located in `.claude/skills/<skill>/` or `tools/<name>/`, each folder with its own analyzers, `.editorconfig` and xUnit tests. The only exception is `tools/doctor/doctor.sh` (shellcheck). Don't write new tooling in Python/Node/shell.
- **ADRs**: MADR 4.0 with decision drivers, a star-rating table and driver-tagged pros/cons; the index in `docs/decisions/README.md` is validated by `make adr-check`. To write one, use the `adr-draft` skill.

## Notes

- `.plan/` and `.env` are git-ignored scratch/local files.
- Toolchain pins: .NET SDK from `backend/global.json`, Node from `frontend/.node-version`, pnpm via Corepack (`packageManager` in `frontend/package.json`; don't install globally). `make doctor` verifies them.
