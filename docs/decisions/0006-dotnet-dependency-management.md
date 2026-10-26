---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# NuGet Central Package Management with lock files and source mapping

## Context and Problem Statement

How should NuGet dependency versions be managed across multiple .NET projects reproducibly and safely?

## Decision Drivers

* **D1 Single source of versions**: one place to see and bump every package version, with no project drift.
* **D2 Reproducible restores**: identical package graphs locally and in CI.
* **D3 Supply-chain safety**: protection against dependency confusion and easy patching of vulnerable transitive packages.
* **D4 Tooling support**: works with the `dotnet` CLI, IDEs and Dependabot without plugins.
* **D5 Low friction**: adding or updating a package stays simple.

## Considered Options

* Central Package Management (CPM) + `packages.lock.json` + package source mapping
* Versions in each `.csproj` (default)
* Paket

## Decision Outcome

Chosen option: "CPM + lock files + source mapping", because it is the only built-in option covering a single version source (D1), reproducibility (D2) and supply-chain controls (D3), with full tooling support (D4).

| Driver | **CPM + lock files + source mapping (chosen)** | Per-`.csproj` versions | Paket |
| --- | :---: | :---: | :---: |
| D1 Single source | ★★★ | ☆☆☆ | ★★★ |
| D2 Reproducible | ★★★ | ★☆☆ | ★★★ |
| D3 Supply-chain safety | ★★★ | ★☆☆ | ★★☆ |
| D4 Tooling support | ★★★ | ★★★ | ★☆☆ |
| D5 Low friction | ★★☆ | ★★★ | ★☆☆ |

Implementation:

* All versions are in `backend/Directory.Packages.props`, and projects reference packages without versions.
* `CentralPackageTransitivePinningEnabled` lets vulnerable transitive packages be pinned centrally.
* `RestorePackagesWithLockFile=true`, with lock files committed. `RestoreLockedMode` is on when `CI=true`.
* `NuGet.config` clears inherited sources and maps all packages to nuget.org.
* Shared build settings live in `Directory.Build.props`, with test-only settings in `tests/Directory.Build.props`.

### Consequences

* Good, because Dependabot updates a single file per bump, and security updates can pin transitive packages.
* Bad, because adding a package means editing two files: the `PackageVersion` entry and the `PackageReference`.

### Confirmation

CI runs `dotnet restore --locked-mode`, which fails if a lock file is stale. A `PackageReference` with a `Version` attribute fails the build under CPM (NU1008).

## Pros and Cons of the Options

### CPM + lock files + source mapping

* Good, because **D1 Single source**: `Directory.Packages.props` is authoritative.
* Good, because **D2 Reproducible**: lock files plus locked mode in CI.
* Good, because **D3 Supply-chain safety**: source mapping blocks packages from unexpected feeds, and transitive pinning patches deep vulnerabilities.
* Good, because **D4 Tooling support**: built into NuGet; supported by `dotnet add package`, Visual Studio/Rider and Dependabot.
* Bad, because **D5 Low friction**: two edits per new package, and lock files add diff noise (marked `linguist-generated`).

### Per-`.csproj` versions

* Good, because **D5 Low friction**: the default; `dotnet add package` just works.
* Good, because **D4 Tooling support**: universal.
* Bad, because **D1 Single source**: the same package can drift across projects.
* Bad, because **D2 Reproducible**: floating transitive resolution without lock files.
* Bad, because **D3 Supply-chain safety**: no central pinning of transitive dependencies.

### Paket

* Good, because **D1**, **D2**: `paket.dependencies` and `paket.lock` are a strong single source and lock.
* Bad, because **D4 Tooling support**: an extra tool; Dependabot doesn't support Paket; less IDE integration.
* Bad, because **D5 Low friction**: a separate CLI and workflow to learn, with little adoption outside F#.
* Neutral, because **D3 Supply-chain safety**: supports source restrictions, but not NuGet's source mapping.
