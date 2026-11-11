---
status: proposed
date: 2026-11-11
decision-makers: mgasca, Claude (AI assistant)
---

# Move the .NET SDK and target framework only to LTS releases

## Context and Problem Statement

[ADR-0002](0002-dotnet-10-minimal-api-backend.md) chose .NET 10 LTS and rejected .NET 11 STS while it was a pre-release. .NET 11 reached general availability on 2026-11-10, and Dependabot has already moved `dotnet-ef` to 11.0.0 (#652), so the migration tool is one major version ahead of the SDK, runtime and EF Core packages. Which .NET releases does the repository adopt, and when ([story 0056](../stories/0056-bump-dotnet-sdk-to-11.md), issue #657)?

## Decision Drivers

* **D1 Support window**: the SDK, runtime and packages stay supported for as long as the repository needs them.
* **D2 Upgrade churn**: few major upgrades; each one touches the SDK pin, target frameworks, images, packages, lock files and the generated contract.
* **D3 Ecosystem readiness**: every dependency (Npgsql provider, naming conventions, analyzers) supports the framework we move to, so no mixed major versions.
* **D4 Needed features**: a feature or fix in the new release that the product needs.
* **D5 Toolchain consistency**: the SDK, runtime, EF Core packages and `dotnet-ef` agree on a major version ([ADR-0006](0006-dotnet-dependency-management.md), [ADR-0010](0010-toolchain-version-pins.md)).

## Considered Options

* Adopt LTS releases only: stay on .NET 10 until .NET 12 LTS
* Adopt .NET 11 now, once the providers support it, then .NET 12
* Adopt every release (STS and LTS) as soon as the dependencies support it

## Decision Outcome

Chosen option: "Adopt LTS releases only: stay on .NET 10 until .NET 12 LTS", because .NET 11 has the same end-of-support date as .NET 10 (D1), skipping it saves a whole major upgrade (D2), the Npgsql EF Core provider has no 11.x release yet (D3), and no .NET 11 feature is needed (D4). The cost is a major-version gap in the migration tool (D5), which the Consequences below bound.

| Driver | **LTS releases only (chosen)** | Adopt .NET 11 now | Adopt every release |
| --- | :---: | :---: | :---: |
| D1 Support window | ★★★ | ★★★ | ★★★ |
| D2 Upgrade churn | ★★★ | ★☆☆ | ☆☆☆ |
| D3 Ecosystem readiness | ★★★ | ☆☆☆ | ★★☆ |
| D4 Needed features | ★☆☆ | ★★★ | ★★★ |
| D5 Toolchain consistency | ★★☆ | ★★★ | ★★★ |

### Policy

* The SDK pin, `net*` target framework, image tags and Microsoft package majors move together, to an LTS release only. The next move is .NET 12 LTS (expected November 2027).
* An STS release is adopted only on a written exception: a feature or security fix the product needs that is not in the LTS, with the providers already supporting it. The exception is an ADR that supersedes this one for that release.
* `dotnet-ef` stays on the major version of the EF Core packages. Dependabot major bumps of `dotnet-ef`, the Microsoft packages and `Microsoft.AspNetCore.*` are closed or ignored until the LTS move (the ignore rule is in `.github/dependabot.yml`, in the implementation PR).
* [ADR-0002](0002-dotnet-10-minimal-api-backend.md) stands: this record adds the policy for later versions and does not change its choice of .NET 10.

### Consequences

* Good, because one major upgrade is skipped: the repository moves from .NET 10 to 12 directly.
* Good, because no dependency runs on a different major version than the framework.
* Bad, because .NET 11 features are unavailable until the .NET 12 move.
* Bad, because .NET 10 and .NET 11 both end support on 2028-11-14: the .NET 12 move has to land well before then (about a year of margin from a November 2027 release).
* Neutral, because story 0056 and issue #657 are closed without delivery, or retargeted to .NET 12 when it ships.

### Confirmation

`global.json` pins the SDK ([ADR-0010](0010-toolchain-version-pins.md)) and `just doctor` checks it. The Dependabot ignore rule keeps major bumps of the .NET packages and tools out of the PR queue. The revisit trigger below is recorded in `AGENTS.md` (Overview, toolchain pins) so a contributor sees it before bumping.

## Pros and Cons of the Options

### Adopt LTS releases only: stay on .NET 10 until .NET 12 LTS

* Good, because **D1 Support window**: .NET 10 is supported until 2028-11-14, the same date as .NET 11.
* Good, because **D2 Upgrade churn**: one major upgrade instead of two within a year.
* Good, because **D3 Ecosystem readiness**: nothing to wait for; the provider stack is on 10.x.
* Bad, because **D4 Needed features**: .NET 11 features are not available, although none is needed today.
* Bad, because **D5 Toolchain consistency**: `dotnet-ef` 11.0.0 is already merged (#652) while the EF Core packages are 10.0.14, so it is a one-major mismatch until it is reverted or the compatibility is confirmed (open question 2).

### Adopt .NET 11 now, once the providers support it, then .NET 12

* Good, because **D1 Support window**: supported until 2028-11-14.
* Good, because **D4 Needed features**: all .NET 11 features, e.g. current ASP.NET Core and EF Core improvements.
* Good, because **D5 Toolchain consistency**: matches `dotnet-ef` 11.
* Bad, because **D2 Upgrade churn**: a second major upgrade a year later for .NET 12, for no longer support.
* Bad, because **D3 Ecosystem readiness**: `Npgsql.EntityFrameworkCore.PostgreSQL` is at 10.0.3 and `EFCore.NamingConventions` at 10.0.1 with no 11.x on NuGet; the move would have to wait for them or run a 10.x provider on EF Core 11.

### Adopt every release (STS and LTS) as soon as the dependencies support it

* Good, because **D4 Needed features**: always the newest framework.
* Good, because **D1 Support window**: each release is supported when adopted.
* Good, because **D5 Toolchain consistency**: always aligned with the latest tools.
* Bad, because **D2 Upgrade churn**: a major upgrade every November, each with the full file set and regenerated lock files and contract.
* Bad, because **D3 Ecosystem readiness**: each release starts with providers that lag it, as .NET 11 does today.

## More Information

* Verified on 2026-11-11: the official [releases index](https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/releases-index.json) lists 11.0 as `sts`, active, SDK 11.0.100, end of support 2028-11-14, and 10.0 as `lts`, SDK 10.0.404, end of support 2028-11-14. The 11.0.0 release date is 2026-11-10 (11.0 `releases.json`). `Microsoft.EntityFrameworkCore` and `Microsoft.AspNetCore.OpenApi` 11.0.0 are on NuGet; `Npgsql.EntityFrameworkCore.PostgreSQL` and `Npgsql` are at 10.0.3 and `EFCore.NamingConventions` at 10.0.1. The 11.0 SDK and ASP.NET images exist on MCR.
* **Correction:** the first version of issue #657 and PR #658 said .NET 11's support window is shorter than .NET 10's. It is the same, because standard-term releases now get 24 months; the real reasons are churn and provider readiness.
* **Revisit when** .NET 12 LTS is released (expected November 2027), when the Npgsql provider ships an 11.x release and a feature of 11 is needed, or a security fix lands only in 11.
* **Open questions for the reviewer:** (1) Accept LTS-only, or adopt 11 once the provider ships? (2) Revert the merged `dotnet-ef` 11.0.0 bump (#652) to 10.0.x, or keep it? Whether `dotnet-ef` 11 works against the EF Core 10 packages was not tested.
