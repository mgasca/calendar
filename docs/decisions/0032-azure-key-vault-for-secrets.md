---
status: proposed
date: 2026-10-29
decision-makers: mgasca, Claude (AI assistant)
---

# Azure Key Vault for secrets via managed identity

## Context and Problem Statement

The Azure deployment must supply PostgreSQL credentials and Google sign-in configuration without putting values in the public repository. [ADR-0027](0027-google-oidc-bff-session.md) establishes the cookie-based Google sign-in, and [ADR-0015](0015-ef-core-data-access.md) separates application and migration database roles. Given the Container Apps deployment proposed in [ADR-0029](0029-azure-container-apps-compute-platform.md), where should these values be stored and how should the application receive them?

## Decision Drivers

* **D1 Secret access**: limit access and avoid long-lived Azure credentials in deployment automation.
* **D2 Rotation and audit**: support coordinated updates and trace access and changes.
* **D3 Cost**: keep recurring costs proportionate to a few users.
* **D4 Operational simplicity**: keep the first Azure deployment understandable and supportable.
* **D5 Environment isolation**: prevent staging credentials from granting production access.

## Considered Options

* Key Vault references with a user-assigned managed identity
* Container Apps secrets populated directly
* CI-injected plain environment variables

## Decision Outcome

Chosen option: "Key Vault references with a user-assigned managed identity", because it provides scoped identity-based access (D1), versioned secrets and audit (D2), and separate vaults (D5), while adding manageable cost and operational work (D3, D4).

| Driver | **Key Vault references (chosen)** | Container Apps secrets | CI-injected environment variables |
| --- | :---: | :---: | :---: |
| D1 Secret access | ★★★ | ★★☆ | ★☆☆ |
| D2 Rotation and audit | ★★★ | ★★☆ | ★☆☆ |
| D3 Cost | ★★☆ | ★★★ | ★★★ |
| D4 Operational simplicity | ★★☆ | ★★★ | ★★☆ |
| D5 Environment isolation | ★★★ | ★★☆ | ★★☆ |

### Implementation conventions

* Use a Standard Key Vault per environment, aligned with [ADR-0035](0035-separate-staging-and-production-environments.md). Enable Azure RBAC for its data plane, rather than legacy access policies. Assign each app's user-assigned identity `Key Vault Secrets User` at each app secret scope; separate administrative secret-write permissions from runtime read permissions. Restrict Container Apps `listSecrets` and management permissions too: references do not make resolved app secrets inaccessible to privileged operators.
* Create Container Apps secrets as Key Vault references using that identity, then map them through `secretRef` to `ConnectionStrings__Calendar`, `Auth__Google__ClientId`, `Auth__Google__ClientSecret` and each `Auth__AllowedEmails__N`. The connection string includes the app-role password; the migrator credential is separate and must not be exposed to the app identity. The client ID is not a password, but store it with its environment's OAuth configuration. Do not put secret values in Bicep files, source, logs or workflow output.
* Use versionless secret URIs. Container Apps checks for updated versions within 30 minutes and restarts active revisions referencing them through environment variables ([Microsoft documentation](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets)). This is not automatic credential creation: coordinate changing the PostgreSQL or Google credential, publishing the vault version and checking the application, with an overlap or rollback plan where the provider permits. Changes can restart revisions and invalidate in-memory state.
* Enable Key Vault audit diagnostics and protect and retain the resulting logs; verify both permitted and denied reads. Azure documents [vault logging](https://learn.microsoft.com/en-us/azure/key-vault/general/logging) and its [RBAC model](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide). Configure infrastructure and deployment under [ADR-0033](0033-bicep-for-infrastructure-as-code.md) and [ADR-0034](0034-github-actions-oidc-deployment.md).

### Consequences

* Good, because secret versions, data-plane authorization and audit are managed separately for each environment.
* Bad, because vaults, role assignments, diagnostics and rotation procedures add setup, dependencies and usage charges.
* Neutral, because values still reach the application as environment variables and can be exposed by an overly privileged operator or application process.

### Confirmation

Review the infrastructure and deployment changes for separate vaults, secret-scoped RBAC, identity assignments, secret references and absence of literal values. In staging, confirm the app can read its secrets but cannot read the production vault or migrator credential, inspect audit events including a denied read, rotate a test secret and verify propagation and restart without logging its value. Test a coordinated credential rotation before production use.

## Pros and Cons of the Options

### Key Vault references with a user-assigned managed identity

* Good, because **D1 Secret access**: managed identity removes an application-held Azure credential and RBAC restricts vault reads.
* Good, because **D2 Rotation and audit**: secret versions and vault audit events support rotation and investigation.
* Good, because **D5 Environment isolation**: separate vaults and identities bound permissions by environment.
* Bad, because **D3 Cost**: vault operations and diagnostic ingestion or retention can incur charges.
* Bad, because **D4 Operational simplicity**: identity, role propagation, diagnostics and coordinated rotation need setup and troubleshooting.

### Container Apps secrets populated directly

* Good, because **D3 Cost**: no extra vault operations are needed.
* Good, because **D4 Operational simplicity**: secrets are configured directly on the app.
* Neutral, because **D1 Secret access**: Azure controls access, but deployment operators must supply the secret values.
* Bad, because **D2 Rotation and audit**: updates require restarting revisions or deploying a new one, and there is no separate vault audit trail or versioned source.
* Neutral, because **D5 Environment isolation**: separate apps and scoped permissions can isolate values, but secret administration is tied to app access.

### CI-injected plain environment variables

* Good, because **D3 Cost**: no vault operations are needed.
* Neutral, because **D4 Operational simplicity**: injection is familiar, but secure CI storage and rotation must still be maintained.
* Bad, because **D1 Secret access**: plain application configuration and pipeline handling broaden opportunities for disclosure.
* Bad, because **D2 Rotation and audit**: changes require a deployment and the value has no vault version or vault access audit.
* Neutral, because **D5 Environment isolation**: separate CI environments and scoped permissions can isolate values but must be configured correctly.

## More Information

Standard vault operations are usage-priced; diagnostic destinations can also cost money. Check the [Azure pricing page](https://azure.microsoft.com/en-us/pricing/details/key-vault/) and the calculator for the subscription and UK South before provisioning; an actual estimate and region availability have not been verified. No numeric price is assumed here.

ASP.NET Data Protection key persistence and protection is a related but separate decision: the hosting story [#76](https://github.com/mgasca/calendar/issues/76) must resolve it before production. Without persistent shared keys, restarts or revisions can invalidate existing authentication cookies. Key Vault secret storage alone does not persist the Data Protection key ring.
