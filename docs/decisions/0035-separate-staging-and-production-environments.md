---
status: proposed
date: 2026-10-29
decision-makers: mgasca, Claude (AI assistant)
---

# Separate staging and production environments

## Context and Problem Statement

Calendar's Azure deployment serves a small number of allow-listed users with Google sign-in and a same-origin cookie ([ADR-0027](0027-google-oidc-bff-session.md)). The deployment plan needs a place to exercise releases and migrations before they reach production, while keeping costs manageable. How should staging and production be separated?

## Decision Drivers

* **D1 Cost**: minimize recurring charges for a small, intermittently used application.
* **D2 Production data safety**: testing and migrations must not expose or alter real user data.
* **D3 Failure isolation**: staging changes and outages should not affect production resources.
* **D4 Release confidence**: exercise a representative deployment, authentication and migration before production.
* **D5 Operational simplicity**: keep setup and ongoing management understandable for an owner new to Azure.

## Considered Options

* Separate staging and production resources
* Separate databases on a shared PostgreSQL server
* Preview a revision against production data
* Production only

## Decision Outcome

Chosen option: "Separate staging and production resources", because the D1 cost is mitigated by stopping staging when idle, while D2 and D3 protect production and a representative staging deployment improves D4.

| Driver | **Separate resources (chosen)** | Shared server | Production-data preview | Production only |
| --- | :---: | :---: | :---: | :---: |
| D1 Cost | ★☆☆ | ★★☆ | ★★★ | ★★★ |
| D2 Production data safety | ★★★ | ★★☆ | ☆☆☆ | ☆☆☆ |
| D3 Failure isolation | ★★★ | ★☆☆ | ☆☆☆ | ☆☆☆ |
| D4 Release confidence | ★★★ | ★★☆ | ★☆☆ | ☆☆☆ |
| D5 Operational simplicity | ★☆☆ | ★★☆ | ★★☆ | ★★★ |

### Environment conventions

* Provision separate resource groups, Container Apps, PostgreSQL Flexible Servers, Key Vaults and Google OAuth clients for staging and production. Each app uses its own database, vault, OAuth credentials, allow-list and redirect URI on its own default `azurecontainerapps.io` hostname. Staging holds synthetic test data, not production data or credentials. Resource groups alone do not provide a security boundary: scope access, identities and credentials to their environment.
* Use the smallest available staging PostgreSQL SKU that supports the workload in UK South; its availability and price for the subscription remain unverified. Stop staging PostgreSQL when idle and start it before deployment, migrations or tests; staging is unavailable while it is stopped. A stopped server automatically starts after seven days, so monitor it and stop it again when appropriate. Compute savings are not zero-cost: provisioned storage and applicable excess backup storage remain billable, and compute billing resumes on restart. No new backups are taken while stopped. Check costs and operational state rather than assuming it stays stopped indefinitely.
* Apply the same infrastructure modules with environment-specific parameters, as proposed in [ADR-0033](0033-bicep-for-infrastructure-as-code.md). The hosting, packaging, database, secrets and deployment mechanisms are addressed separately in [ADR-0029](0029-azure-container-apps-compute-platform.md), [ADR-0030](0030-single-container-for-api-and-spa.md), [ADR-0031](0031-azure-postgresql-flexible-server.md), [ADR-0032](0032-azure-key-vault-for-secrets.md) and [ADR-0034](0034-github-actions-oidc-deployment.md).

### Consequences

* Good, because staging migrations, test data and OAuth configuration have separate resources and credentials.
* Bad, because duplicate resources increase cost and setup effort; staging must be started before use and may restart automatically.
* Neutral, because separation reduces but does not eliminate common subscription, region or administrative failures.

### Confirmation

* Review infrastructure parameters and role assignments for distinct resource IDs, credentials, database servers and OAuth redirect URIs; check staging cannot access production secrets or data.
* Deploy and migrate staging, exercise sign-in and smoke tests using synthetic data, then verify the production release gate and separate target. Check the stopped staging server, its automatic restart and charges in Azure during operations.

## Pros and Cons of the Options

### Separate staging and production resources

* Good, because **D2 Production data safety**: staging uses separate synthetic data and credentials.
* Good, because **D3 Failure isolation**: staging database and resource changes do not directly change production resources.
* Bad, because **D1 Cost**: a second server and resources incur charges even when some compute is stopped.
* Good, because **D4 Release confidence**: the same architecture and migration path can be exercised before production.
* Bad, because **D5 Operational simplicity**: two sets of resources, access and OAuth configuration must be managed.

### Separate databases on a shared PostgreSQL server

* Good, because **D1 Cost**: one server avoids a second server's compute and storage overhead.
* Good, because **D5 Operational simplicity**: one server needs less infrastructure administration.
* Bad, because **D2 Production data safety**: database separation and credentials help, but server-wide privileged access crosses the boundary.
* Bad, because **D3 Failure isolation**: server outages, resource contention and server-level changes affect both databases; stopping staging compute also stops production.
* Bad, because **D4 Release confidence**: database-level migrations can be tested, but server configuration changes cannot be isolated.

### Preview a revision against production data

* Good, because **D1 Cost**: avoids a second database server and supporting environment.
* Good, because **D5 Operational simplicity**: revision routing uses the existing application and server.
* Bad, because **D2 Production data safety**: test traffic and migrations can read or alter real user data.
* Bad, because **D3 Failure isolation**: revisions share production dependencies and application-level settings.
* Bad, because **D4 Release confidence**: testing a revision cannot safely rehearse destructive migrations independently.

### Production only

* Good, because **D1 Cost**: only one environment is provisioned.
* Good, because **D5 Operational simplicity**: only one set of resources and credentials is managed.
* Bad, because **D2 Production data safety**: testing and migrations directly affect real data.
* Bad, because **D3 Failure isolation**: there is no separate place to contain release failures.
* Bad, because **D4 Release confidence**: no representative pre-production deployment or migration rehearsal exists.

## More Information

* Microsoft documents [server stop and seven-day automatic start](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/how-to-stop-server), [stopped-server backup and storage billing](https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore), and [revision and application-scope changes](https://learn.microsoft.com/en-us/azure/container-apps/revisions).
* UK South SKU availability and subscription-specific costs must be checked before provisioning. Implementation and deployment walkthroughs are tracked by the [deployment plan](https://github.com/mgasca/calendar/issues/85).
