---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# NuGet Central Package Management with lock files

## Context and Problem Statement

How should NuGet dependency versions be managed across multiple .NET projects, reproducibly?

## Considered Options

* Central Package Management (CPM) + `packages.lock.json`
* Versions in each `.csproj`
* Paket

## Decision Outcome

Chosen option: "CPM + lock files":

* All versions are in `backend/Directory.Packages.props`, and projects reference packages without versions. `CentralPackageTransitivePinningEnabled` lets us pin vulnerable transitive packages centrally.
* `RestorePackagesWithLockFile=true`, with lock files committed. `RestoreLockedMode` is on when `CI=true`.
* `NuGet.config` clears inherited sources and uses **package source mapping** to nuget.org only, which mitigates dependency confusion.
* Shared build settings live in `Directory.Build.props`, with test-only settings in `tests/Directory.Build.props`.

### Consequences

* Good, because there's one place to bump versions, Dependabot understands it, and restores are deterministic.
* Bad, because adding a package means editing two files (the props entry plus the reference).
