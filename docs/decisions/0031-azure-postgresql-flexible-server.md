---
status: proposed
date: 2026-10-29
decision-makers: mgasca, Claude (AI assistant)
---

# Azure Database for PostgreSQL Flexible Server with public access and firewall rules

## Context and Problem Statement

Calendar uses PostgreSQL and separate runtime and migration roles ([ADR-0014](0014-postgresql-database-engine.md), [ADR-0015](0015-ef-core-data-access.md), [ADR-0016](0016-local-database-provisioning.md)). The Azure deployment targets UK South and a few users, with cost and operational simplicity important; [ADR-0029](0029-azure-container-apps-compute-platform.md) covers compute. How should the production database be hosted and reached?

## Decision Drivers

* **D1 Cost**: keep recurring and network costs low for a small workload.
* **D2 Network isolation**: limit who can reach the database and protect data in transit.
* **D3 Operations**: minimise setup, patching, recovery and ongoing administration for an owner new to Azure.
* **D4 Compatibility**: retain PostgreSQL features, role separation and development parity.
* **D5 Reliability**: recover from mistakes and handle availability and workload growth.

## Considered Options

* Flexible Server Burstable with public endpoint and firewall
* Flexible Server with private networking
* Self-managed PostgreSQL on a virtual machine

## Decision Outcome

Chosen option: "Flexible Server Burstable with public endpoint and firewall", because it keeps managed backups and PostgreSQL compatibility (D3, D4, D5) while avoiding private-network infrastructure at the initial scale (D1). Public reachability is a deliberate isolation trade-off (D2).

| Driver | **Public Flexible Server (chosen)** | Private Flexible Server | Self-managed VM |
| --- | :---: | :---: | :---: |
| D1 Cost | ★★★ | ★★☆ | ★★☆ |
| D2 Network isolation | ★★☆ | ★★★ | ★★☆ |
| D3 Operations | ★★★ | ★★☆ | ★☆☆ |
| D4 Compatibility | ★★★ | ★★★ | ★★★ |
| D5 Reliability | ★★☆ | ★★☆ | ★☆☆ |

### Implementation plan

* Use PostgreSQL 18, matching the major version in `compose.yaml` and tests; Azure manages minor updates, so exact minor parity cannot be guaranteed. Verify the selected version and Burstable SKU in UK South for the actual subscription before provisioning.
* Use a small Burstable server in each environment ([ADR-0035](0035-separate-staging-and-production-environments.md)); check actual compute, storage and backup charges before deployment. Burstable CPU credits can exhaust under sustained load; monitor credits and scale the tier if necessary.
* Require TLS and validate the server certificate and hostname in clients. Keep separate `calendar_app` and `calendar_migrator` roles and grants consistent with `docker/postgres`; apply migrations separately before traffic shifts, never at app startup. The deployment path is covered by [ADR-0034](0034-github-actions-oidc-deployment.md), secrets by [ADR-0032](0032-azure-key-vault-for-secrets.md), and infrastructure by [ADR-0033](0033-bicep-for-infrastructure-as-code.md).
* Allow only known client outbound IPv4 addresses where practical, including the migration runner. Container Apps outbound addresses can change; monitor and update rules, and verify actual connectivity. Do not assume the inbound address is the outbound address.
* If stable, narrow source addresses are unavailable, the Azure-services firewall rule (`0.0.0.0` to `0.0.0.0`) is a broader fallback: it permits Azure resources in **other customers' subscriptions**, not just this subscription. Authentication, least privilege and TLS remain essential. GitHub-hosted runners may require their own temporary rule or a migration job with an allowed path; prove that path before deployment and remove temporary access afterwards.
* Keep the default seven-day point-in-time backup retention initially; test a restore into a new server in staging ([issue #82](https://github.com/mgasca/calendar/issues/82)). Azure deletes a server's backups when that server is deleted; protect against accidental deletion and document recovery limitations.

### Consequences

* Good, because managed patching and backups reduce database administration.
* Bad, because the server has a public endpoint, and a broad Azure-services rule admits connection attempts from other customers' Azure resources.
* Bad, because changing outbound IPs can interrupt access; managed compute and storage incur ongoing charges.
* Neutral, because private networking remains a deferred follow-up ([issue #84](https://github.com/mgasca/calendar/issues/84)).

### Confirmation

* Review infrastructure for TLS enforcement, firewall rules, backup retention and separated database credentials and grants.
* In staging, prove app and migration connectivity, verify runtime cannot perform DDL, and perform a point-in-time restore drill. Verify rejected connections from an unapproved source where the configured rules permit that test.

## Pros and Cons of the Options

### Flexible Server Burstable with public endpoint and firewall

* Good, because **D1 Cost**: Burstable suits intermittent small workloads without dedicated private-network infrastructure.
* Bad, because **D2 Network isolation**: the endpoint is public; the Azure-services fallback admits other Azure customers' connection attempts.
* Good, because **D3 Operations**: Azure manages patching and backups without private DNS and VNet setup.
* Good, because **D4 Compatibility**: PostgreSQL 18 and separate database roles retain the existing development and migration model.
* Bad, because **D5 Reliability**: CPU credit exhaustion and changing egress addresses can impair service; point-in-time recovery is available.

### Flexible Server with private networking

* Bad, because **D1 Cost**: private connectivity adds network resources and potentially additional charges.
* Good, because **D2 Network isolation**: private connectivity limits exposure to connected networks.
* Bad, because **D3 Operations**: VNet integration, DNS and a private migration path add setup and troubleshooting.
* Good, because **D4 Compatibility**: the same managed PostgreSQL and roles are available.
* Bad, because **D5 Reliability**: managed backups remain available, but network and DNS misconfiguration can interrupt connections.

### Self-managed PostgreSQL on a virtual machine

* Bad, because **D1 Cost**: a VM and persistent storage run continuously; total cost depends on sizing and backup arrangements.
* Bad, because **D2 Network isolation**: firewall, TLS and operating-system security are the owner's responsibility, though private networking is possible.
* Bad, because **D3 Operations**: the owner must patch, back up, monitor and restore PostgreSQL and its host.
* Good, because **D4 Compatibility**: PostgreSQL and the existing roles remain available.
* Bad, because **D5 Reliability**: recovery and availability depend on additional owner-managed infrastructure and procedures.

## More Information

* Microsoft documents [compute tiers and CPU credits](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-compute), [firewall rules](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/security-firewall-rules), [Container Apps networking](https://learn.microsoft.com/en-us/azure/container-apps/networking), [backup retention and restore](https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore), and [supported PostgreSQL versions](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/quickstart-create-server).
* The [Azure pricing page](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/) lists Burstable SKUs; UK South SKU availability and a region-specific price have not been verified for this subscription. Check the Azure portal or CLI and pricing calculator before provisioning; do not treat a generic list price as a quote.
