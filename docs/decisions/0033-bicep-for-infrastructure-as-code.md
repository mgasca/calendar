---
status: proposed
date: 2026-10-29
decision-makers: mgasca, Claude (AI assistant)
---

# Bicep for Azure infrastructure as code

## Context and Problem Statement

Calendar needs repeatable Azure infrastructure for a small, cost-conscious deployment maintained by an owner new to Azure. The deployment plan separates the choices of [compute](0029-azure-container-apps-compute-platform.md), [database](0031-azure-postgresql-flexible-server.md), [secrets](0032-azure-key-vault-for-secrets.md), [deployment](0034-github-actions-oidc-deployment.md), and [environments](0035-separate-staging-and-production-environments.md). Which infrastructure-as-code approach should describe and preview the Azure resources?

## Decision Drivers

* **D1 Repeatability**: version and review infrastructure changes and reproduce environments consistently.
* **D2 Operational burden**: minimise state management, maintenance and cost for a small deployment.
* **D3 Learning curve**: make Azure provisioning understandable to a newcomer.
* **D4 Safe previews**: preview changes in CI before deployment, with limitations visible to reviewers.
* **D5 Repository fit**: use pinned, verifiable tools and fit the existing Make and .NET tooling conventions.

## Considered Options

* Bicep driven by Azure CLI
* Terraform or OpenTofu with Azure providers
* Azure Developer CLI with Bicep
* Manual Azure portal or CLI provisioning

## Decision Outcome

Chosen option: "Bicep driven by Azure CLI", because it provides reviewed declarative configuration and Azure what-if previews (D1, D4), without a separate state backend (D2). It keeps the Azure-specific toolchain and orchestration approachable (D3, D5), accepting less portability and weaker lifecycle tracking.

| Driver | **Bicep driven by Azure CLI (chosen)** | Terraform or OpenTofu | Azure Developer CLI with Bicep | Manual provisioning |
| --- | :---: | :---: | :---: | :---: |
| D1 Repeatability | ★★★ | ★★★ | ★★★ | ☆☆☆ |
| D2 Operational burden | ★★★ | ★☆☆ | ★★☆ | ★☆☆ |
| D3 Learning curve | ★★☆ | ★☆☆ | ★★☆ | ★★☆ |
| D4 Safe previews | ★★☆ | ★★★ | ★★☆ | ☆☆☆ |
| D5 Repository fit | ★★★ | ★★☆ | ★★☆ | ★☆☆ |

### Implementation conventions

* Store shared Bicep modules and separate non-secret parameter files for staging and production under `infra/`. Resource choices and environment separation remain in the linked ADRs; do not commit secret values or emit them as outputs.
* Use thin `make` targets invoking `az` directly, or a .NET 10 file-based app under `tools/` when orchestration needs logic, consistent with [ADR-0011](0011-make-as-top-level-task-runner.md) and [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md). Do not add shell, Python or Node tooling scripts.
* At implementation, record exact mutually compatible Azure CLI and Bicep versions in a checked-in toolchain manifest. Install the specified Bicep version with `az bicep install --version`; ensure local and CI Azure CLI use that binary rather than silently choosing a different PATH binary. Extend `make doctor` to compare `az version` and `az bicep version` with those pins, report actionable installation hints and fail on missing or mismatched versions. Pin CI to the same versions and update them deliberately with verification, consistent with [ADR-0010](0010-toolchain-version-pins.md). The exact versions are to be verified when implemented, not guessed here.
* CI should lint/build the Bicep and run Azure Resource Manager what-if for each targeted environment before applying infrastructure changes. Publish the preview for review without exposing secrets; the identity and approval policy belong to [ADR-0034](0034-github-actions-oidc-deployment.md). What-if needs deployment-equivalent permissions, can produce incomplete or noisy results, and is not a guarantee of the eventual deployment; inspect its diagnostics and treat incomplete previews as requiring investigation.
* ARM incremental deployments do not remove resources simply because they disappear from a template. Review removals and drift explicitly and document the separate cleanup procedure; never assume what-if or redeployment deletes orphaned resources.

### Consequences

* Good, because shared modules and environment parameters make infrastructure reviewable and repeatable without a separate state store.
* Bad, because Bicep is Azure-specific, and managing removals and drift requires deliberate operational work.
* Neutral: Azure CLI and Bicep become additional pinned deployment prerequisites; local-only contributors need installation guidance.

### Confirmation

The infrastructure implementation PR includes doctor tests for missing and mismatched pins, CI Bicep lint/build and environment what-if, and a documented example of reviewing a no-change preview. Reviewers verify that both CI and local deployment use the pinned binaries, that parameters contain no secrets, and that removal and preview limitations are documented. `make adr-check` validates this record.

## Pros and Cons of the Options

### Bicep driven by Azure CLI

* Good, because **D1 Repeatability**: declarative modules and parameter files live in version control.
* Good, because **D2 Operational burden**: ARM handles deployment without a separate state file or backend.
* Good, because **D3 Learning curve**: Azure-native resources and one CLI align with Azure documentation, although ARM concepts still need learning.
* Bad, because **D4 Safe previews**: what-if requires powerful permissions and may be incomplete or noisy.
* Good, because **D5 Repository fit**: thin Make targets or .NET orchestration can invoke pinned Azure CLI and Bicep directly.

### Terraform or OpenTofu with Azure providers

* Good, because **D1 Repeatability**: declarative configuration and providers support reviewed deployments, including non-Azure resources.
* Bad, because **D2 Operational burden**: shared state needs a secured, backed-up backend and operational care.
* Bad, because **D3 Learning curve**: a newcomer must learn providers, state and the chosen tool as well as Azure.
* Good, because **D4 Safe previews**: plans compare configuration with managed state before apply, although they still require review and can become stale.
* Neutral, because **D5 Repository fit**: Make or .NET can invoke pinned binaries, but provider and tool versions add maintenance.

### Azure Developer CLI with Bicep

* Good, because **D1 Repeatability**: Bicep templates and environment configuration are versioned.
* Bad, because **D2 Operational burden**: an additional CLI and its environment conventions add a layer over ARM and Bicep.
* Neutral, because **D3 Learning curve**: templates can simplify getting started but introduce azd concepts alongside Azure.
* Neutral, because **D4 Safe previews**: Bicep-backed provisioning can preview changes, subject to ARM what-if limitations.
* Bad, because **D5 Repository fit**: an extra CLI and its Bicep selection must be pinned and reconciled with existing Make tasks.

### Manual Azure portal or CLI provisioning

* Bad, because **D1 Repeatability**: a sequence of manual actions is easy to omit or vary between environments.
* Bad, because **D2 Operational burden**: repeated changes and drift reconciliation rely on manual records and attention.
* Good, because **D3 Learning curve**: portal exploration can help a newcomer understand individual Azure resources.
* Bad, because **D4 Safe previews**: there is no unified versioned infrastructure diff for CI to review.
* Bad, because **D5 Repository fit**: manual changes bypass repeatable Make tasks and toolchain checks.

## More Information

* Microsoft documents [Bicep and Terraform state and lifecycle differences](https://learn.microsoft.com/en-us/azure/developer/terraform/get-started/comparing-terraform-and-bicep), [what-if permissions and limitations](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/deploy-what-if), and [Azure CLI Bicep version installation and binary selection](https://learn.microsoft.com/en-us/cli/azure/bicep).
* [Azure Developer CLI supports Bicep and Terraform](https://learn.microsoft.com/en-us/azure/developer/azure-developer-cli/use-terraform-for-azd); it is an orchestration layer, not a distinct IaC language.
* Tool versions, Azure permissions, actual CI previews and environment resources remain unverified until implementation against the subscription.
