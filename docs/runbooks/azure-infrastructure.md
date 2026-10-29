# Azure infrastructure

Each UK South environment has its own Log Analytics workspace, workspace-based Application Insights, Basic ACR, two Standard RBAC Key Vaults (app and ops), user-assigned identity, PostgreSQL Flexible Server and Container Apps environment and app. Tags identify the app and environment. The workload identity has AcrPull and Key Vault Secrets User on the app vault only; the deployment identity has Key Vault Secrets User on both vaults. Both vaults send audit events to Log Analytics. Resources are isolated by environment; use synthetic data in staging.

## Initial deployment

Complete [Azure bootstrap](azure-bootstrap.md), including provider registration and its capacity query. Both staging and production use `Standard_B1ms`, the smallest documented Burstable SKU. Its availability in each environment is unverified for this subscription. Check global resource name availability and quotas. To change a SKU later, update `postgresSku` in the relevant `infra/parameters/*.bicepparam`, review a full what-if, and deploy after confirming capacity and cost.

The following commands set up **staging**; repeat with `production` and that environment's deployment client ID after staging is verified. The Make targets require [PR #113](https://github.com/mgasca/calendar/pull/113) to be merged. Sign in with `az login`, select the intended subscription as in the bootstrap runbook, and run commands from the repository root. The owner needs permission to assign roles on each vault and permission to read the deployment service principal in Microsoft Graph.

1. Check tools and identify the deployer. Set this to the staging deployment identity's **client ID** from the bootstrap's `STAGING_CLIENT_ID` or the staging GitHub environment's `AZURE_CLIENT_ID` variable. The tool looks up that service principal's object ID through Microsoft Graph and passes it as `deployerPrincipalId`; it does not use the signed-in owner's object ID for that role.

   ```bash
   make doctor ARGS=--infra
   export AZURE_DEPLOYER_CLIENT_ID='<staging-deployment-client-id>'
   az rest --method get --url "https://graph.microsoft.com/v1.0/servicePrincipals(appId='$AZURE_DEPLOYER_CLIENT_ID')" --query '{clientId:appId,objectId:id}' -o json
   ```

   Verify the toolchain check succeeds and the returned client ID and object ID belong to the staging deployment identity.

2. Preview and deploy the **foundation**: the shared building blocks are Log Analytics, Application Insights, the registry, both vaults, the managed identity and role grants. This phase does not create the database or app. It comes first because the ops vault must exist before the owner can store the database password.

   ```bash
   make infra-what-if ENV=staging PHASE=foundation
   make infra-deploy ENV=staging PHASE=foundation
   az deployment group show --resource-group rg-calendar-staging --name calendar-foundation --query '{state:properties.provisioningState,appVault:properties.outputs.appKeyVaultName.value,opsVault:properties.outputs.opsKeyVaultName.value}' -o json
   ```

   Review the preview before deploying. Verify the deployment state is `Succeeded` and both distinct vault names appear. Role creation and permission propagation are separate: wait and retry access failures, allowing about 10 minutes.

3. Grant your signed-in owner identity **Key Vault Secrets Officer** on both vaults. This permits the owner to initialize the password and later application secrets; the deployment identity remains read-only. The role assignment requires permission to grant roles at each vault.

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

   Verify each list contains the intended role and vault scope. Allow time for RBAC propagation before using the vaults.

4. Initialize the password in the ops vault using the owner's login, then check its name without displaying its value.

   ```bash
   make infra-secret-init ENV=staging
   az keyvault secret show --vault-name "$ops_vault" --name postgres-admin-password --query name -o tsv
   ```

   Verify the output is `postgres-admin-password`. The tool generates the value locally, does not print it, and refuses to overwrite an existing password; rotation requires a coordinated manual change. Do not put secret values in shell arguments, parameter files, logs or the repository.

5. Preview and deploy the full phase. Replace `<your-public-ip-or-cidr>` with the owner's actual IPv4 address or CIDR; this gives the owner access for later database work. The app's outbound addresses are added separately by Bicep.

   ```bash
   export AZURE_ALERT_EMAIL='<owner-alert-email>'
   make infra-what-if ENV=staging PHASE=full ARGS="--allow-ip <your-public-ip-or-cidr>"
   make infra-deploy ENV=staging PHASE=full ARGS="--allow-ip <your-public-ip-or-cidr>"
   az postgres flexible-server list --resource-group rg-calendar-staging --query '[].{name:name,state:state,sku:sku.name}' -o json
   az containerapp list --resource-group rg-calendar-staging --query '[].{name:name,state:properties.provisioningState,fqdn:properties.configuration.ingress.fqdn}' -o json
   ```

   Review the preview, then verify the database and Container App exist, the SKU is `Standard_B1ms`, and provisioning succeeds. Check the placeholder's HTTPS URL and repeat the full what-if to inspect drift. Full deployment reads the ops password securely; first deployment has no app secrets until S6 and S9 add them. Repeat these steps for production with the production client ID, `ENV=production`, and `rg-calendar-production` in the Azure CLI commands.

The secure parameter is used instead of a checked-in `az.getSecret()` reference: foundation must work before the vault and secret exist, while the subscription-specific vault ID is not known in the parameter files. Microsoft documents [secure deployment parameters and Key Vault references](https://learn.microsoft.com/azure/azure-resource-manager/templates/key-vault-parameter); the tool must use a protected, non-logging transport. The vault also enables template deployment for future use. Full-phase what-if and deployment need the existing password and live verification.

## Parameters and application secrets

`infra/main.bicep` is resource-group scoped. The checked-in parameter files contain the environment, SKU and default Azure-services firewall setting. The deployment tool supplies `deployerPrincipalId`, `deployDatabaseAndApp`, `postgresAdministratorPassword`, `containerImage`, `keyVaultSecretNames`, and `allowedFirewallIps` as needed. Firewall entries are objects with `startIpAddress` and `endIpAddress`; `allowAzureServices` defaults to false. The Azure-services rule permits connections from Azure broadly, not just this subscription. The database module runs after the Container App and adds its reported outbound IPs to the database firewall; this has no circular dependency because the initial placeholder does not depend on PostgreSQL. These IPs can change over time: inspect the current app properties and redeploy the infrastructure when they change. Supply migration runner and operator IPs separately; never commit them to this public repository.

Full deployments and previews require `AZURE_ALERT_EMAIL`, passed as the required `alertEmail` parameter; configure the same GitHub environment variable for CI. Foundation passes an empty value because it does not create alerts. `enableAvailabilityTest` is true in production and false in staging; `availabilityFrequencySeconds` defaults to 900. Server error thresholds and windows are documented in [Monitoring](monitoring.md). `monthlyBudgetAmount` is 30 in staging and 40 in production, in the scope's billing currency, which may differ from the retail price currency. Adjust these amounts if needed. After the budget has accrued cost, check the unit with `az consumption budget show-with-rg --budget-name calendar-monthly --resource-group rg-calendar-staging --query properties.currentSpend.unit -o tsv` (or inspect the budget in Cost Management). The deployment tool uses the existing budget start date or the first day of the current UTC month for a new budget, and fails if it cannot read the existing date.

`minReplicas` and `maxReplicas` default to 0 and 1. The public hello-world placeholder automatically uses port 80 without custom probes; any other image uses `targetPort` (default 8080) and startup, liveness and readiness probes at `/api/health`. Issue #75 and ADR-0030 do not specify the image port, so S3 must confirm that its Dockerfile listens on 8080 or pass the matching port. Measure cold-start time before increasing the minimum. The app uses 0.25 vCPU and 0.5 GiB and HTTPS-only external ingress.

The `keyVaultSecretNames` list contains only existing, enabled app-vault secrets; Bicep also intersects it with the application allowlist. Versionless references use the app identity, which cannot read the ops vault. The names `calendar-connection-string`, `google-client-id`, `google-client-secret`, and `allowed-email-0`, `allowed-email-1`, etc. map to `ConnectionStrings__Calendar`, `Auth__Google__ClientId`, `Auth__Google__ClientSecret`, and `Auth__AllowedEmails__0`, `Auth__AllowedEmails__1`, etc. Add only names whose values have been populated. Changes to references and RBAC propagation must be checked live. For the first full deployment, only the ops password exists, so the initial placeholder uses an empty app-secret list.

S6 must create `calendar_migrator` and `calendar_app`, establish schema ownership and least-privilege grants as in `docker/postgres/init/01-roles.sh`, run migrations separately, and store the app connection string using the app role. S9 must provision separate Google OAuth clients, credentials and allow-listed emails in each vault and configure redirect URIs. S7 must publish and promote the real image. S8 wires Application Insights and alerts.

## Staging database operations

Use the tooling's staging database start and stop commands, or run `az postgres flexible-server stop --resource-group rg-calendar-staging --name <server-name>` and replace `stop` with `start` before migrations, deployment or testing. Confirm state in Azure before continuing. Stopping makes staging unavailable; storage and excess backup storage remain billable. Azure automatically starts a stopped server after seven days and no new backups are taken while stopped. Monitor state and stop it again when appropriate. Burstable servers consume CPU credits above baseline; prolonged load can exhaust credits and degrade availability. Monitor credits, alert on low balance, and choose a larger SKU or tier if needed. See [compute guidance](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-compute-storage) and [stop and start](https://learn.microsoft.com/azure/postgresql/configure-maintain/how-to-stop-server).

## Estimated monthly costs

Illustrative USD retail rates queried from the [Microsoft retail prices API](https://prices.azure.com/api/retail/prices) for UK South on 2026-10-29; rates exclude tax, discounts and currency conversion. The exact meters are: Container Registry **Basic Registry Unit** $0.1666/day; PostgreSQL Flexible Server Burstable BS Series Compute **B1MS** $0.019/hour; Flex Server Storage **Storage Data Stored** $0.133/GB-month; Flexible Server Backup Storage **Backup Storage LRS Data Stored** $0.10/GB-month; Log Analytics **Analytics Logs Data Ingestion** $2.88/GB (also a $0 free tier meter); Key Vault **Operations** $0.03/10,000 operations. These are observed retail prices, not a quote. Adding the second vault adds no fixed vault charge under these assumptions; its assumed 10,000 operations add $0.03 per environment.

Assume 730 hours of compute, 30 registry days, 32 GB storage, backup usage no greater than the included provisioned storage, 1 GB ingested within the applicable free allowance, 20,000 vault operations (10,000 per vault), and Container Apps usage within the subscription's shared free grant. Per environment, the calculation is $13.87 compute + $5.00 registry + $4.26 storage + $0.06 vault operations (rounded components). Using unrounded components, staging is approximately **$23.18/month**, production **$23.18/month**, and both **$46.37/month**. The staging estimate assumes it runs continuously; every stopped hour saves about $0.019 in compute until automatic restart. Backup overage, extra log ingestion/retention, request or compute overages, network, taxes and other services add cost. Verify applicable allowances, actual usage and invoices: the estimate is not a spending cap. Container Apps grant assumptions are detailed in [ADR-0029](../decisions/0029-azure-container-apps-compute-platform.md).

Nothing has been deployed or previewed against the subscription yet. The owner must run both phase what-ifs and deployments, repeat the full what-if to check drift, verify RBAC propagation, image pulls, secret resolution, health probes, network access and PostgreSQL TLS, and review costs and quotas in Azure.

The UK South Azure Monitor retail API on 2026-10-29 lists **Standard Web Test Execution** at $0.000625 per execution. At one location every 15 minutes, 30 days yields 2,880 executions or **$1.80/month** before retries, taxes and ingestion. The readiness query adds one trivial PostgreSQL query per execution. Staging has no scheduled test. Both environments have a resource-group budget (30 staging, 40 production), in the scope's billing currency, which may differ from the retail price currency. Check the currency as above and adjust the parameter amounts if needed. These alert; they do not cap charges.

The probe can wake the production app. Microsoft's [scaling defaults](https://learn.microsoft.com/azure/container-apps/scale-app) state a 300-second cooldown; assuming each 15-minute ping keeps one replica for five minutes, 2,880 pings yield roughly 240 replica-hours in 30 days, already above the shared 200 replica-hour grant at 0.25 vCPU and 0.5 GiB. This is an inference, not a measurement: startup duration, stabilization, retries, user traffic and actual active versus idle billing change it. The UK South retail API lists Standard idle vCPU at $0.000004/vCPU-second and memory at $0.000004/GiB-second; 40 hours beyond the grant at those idle rates is approximately $0.43, before active usage. Worst case, a continuously warm replica uses 720 hours, or 520 hours above that grant; at idle rates this is about $5.62. Measure actual replica time and meter usage after deployment. The test, requests and application telemetry also increase workspace ingestion; beyond the allowance, the listed Analytics Logs ingestion rate is $2.88/GB. Alert and retention charges may also apply.
