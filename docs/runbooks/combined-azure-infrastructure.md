# Azure infrastructure

This runbook creates the Azure resources for staging, then for production, in the UK South region. Each environment has its own resources. Use only synthetic (made-up) data in staging.

## What gets created

Each environment gets these resources. Tags on each resource name the app and the environment.

| Resource | What it is for |
| --- | --- |
| Log Analytics workspace | Stores operational logs, including vault audit events. |
| Application Insights (workspace-based) | Collects telemetry from the running app. |
| Azure Container Registry (Basic) | Stores container images: the packaged app. |
| Two Key Vaults (Standard, RBAC) | Store secrets. The **app vault** holds the app's secrets. The **ops vault** holds the database administrator and role passwords. |
| User-assigned managed identity | The identity the running app uses. Azure manages it, so the app holds no Azure password. |
| PostgreSQL Flexible Server | The managed database. |
| Container Apps environment and app | Runs the app's image. |

Access uses Azure role-based access control (RBAC): a role granted on a scope, such as one vault.

- The app's identity has **AcrPull** (read images) and **Key Vault Secrets User** (read secrets) on the app vault only.
- The deployment identity has **Key Vault Secrets User** on both vaults.

See [ADR-0032](../decisions/0032-azure-key-vault-for-secrets.md) for secrets, [ADR-0033](../decisions/0033-bicep-for-infrastructure-as-code.md) for Bicep and [ADR-0034](../decisions/0034-github-actions-oidc-deployment.md) for the deployment identity.

## Terms

- **Bicep**: the language of the files in `infra/`. They describe the resources you want; Azure Resource Manager (ARM) creates or updates them. The `make infra-*` commands wrap the repository's deployment tool.
- **What-if**: ARM's preview of the changes a deployment would make. It can be incomplete or noisy, so read it; a clean preview does not guarantee the result.
- **Phase**: the deployment runs in two phases. **Foundation** creates everything except the database and the app. **Full** adds them.
- **SKU**: a size and price tier. Both environments use `Standard_B1ms`, the smallest documented Burstable PostgreSQL SKU.
- **Service principal**: the directory entry for an application identity. Its **client ID** names the application; its **object ID** names the entry.
- **Drift**: a difference between the deployed resources and the Bicep files.

## Before you start

- Complete [Azure bootstrap](azure-bootstrap.md), including provider registration and the capacity query. The bootstrap creates the resource groups and the deployment identities.
- Check that the global resource names are free and that the subscription quotas are enough. `Standard_B1ms` availability is not verified for this subscription; a listed SKU is not a guarantee.
- Sign in with `az login` and select the subscription, as in the bootstrap runbook.
- Your signed-in account needs permission to deploy to the resource group, to assign roles on each vault, and to read the deployment service principal in Microsoft Graph (Microsoft's directory API).
- Use Bash, from the repository root, on a trusted machine. Keep **one shell** open for all the steps: later steps use variables set in earlier ones.
- These commands create resources that cost money. See [Estimated monthly costs](#estimated-monthly-costs).

## Initial deployment

These steps set up **staging**. When staging works, repeat them for production: use the production deployment client ID, `ENV=production`, and `rg-calendar-production` in the `az` commands.

1. **Check the tools and the deployment identity.** Use the staging deployment identity's client ID: `STAGING_CLIENT_ID` from the bootstrap, or the `AZURE_CLIENT_ID` variable of the staging GitHub environment.

   ```bash
   make doctor ARGS=--infra
   export AZURE_DEPLOYER_CLIENT_ID='<staging-deployment-client-id>'
   az rest --method get --url "https://graph.microsoft.com/v1.0/servicePrincipals(appId='$AZURE_DEPLOYER_CLIENT_ID')" --query '{clientId:appId,objectId:id}' -o json
   ```

   `make doctor` must pass; if it fails, follow its install hints. The `az rest` output must show the staging deployment identity. The tool passes that object ID, not yours, to Bicep as `deployerPrincipalId`.

2. **Preview the foundation, then deploy it.** The ops vault must exist before you can store the database password, so the foundation comes first.

   ```bash
   make infra-what-if ENV=staging PHASE=foundation
   ```

   Read the preview. Deploy only if every change is expected.

   ```bash
   make infra-deploy ENV=staging PHASE=foundation
   az deployment group show --resource-group rg-calendar-staging --name calendar-foundation --query '{state:properties.provisioningState,appVault:properties.outputs.appKeyVaultName.value,opsVault:properties.outputs.opsKeyVaultName.value}' -o json
   ```

   Expect `"state": "Succeeded"` and two different vault names. New role assignments can take about 10 minutes to work; if access fails, wait and retry.

3. **Give yourself Key Vault Secrets Officer on both vaults**, so you can create the password now and the app secrets later. The deployment identity stays read-only.

   ```bash
   app_vault=$(az deployment group show -g rg-calendar-staging -n calendar-foundation --query properties.outputs.appKeyVaultName.value -o tsv)
   ops_vault=$(az deployment group show -g rg-calendar-staging -n calendar-foundation --query properties.outputs.opsKeyVaultName.value -o tsv)
   owner_id=$(az ad signed-in-user show --query id -o tsv)
   for vault in "$app_vault" "$ops_vault"; do
     vault_id=$(az keyvault show -g rg-calendar-staging -n "$vault" --query id -o tsv)
     az role assignment create --assignee-object-id "$owner_id" --assignee-principal-type User --role 'Key Vault Secrets Officer' --scope "$vault_id"
     az role assignment list --assignee "$owner_id" --scope "$vault_id" --query "[?roleDefinitionName=='Key Vault Secrets Officer'].{role:roleDefinitionName,scope:scope}" -o json
   done
   ```

   Each list must show the role on that vault. Wait for the role to take effect before you use the vaults.

4. **Create the database administrator password in the ops vault**, then check that it exists without showing its value.

   ```bash
   make infra-secret-init ENV=staging
   az keyvault secret show --vault-name "$ops_vault" --name postgres-admin-password --query name -o tsv
   ```

   Expect `postgres-admin-password`. The tool generates the password on your machine and never prints it. It refuses to overwrite an existing password; changing it needs a planned manual change. Never put secret values in shell arguments, parameter files, logs or the repository.

5. **Preview the full phase, then deploy it.** Replace `<your-public-ip-or-cidr>` with your public IPv4 address (for example `203.0.113.7/32`) or range. This lets you reach the database for later work. Bicep adds the app's own outbound addresses.

   ```bash
   make infra-what-if ENV=staging PHASE=full ARGS="--allow-ip <your-public-ip-or-cidr>"
   ```

   Read the preview. Deploy only if every change is expected.

   ```bash
   make infra-deploy ENV=staging PHASE=full ARGS="--allow-ip <your-public-ip-or-cidr>"
   az postgres flexible-server list --resource-group rg-calendar-staging --query '[].{name:name,state:state,sku:sku.name}' -o json
   az containerapp list --resource-group rg-calendar-staging --query '[].{name:name,state:properties.provisioningState,fqdn:properties.configuration.ingress.fqdn}' -o json
   ```

   Expect one database with SKU `Standard_B1ms` and one Container App, both provisioned. Open `https://<fqdn>` from the app list and check that the placeholder page responds.

6. **Check for drift.** Run the full what-if from step 5 again, with the same address. Investigate any change it still shows.

The first full deployment has no app secrets yet. The [database runbook](azure-database.md), which comes next, adds the connection string; Google sign-in adds the rest later.

### Why the password is a secure parameter

The tool reads the ops-vault password and passes it to Bicep as a secure parameter, over a transport that does not log it. A checked-in `az.getSecret()` reference cannot work here: the foundation must deploy before the vault and secret exist, and the parameter files do not know the subscription-specific vault ID. See Microsoft's [secure deployment parameters and Key Vault references](https://learn.microsoft.com/azure/azure-resource-manager/templates/key-vault-parameter). The vault also allows template deployment, for future use.

## Parameters and application secrets

`infra/main.bicep` deploys to one resource group. The checked-in parameter files (`infra/parameters/*.bicepparam`) set the environment, the SKU and the Azure-services firewall setting. The deployment tool supplies `deployerPrincipalId`, `deployDatabaseAndApp`, `postgresAdministratorPassword`, `containerImage`, `keyVaultSecretNames` and `allowedFirewallIps` as needed.

**Changing the SKU:** edit `postgresSku` in the environment's `.bicepparam` file, review a full what-if, and deploy only after you confirm capacity and cost.

**Database firewall:**

- Firewall entries are objects with `startIpAddress` and `endIpAddress`.
- `allowAzureServices` defaults to false. If enabled, it lets in connections from any Azure customer, not just this subscription.
- The database module runs after the Container App and adds the app's outbound IPs. This is not circular, because the placeholder app does not use PostgreSQL.
- The app's outbound IPs can change. When they do, redeploy the infrastructure.
- Supply migration-runner and operator IPs at deploy time. Never commit IP addresses to this public repository.

**Container App:**

- `minReplicas` is 0 and `maxReplicas` is 1 by default. Measure cold-start time before you raise the minimum.
- The app uses 0.25 vCPU and 0.5 GiB, with HTTPS-only external ingress.
- The public hello-world placeholder uses port 80 and no custom probes. Any other image uses `targetPort` (default 8080), with startup, liveness and readiness probes on `/api/health`. Issue #75 and ADR-0030 do not specify the image port, so story S3 must confirm that its Dockerfile listens on 8080, or pass the matching port.

**App secrets:** the app reads secrets through versionless Key Vault references (always the current version), using its own identity, which cannot read the ops vault. `keyVaultSecretNames` lists only app-vault secrets that exist, are enabled and have values; Bicep also limits it to this allowlist:

| App-vault secret | App setting |
| --- | --- |
| `calendar-connection-string` | `ConnectionStrings__Calendar` |
| `google-client-id` | `Auth__Google__ClientId` |
| `google-client-secret` | `Auth__Google__ClientSecret` |
| `allowed-email-0`, `allowed-email-1`, … | `Auth__AllowedEmails__0`, `Auth__AllowedEmails__1`, … |

After you change the references or role assignments, check in Azure that the app can read them. The first full deployment uses an empty list, because only the ops password exists then.

**Later delivery stories** (S3 and S6–S9 are story labels, not commands):

- S6: database roles, least-privilege grants and migrations; see the [database runbook](azure-database.md).
- S7: publish and promote the real image.
- S8: wire Application Insights and alerts.
- S9: separate Google OAuth clients, credentials and allowed emails in each vault, and the redirect URIs.

## Staging database operations

Stop the staging database when it is not in use, to save compute cost:

```bash
make infra-db-stop
```

Start it again before migrations, deployments or testing:

```bash
make infra-db-start
```

You can also use `az postgres flexible-server stop --resource-group rg-calendar-staging --name <server-name>`, and `start` in place of `stop`. Get `<server-name>` from the `az postgres flexible-server list` command in step 5.

After either command, run the list command again and wait until it reports the new state.

While it is stopped:

- Staging is unavailable.
- Storage and extra backup storage are still billed.
- Azure takes no new backups.
- Azure starts it again automatically after seven days. Check its state and stop it again if needed.

Burstable servers use CPU credits when they run above their baseline. Long periods of load can use up the credits and slow the server. Monitor the credits, alert on a low balance, and move to a larger SKU or tier if needed. See [compute guidance](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-compute-storage) and [stop and start](https://learn.microsoft.com/azure/postgresql/configure-maintain/how-to-stop-server).

## Estimated monthly costs

These are example USD retail prices from the [Microsoft retail prices API](https://prices.azure.com/api/retail/prices) for UK South on 2026-10-29. They exclude tax, discounts and currency conversion. They are not a quote and not a spending cap.

| Service | Meter | Price |
| --- | --- | --- |
| Container Registry | Basic Registry Unit | $0.1666/day |
| PostgreSQL Flexible Server | Burstable BS Series Compute B1MS | $0.019/hour |
| PostgreSQL Flexible Server | Storage Data Stored | $0.133/GB-month |
| PostgreSQL Flexible Server | Backup Storage LRS Data Stored | $0.10/GB-month |
| Log Analytics | Analytics Logs Data Ingestion | $2.88/GB (a $0 free-tier meter also exists) |
| Key Vault | Operations | $0.03/10,000 operations |

Assumptions per environment: 730 compute hours, 30 registry days, 32 GB storage, backups within the included storage, 1 GB of logs within the free allowance, 20,000 vault operations (10,000 per vault), and Container Apps usage within the subscription's shared free grant ([ADR-0029](../decisions/0029-azure-container-apps-compute-platform.md)). The second vault adds no fixed charge, only its operations ($0.03).

| Item | Per environment |
| --- | --- |
| Compute | $13.87 |
| Registry | $5.00 |
| Storage | $4.26 |
| Vault operations | $0.06 |
| **Total** (from unrounded parts) | **$23.18/month** |

Staging and production together cost about **$46.37/month**. The staging figure assumes it runs all month; each stopped hour saves about $0.019 until Azure restarts it. Backup overage, extra log ingestion or retention, request or compute overages, network, taxes and other services add cost. Check the allowances, actual usage and invoices in Azure.

## Not yet verified live

When this runbook was written, nothing had been deployed or previewed against the subscription. On the first run, the owner must also check: role propagation, image pulls, secret resolution, health probes, network access, PostgreSQL TLS, and costs and quotas in Azure.
