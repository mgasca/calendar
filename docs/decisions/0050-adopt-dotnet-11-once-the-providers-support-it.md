---
status: accepted
date: 2026-11-11
decision-makers: mgasca, Claude (AI assistant)
---

# Move to .NET 11 once the EF Core providers support it

## Context and Problem Statement

[ADR-0002](0002-dotnet-10-minimal-api-backend.md) chose .NET 10 LTS and rejected .NET 11 STS while it was a pre-release. .NET 11 reached general availability on 2026-11-10, and Dependabot has already moved `dotnet-ef` to 11.0.0 (#652), so the migration tool is one major version ahead of the SDK, runtime and EF Core packages. Does the repository move to .NET 11 ([story 0056](../stories/0056-bump-dotnet-sdk-to-11.md), issue #657), and when?

## Decision Drivers

* **D1 Support window**: the SDK, runtime and packages stay supported for as long as the repository needs them.
* **D2 Upgrade churn**: few major upgrades; each one touches the SDK pin, target frameworks, images, packages, lock files and the generated contract.
* **D3 Ecosystem readiness**: every dependency (Npgsql provider, naming conventions, analyzers) supports the framework we move to, so no mixed major versions.
* **D4 Needed features**: a feature or fix in the new release that the product needs, and staying near the current release.
* **D5 Toolchain consistency**: the SDK, runtime, EF Core packages and `dotnet-ef` agree on a major version ([ADR-0006](0006-dotnet-dependency-management.md), [ADR-0010](0010-toolchain-version-pins.md)).

## Considered Options

* Adopt .NET 11 once the EF Core providers support it, then .NET 12
* Adopt LTS releases only: stay on .NET 10 until .NET 12 LTS
* Adopt every release (STS and LTS) as soon as the dependencies support it

## Decision Outcome

Chosen option: "Adopt .NET 11 once the EF Core providers support it, then .NET 12", because it has the same support window as .NET 10 (D1), keeps `dotnet-ef` and the runtime on one major version (D5) and keeps the repository on the current release (D4). The maintainer chose it on 2026-11-11 over the LTS-only option, which would have saved one upgrade (D2) but left the merged `dotnet-ef` 11 a major version ahead of the runtime. The move waits for the dependencies (D3).

| Driver | **.NET 11 once providers support it (chosen)** | LTS releases only | Adopt every release |
| --- | :---: | :---: | :---: |
| D1 Support window | ★★★ | ★★★ | ★★★ |
| D2 Upgrade churn | ★☆☆ | ★★★ | ☆☆☆ |
| D3 Ecosystem readiness | ★★☆ | ★★★ | ★★☆ |
| D4 Needed features | ★★★ | ★☆☆ | ★★★ |
| D5 Toolchain consistency | ★★★ | ★★☆ | ★★★ |

### Gate and plan

* **Gate:** the delivery PR starts when `Npgsql.EntityFrameworkCore.PostgreSQL` has a stable 11.x release (11.0.0-rc.3 is on NuGet today) and `EFCore.NamingConventions` is shown to work on EF Core 11, or is replaced. The SDK pin, `net11.0`, images, packages, lock files and contract move together in one PR (story 0056). Until then the repository stays on .NET 10.
* **After 11:** the next move is .NET 12 LTS (expected November 2027). Each later release is a new decision; this record does not commit the repository to adopt every release.
* **Relation to [ADR-0002](0002-dotnet-10-minimal-api-backend.md):** its choice of Minimal APIs and the Domain/Api structure stands; only its version choice (".NET 10 LTS") is overridden for the release dates above. It carries a dated amendment bullet pointing here.

### Consequences

* Good, because the SDK, runtime, EF Core packages and `dotnet-ef` end up on the same major version.
* Good, because .NET 11 is supported until 2028-11-14, as .NET 10 is.
* Bad, because the repository makes two major upgrades within a year (11 now, 12 in November 2027).
* Bad, because the delivery is blocked on a third-party release. Until it ships, `dotnet-ef` 11 runs against EF Core 10 packages, which was not tested.
* Neutral, because [ADR-0002](0002-dotnet-10-minimal-api-backend.md) keeps its status; reviewers may prefer to supersede it (open question 2).

### Confirmation

`global.json` pins the SDK ([ADR-0010](0010-toolchain-version-pins.md)) and `just doctor` checks it. The acceptance criteria of story 0056 check the move: every project is `net11.0`, locked restore, image build, migrations, contract and `just check`.

## Pros and Cons of the Options

### Adopt .NET 11 once the EF Core providers support it, then .NET 12

* Good, because **D1 Support window**: supported until 2028-11-14.
* Good, because **D4 Needed features**: all .NET 11 features and fixes, and the repository stays near the current release.
* Good, because **D5 Toolchain consistency**: matches `dotnet-ef` 11 once done.
* Bad, because **D2 Upgrade churn**: a second major upgrade a year later for .NET 12, with no longer support in return.
* Bad, because **D3 Ecosystem readiness**: the provider is a release candidate and `EFCore.NamingConventions` has no 11.x (10.0.1); the move waits for them.

### Adopt LTS releases only: stay on .NET 10 until .NET 12 LTS

* Good, because **D1 Support window**: .NET 10 is supported until 2028-11-14, the same date as .NET 11.
* Good, because **D2 Upgrade churn**: one major upgrade instead of two within a year.
* Good, because **D3 Ecosystem readiness**: nothing to wait for; the provider stack is on 10.x.
* Bad, because **D4 Needed features**: .NET 11 features are not available, although none is needed today.
* Bad, because **D5 Toolchain consistency**: `dotnet-ef` 11.0.0 is already merged (#652) while the EF Core packages are 10.0.14; it needs reverting or an ignore rule.

### Adopt every release (STS and LTS) as soon as the dependencies support it

* Good, because **D4 Needed features**: always the newest framework.
* Good, because **D1 Support window**: each release is supported when adopted.
* Good, because **D5 Toolchain consistency**: always aligned with the latest tools.
* Bad, because **D2 Upgrade churn**: a major upgrade every November, each with the full file set and regenerated lock files and contract.
* Bad, because **D3 Ecosystem readiness**: each release starts with providers that lag it, as .NET 11 does today.

## More Information

* Verified on 2026-11-11: the official [releases index](https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/releases-index.json) lists 11.0 as `sts`, active, SDK 11.0.100, end of support 2028-11-14, and 10.0 as `lts`, SDK 10.0.404, end of support 2028-11-14. The 11.0.0 release date is 2026-11-10 (11.0 `releases.json`). `Microsoft.EntityFrameworkCore` and `Microsoft.AspNetCore.OpenApi` 11.0.0 are on NuGet; `Npgsql.EntityFrameworkCore.PostgreSQL` is at 10.0.3 stable with 11.0.0-rc.3 as a pre-release, and `EFCore.NamingConventions` at 10.0.1. The 11.0 SDK and ASP.NET images exist on MCR.
* **Correction:** the first version of issue #657 and PR #658 said .NET 11's support window is shorter than .NET 10's. It is the same, because standard-term releases get 24 months.
* **Revisit when** the provider's stable 11.x ships (the gate), or if `EFCore.NamingConventions` stays without an 11.x release.
* **Open questions for the reviewer:** (1) If `EFCore.NamingConventions` has no 11.x when the provider ships, replace it with EF Core's own naming code or wait? (2) Supersede [ADR-0002](0002-dotnet-10-minimal-api-backend.md) as a whole instead of amending it? That also touches the many records citing it.
* **Amendment, 2026-11-11:** the backend left .NET ([ADR-0051](0051-rust-backend-on-axum-and-tokio.md)), so this record's gate (a stable Npgsql EF Core provider 11 and `EFCore.NamingConventions`) and its backend file set (target frameworks, runtime image, EF Core packages, `dotnet-ef`, the contract) lapse with it. What remains is the .NET SDK the repo tools run on, pinned in the root `global.json`: the chosen direction (".NET 11, then .NET 12") still governs that pin, and the move no longer waits for any EF package. Story [0056](../stories/0056-bump-dotnet-sdk-to-11.md) is narrowed the same way.
