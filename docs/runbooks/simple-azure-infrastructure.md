# Azure infrastructure

Each environment has its own resources in UK South. An environment is a separate place to run the app. Use synthetic data in staging. Synthetic data does not contain real user information.

Each environment has a Log Analytics workspace, workspace-based Application Insights, and a Basic ACR registry. A registry stores container images. A container image contains the files needed to run an app.

Each environment also has two Standard Key Vaults, a user-assigned identity, PostgreSQL Flexible Server, and a Container Apps environment and app. A vault stores secrets, such as passwords. An identity gives an app or deployment access to Azure resources. Tags identify the app and environment.

Azure role-based access control (RBAC) grants permissions through roles. The app identity has AcrPull and Key Vault Secrets User on the app vault only. The deployment identity has Key Vault Secrets User on both vaults. Both vaults send audit events to Log Analytics.

## Initial deployment

Complete [Azure bootstrap](azure-bootstrap.md), including provider registration and the capacity query. A provider supplies Azure resource types. Make sure that global resource names and quotas are available. A quota limits resource use.

Both environments use `Standard_B1ms`, the smallest documented Burstable SKU. A SKU specifies the database resources and price. Availability for this subscription is not verified. If you change the SKU later, update `postgresSku` in the relevant `infra/parameters/*.bicepparam`. Review a full what-if and confirm capacity and cost before deployment. A what-if previews changes.

The commands below deploy staging. After you make sure that staging works, repeat them for production. Use the production client ID, `ENV=production`, and `rg-calendar-production` in the Azure CLI commands. The Make targets require [PR #113](https://github.com/mgasca/calendar/pull/113) to be merged.

Run `az login` and select the intended subscription as described in the bootstrap runbook. Run the commands from the repository root. The signed-in owner needs permission to assign roles on each vault. The owner also needs permission to read the deployment service principal in Microsoft Graph. A service principal is an identity for an application in Azure.

1. Run the tool check and identify the staging deployment identity. Use its client ID from `STAGING_CLIENT_ID` in bootstrap or `AZURE_CLIENT_ID` in the staging GitHub environment. The tool looks up the service principal's object ID in Microsoft Graph. It passes that object ID as `deployerPrincipalId`, not the signed-in owner's object ID.

```bash
   make doctor ARGS=--infra
   export AZURE_DEPLOYER_CLIENT_ID='<staging-deployment-client-id>'
   az rest --method get --url "https://graph.microsoft.com/v1.0/servicePrincipals(appId='$AZURE_DEPLOYER_CLIENT_ID')" --query '{clientId:appId,objectId:id}' -o json
   ```

Make sure that the tool check succeeds. Make sure that both returned IDs belong to the staging deployment identity.

2. Preview the foundation. The foundation contains Log Analytics, Application Insights, the registry, both vaults, the managed identity, and role grants. A managed identity is an Azure-managed identity. This phase does not create the database or app. The ops vault must exist before you can store the database password.

```bash
   make infra-what-if ENV=staging PHASE=foundation
```

Review the preview before you deploy. Then deploy the foundation and inspect its outputs.

```bash
   make infra-deploy ENV=staging PHASE=foundation
   az deployment group show --resource-group rg-calendar-staging --name calendar-foundation --query '{state:properties.provisioningState,appVault:properties.outputs.appKeyVaultName.value,opsVault:properties.outputs.opsKeyVaultName.value}' -o json
```

Make sure that the deployment state is `Succeeded` and that two distinct vault names appear. Role permissions can take about 10 minutes to take effect. If access fails, wait and retry.

3. Grant the signed-in owner Key Vault Secrets Officer on both vaults. This role lets the owner create the password and app secrets. The deployment identity remains read-only.

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

Make sure that each list contains the role and the correct vault scope. A scope is the resource to which a role applies. Wait for the role permissions to take effect before using the vaults.

4. Use the owner's login to create the password in the ops vault. Then display its name, not its value.

```bash
   make infra-secret-init ENV=staging
   az keyvault secret show --vault-name "$ops_vault" --name postgres-admin-password --query name -o tsv
   ```

Make sure that the output is `postgres-admin-password`. The tool generates the value locally and does not print it. It refuses to overwrite an existing password. Password rotation requires a coordinated manual change. Do not put secret values in shell arguments, parameter files, logs, or the repository.

5. Preview the full phase. Replace `<your-public-ip-or-cidr>` with the owner's public IPv4 address or CIDR. CIDR describes an IP address range. This address gives the owner access for later database work. Bicep adds the app's outbound addresses separately. Bicep describes Azure resources in code.

```bash
   make infra-what-if ENV=staging PHASE=full ARGS="--allow-ip <your-public-ip-or-cidr>"
```

Review the preview before you deploy. Then deploy and inspect the database and app.

```bash
   make infra-deploy ENV=staging PHASE=full ARGS="--allow-ip <your-public-ip-or-cidr>"
   az postgres flexible-server list --resource-group rg-calendar-staging --query '[].{name:name,state:state,sku:sku.name}' -o json
   az containerapp list --resource-group rg-calendar-staging --query '[].{name:name,state:properties.provisioningState,fqdn:properties.configuration.ingress.fqdn}' -o json
```

Make sure that the database and Container App exist. Make sure that the SKU is `Standard_B1ms` and that both resources finished provisioning. Provisioning creates Azure resources. Open the placeholder's HTTPS URL. Repeat the full what-if to inspect drift. Drift is a difference between deployed resources and the code.

The full deployment reads the ops password securely. The first deployment has no app secrets until S6 and S9 add them.

The tool uses a secure parameter instead of a checked-in `az.getSecret()` reference. The foundation must work before the vault and secret exist. The subscription-specific vault ID is not known in the parameter files. The tool must use protected transport that does not log the password. The vault also enables template deployment for future use. Full-phase what-if and deployment need the existing password and live verification. See Microsoft's [secure deployment parameters and Key Vault references](https://learn.microsoft.com/azure/azure-resource-manager/templates/key-vault-parameter).

## Parameters and application secrets

`infra/main.bicep` deploys to a resource group. A resource group holds related Azure resources. The parameter files contain the environment, SKU, and default Azure-services firewall setting. A firewall controls network access.

The deployment tool supplies `deployerPrincipalId`, `deployDatabaseAndApp`, `postgresAdministratorPassword`, `containerImage`, `keyVaultSecretNames`, and `allowedFirewallIps` when needed. Firewall entries are objects with `startIpAddress` and `endIpAddress`. `allowAzureServices` defaults to false. If enabled, the Azure-services rule permits connections from Azure broadly, including other subscriptions.

The database module runs after the Container App. It adds the app's reported outbound IPs to the database firewall. The initial placeholder does not depend on PostgreSQL, so the modules do not depend on each other in a circle. These IPs can change. If they change, inspect the current app properties and redeploy the infrastructure. Supply migration runner and operator IPs separately. A migration runner applies database changes. Do not commit those IPs to this public repository.

`minReplicas` and `maxReplicas` default to 0 and 1. A replica is a running copy of the app. The public hello-world placeholder uses port 80 without custom probes. A probe tests whether the app can start, run, or receive traffic. Any other image uses `targetPort`, which defaults to 8080. It also uses startup, liveness, and readiness probes at `/api/health`.

Issue #75 and ADR-0030 do not specify the image port. S3 must confirm that its Dockerfile listens on 8080 or pass the matching port. Measure cold-start time before increasing the minimum. Cold-start time is the time needed to start an idle app. The app uses 0.25 vCPU and 0.5 GiB. External ingress accepts HTTPS only. Ingress is network traffic that enters the app.

The `keyVaultSecretNames` list contains only existing, enabled app-vault secrets. Bicep also restricts the list to the application allowlist. An allowlist names the permitted entries. Versionless references use the app identity, which cannot read the ops vault. A versionless reference selects a secret without naming a version.

The secret names `calendar-connection-string`, `google-client-id`, `google-client-secret`, and `allowed-email-0`, `allowed-email-1`, etc. map to `ConnectionStrings__Calendar`, `Auth__Google__ClientId`, `Auth__Google__ClientSecret`, and `Auth__AllowedEmails__0`, `Auth__AllowedEmails__1`, etc. Add only names with values in the vault. Make sure that changes to references and role permissions work in Azure. For the first full deployment, only the ops password exists. The initial placeholder uses an empty app-secret list.

S6 provides database initialization and migration commands in the [database runbook](azure-database.md). These commands initialize `calendar_migrator` and `calendar_app` and grant least-privilege access. S9 must create separate Google OAuth clients, credentials, and allowed emails in each vault. S9 must also configure redirect URIs. S7 must publish and promote the real image. S8 must connect Application Insights and alerts.

## Staging database operations

Use the tooling's staging database start and stop commands. You can also stop the server with `az postgres flexible-server stop --resource-group rg-calendar-staging --name <server-name>`. Replace `<server-name>` with the server name. Before migrations, deployment, or testing, replace `stop` with `start` and run the command. Make sure that the server is running in Azure before you continue.

Stopping makes staging unavailable. Storage and excess backup storage remain billable. Azure starts a stopped server after seven days. Azure takes no new backups while it is stopped. Monitor the server state and stop it again when appropriate.

Burstable servers consume CPU credits above baseline. Credits measure the extra CPU time available above baseline. Long periods of load can exhaust credits and reduce availability. Monitor credits and alert on a low balance. If needed, choose a larger SKU or tier. See [compute guidance](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-compute-storage) and [stop and start](https://learn.microsoft.com/azure/postgresql/configure-maintain/how-to-stop-server).

## Estimated monthly costs

These illustrative USD retail rates came from the [Microsoft retail prices API](https://prices.azure.com/api/retail/prices). They are for UK South on 2026-10-29. They exclude tax, discounts, and currency conversion. They are not a quote. A meter is the unit Azure uses to price a service:

- Container Registry Basic Registry Unit: $0.1666/day.
- PostgreSQL Flexible Server Burstable BS Series Compute B1MS: $0.019/hour.
- Flex Server Storage Storage Data Stored: $0.133/GB-month.
- Flexible Server Backup Storage Backup Storage LRS Data Stored: $0.10/GB-month.
- Log Analytics Analytics Logs Data Ingestion: $2.88/GB, with a separate $0 free tier meter.
- Key Vault Operations: $0.03/10,000 operations.

Under these assumptions, the second vault adds no fixed vault charge. Its 10,000 operations add $0.03 per environment.

The estimate assumes 730 compute hours and 30 registry days. It assumes 32 GB storage and backup usage no greater than the included provisioned storage. It assumes 1 GB of logs within the applicable free allowance. It assumes 20,000 vault operations, with 10,000 per vault. Container Apps usage stays within the subscription's shared free grant.

Per environment, the rounded components are $13.87 compute, $5.00 registry, $4.26 storage, and $0.06 vault operations. Using unrounded components, staging costs about $23.18/month. Production costs about $23.18/month. Both cost about $46.37/month.

The staging estimate assumes continuous operation. Each stopped hour saves about $0.019 in compute until automatic restart. Backup overage, extra log ingestion or retention, request or compute overages, network, taxes, and other services add cost. Make sure that the allowances apply. Review actual usage and invoices. The estimate is not a spending cap. [ADR-0029](../decisions/0029-azure-container-apps-compute-platform.md) describes the Container Apps grant assumptions.

## Live verification

The original runbook records that no deployment or preview has run against the subscription. The owner must run both phase what-ifs and deployments. The owner must repeat the full what-if to inspect drift. Make sure that role permissions take effect. Make sure that image pulls, secret resolution, health probes, network access, and PostgreSQL TLS work. TLS protects network connections. Review costs and quotas in Azure.
