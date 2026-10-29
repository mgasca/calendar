---
status: proposed
date: 2026-10-29
decision-makers: mgasca, Claude (AI assistant)
---

# Deploy with GitHub Actions and OIDC federation

## Context and Problem Statement

[ADR-0012](0012-ci-and-dependency-updates.md) establishes GitHub Actions CI; the Azure deployment plan adds staging and production releases to the public repository ([ADR-0013](0013-public-repository-for-github-security-features.md)). [ADR-0015](0015-ef-core-data-access.md) requires migrations outside the application under `calendar_migrator`. How should releases authenticate to Azure and move safely through both environments?

## Decision Drivers

* **D1 Credential security**: avoid long-lived deployment credentials and limit access to each target.
* **D2 Release safety**: validate the exact release and require an explicit production gate.
* **D3 Operational simplicity**: keep a small team's deployment understandable and maintainable.
* **D4 Cost**: avoid unnecessary additional platform costs for a public, small project.

## Considered Options

* GitHub Actions with OIDC federation and an approval gate
* GitHub Actions with a service-principal secret
* Manual Azure deployments
* Azure DevOps pipelines

## Decision Outcome

Chosen option: "GitHub Actions with OIDC federation and an approval gate", because short-lived federated credentials improve D1, the existing CI and environment gate support D2, and GitHub integration reduces D3 and D4 costs.

| Driver | **Actions OIDC (chosen)** | Actions secret | Manual | Azure DevOps |
| --- | :---: | :---: | :---: | :---: |
| D1 Credential security | ★★★ | ★☆☆ | ★★☆ | ★★★ |
| D2 Release safety | ★★★ | ★★★ | ★☆☆ | ★★★ |
| D3 Operational simplicity | ★★☆ | ★★☆ | ★★☆ | ★☆☆ |
| D4 Cost | ★★★ | ★★★ | ★★★ | ★★☆ |

### Deployment conventions

* After successful `.github/workflows/ci.yml` for a push to `main`, deploy the exact tested commit: build and publish an image identified by its commit SHA, deploy staging automatically, and smoke-test it. Only then may the same image advance to production, after the production GitHub Environment's required reviewer approves. A failed or cancelled CI, migration, staging deployment or smoke test must stop promotion. Do not substitute a later `main` checkout for the tested SHA.
* Use separate staging and production deployment identities, with Azure RBAC scoped to the resources each job needs. Each environment job obtains a GitHub OIDC token (`id-token: write` only where needed) and exchanges it for short-lived Azure access using workload identity federation. No long-lived Azure deployment client secret is stored in GitHub. Follow [ADR-0012](0012-ci-and-dependency-updates.md) for action pinning and least-privilege workflow permissions.
* Bind each federated credential to its exact repository and environment subject, issuer `https://token.actions.githubusercontent.com`, and audience `api://AzureADTokenExchange`. The traditional subjects are `repo:mgasca/calendar:environment:staging` and `repo:mgasca/calendar:environment:production`. Environment subjects do not contain a branch: restrict both GitHub Environments to `main` separately, protect workflow changes, and do not trust pull-request subjects. Verify the actual issued subject before provisioning: repositories can use immutable owner/repository ID subjects or custom claims; configure an exact match and revise it if the repository is renamed or transferred.
* Configure production required reviewers and restrict bypass rights. A single owner may approve their own deployment unless self-review is disabled; this gate is an explicit release pause, not necessarily independent review. Confirm an eligible reviewer exists before enabling a self-review prohibition.
* Run each environment's migration as a pipeline step with `calendar_migrator`, after approval for production and before traffic shifts. The application remains `calendar_app` and never migrates itself. OIDC removes Azure login secrets, not necessarily database credentials: obtain any migrator credential securely from the environment's secret store without logging it, and ensure the migration runner can reach PostgreSQL. If migration fails, leave the existing revision serving traffic; database rollback and compatibility require an operational plan because schema changes may already have applied.
* Infrastructure, secret storage, compute and environment isolation are addressed separately by [ADR-0029](0029-azure-container-apps-compute-platform.md), [ADR-0030](0030-single-container-for-api-and-spa.md), [ADR-0031](0031-azure-postgresql-flexible-server.md), [ADR-0032](0032-azure-key-vault-for-secrets.md), [ADR-0033](0033-bicep-for-infrastructure-as-code.md) and [ADR-0035](0035-separate-staging-and-production-environments.md).

### Consequences

* Good, because a tested release progresses automatically to staging and requires an explicit production approval.
* Good, because Azure deployment authentication needs no stored long-lived client secret.
* Bad, because environment protection and federated identity setup require careful administration, and migrations still need database access and possibly a separate credential.
* Neutral: approval gates on GitHub depend on repository visibility and plan; verify them before changing either.

### Confirmation

The implementation PR must demonstrate a successful main CI run followed by a staging deploy of the same SHA and smoke test, a pending production job before approval, and the same image deployed after approval. Verify failed CI and failed migration cannot advance traffic, denied or wrong-environment OIDC subjects cannot authenticate, `calendar_migrator` runs before the traffic shift, and the app does not migrate at startup. Review environment branch restrictions, reviewer and Azure RBAC settings, and validate workflows with actionlint.

## Pros and Cons of the Options

### GitHub Actions with OIDC federation and an approval gate

* Good, because **D1 Credential security**: short-lived federated tokens and separate scoped identities remove stored Azure client secrets.
* Good, because **D2 Release safety**: CI, environment approvals and sequential migration and smoke tests provide enforceable gates.
* Good, because **D3 Operational simplicity**: builds on the existing GitHub workflow, although federation and permissions need setup.
* Good, because **D4 Cost**: the existing public repository can use GitHub's environment protections without an additional platform.

### GitHub Actions with a service-principal secret

* Bad, because **D1 Credential security**: a stored long-lived secret needs protection and rotation.
* Good, because **D2 Release safety**: the same CI and environment approval rules can gate deployments.
* Neutral, because **D3 Operational simplicity**: federation setup is avoided but secret rotation adds maintenance.
* Good, because **D4 Cost**: uses the existing public GitHub repository.

### Manual Azure deployments

* Neutral, because **D1 Credential security**: interactive authentication can avoid a stored service-principal secret, but depends on individual access management.
* Bad, because **D2 Release safety**: operators must consistently enforce tests, migration order and approval themselves.
* Neutral, because **D3 Operational simplicity**: fewer workflows but repeatable releases require a runbook and operator time.
* Good, because **D4 Cost**: requires no additional deployment platform.

### Azure DevOps pipelines

* Good, because **D1 Credential security**: Azure DevOps supports federated service connections and scoped Azure permissions.
* Good, because **D2 Release safety**: pipelines and environment approvals can enforce release stages.
* Bad, because **D3 Operational simplicity**: introduces another project and deployment system alongside GitHub CI.
* Neutral, because **D4 Cost**: available capacity and any paid usage depend on the Azure DevOps organization and plan.

## More Information

* [GitHub environment availability](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments): public repositories have protection rules on current plans; required reviewers on GitHub Free, Pro and Team are limited to public repositories. Private repository support depends on plan. Reassess the gate before changing visibility.
* [GitHub OIDC subject reference](https://docs.github.com/en/actions/reference/security/oidc) and [Microsoft federated credential setup](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-create-trust): issuer, audience and subject must match. [Immutable subject migration](https://learn.microsoft.com/en-us/entra/workload-id/workload-identities-github-immutable-subjects) documents the newer ID-bearing format.
* [Azure DevOps workload identity federation](https://learn.microsoft.com/en-us/azure/devops/pipelines/release/configure-workload-identity) and [environment approvals](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals).
* Actual repository subject configuration, Azure RBAC grants, migration runner network access and reviewer settings are unverified until implementation.
