# Azure bootstrap

This walkthrough prepares Azure and GitHub for Calendar deployments. It creates separate deployment identities for staging (the test environment) and production (the live environment), then checks that GitHub can obtain short-lived Azure credentials. It does not deploy the application. The design is recorded in [ADR-0034](../decisions/0034-github-actions-oidc-deployment.md); continue with [Azure infrastructure](azure-infrastructure.md) after this check succeeds.

Azure is Microsoft's cloud platform. A subscription groups Azure resources and billing; a tenant is the Microsoft Entra directory that contains identities. A resource group is a named container for resources and a scope at which permissions can be granted. GitHub Actions runs repository workflows (automated jobs); a GitHub environment is a named deployment target with its own variables and protection rules.

## Prerequisites

Run this walkthrough once for the intended subscription, using the repository `mgasca/calendar`. You need:

- A trusted machine with Bash, GitHub CLI (`gh`), `jq` (a JSON processor), and the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`) installed. The commands use JSON, a structured text format, and shell variables to carry IDs between steps.
- A GitHub login with repository administrator access, and a reviewer with repository read access for the production gate.
- Azure subscription access, permission to register resource providers at subscription scope, Microsoft Entra directory rights to create and modify app registrations and service principals, and `Microsoft.Authorization/roleAssignments/write` on each resource group. Ask a directory administrator if the identity operations are forbidden.
- The subscription ID and intended tenant, and a supported subscription with sufficient UK South capacity. The workflow check must be merged to `main` before the final verification.

Replace each angle-bracket placeholder with the actual value, without the brackets. Keep IDs available for later steps but do not commit your values. Run the blocks in order in the same Bash shell: assignments such as `TENANT_ID=...` last only for that shell. If a command fails, stop, understand the error and inspect any resources already created before retrying.

This walkthrough creates two isolated deployment identities and proves GitHub can obtain short-lived Azure credentials.

## Sign in and select the subscription

Sign in interactively when prompted. `az version` displays the Azure CLI version; `gh auth status` confirms the GitHub account and authentication. If GitHub is not signed in, run `gh auth login` first. Set the subscription ID to the intended subscription; `az account set` selects it, and the default location sets UK South (`uksouth`) for later Azure CLI commands. This prevents commands from targeting the wrong tenant or subscription.

```bash
az version
gh auth status
az login
SUBSCRIPTION_ID='<subscription-id>'
az account set --subscription "$SUBSCRIPTION_ID"
az configure --defaults location=uksouth
az account show --query '{subscription:id,tenant:tenantId,name:name}' -o json
TENANT_ID=$(az account show --query tenantId -o tsv)
```

Verify the displayed subscription ID, tenant ID and name are the intended ones before continuing. Run `az configure --list-defaults` and confirm it shows `uksouth`. The last command stores the tenant ID in `TENANT_ID`; it normally prints nothing.

## Register providers and check capacity

A resource provider exposes an Azure service to the subscription. Registration enables the services needed by later infrastructure and can take time. A quota is the subscription limit for a resource; a SKU is a service size or configuration. The two capacity queries list Container Apps Consumption cores and PostgreSQL Burstable sizes available in UK South. The queries inspect availability; they do not reserve capacity.

```bash
for provider in Microsoft.App Microsoft.ContainerRegistry Microsoft.DBforPostgreSQL Microsoft.KeyVault Microsoft.OperationalInsights Microsoft.Insights; do
  az provider register --namespace "$provider"
done
for provider in Microsoft.App Microsoft.ContainerRegistry Microsoft.DBforPostgreSQL Microsoft.KeyVault Microsoft.OperationalInsights Microsoft.Insights; do
  az provider show --namespace "$provider" --query '{provider:namespace,state:registrationState}' -o json
done
az containerapp list-usages --location uksouth -o json \
  | jq -r '(if type == "object" then .value else . end)[] | select(.name.localizedValue | test("Consumption")) | [.name.localizedValue, .currentValue, .limit] | @tsv'
az postgres flexible-server list-skus --location uksouth -o json \
  | jq -r '(if type == "object" then .value else . end)[] | (.supportedServerEditions // .supportedFlexibleServerEditions // [])[] | select(.name == "Burstable") | .supportedServerSkus[] | [.name, .vCores, .supportedMemoryPerVcoreMb, ((.supportedZones // []) | join(","))] | @tsv'
```

Verify each state is `Registered` (repeat the second loop until it is). A good result is a few tab-separated lines: the Consumption core quota with its used and limit values, then one line per Burstable PostgreSQL SKU (name, vCores, memory per vCore in MB, zones). If either command prints nothing, the CLI output layout may have changed: run it without the `jq` filter and check the field names. Inspect available capacity and confirm enough capacity for both environments before the infrastructure deployment described in [Azure infrastructure](azure-infrastructure.md). Check the Azure portal's regional service availability and subscription quota pages too; a listed SKU does not guarantee allocation. Request quota increases through Azure support when needed.

## Create the resource groups and identities

The two resource groups establish the Azure isolation boundary. An Entra app registration describes an application identity; its service principal is the instance of that identity in the tenant to which Azure permissions are assigned. Each pair represents one environment. The client ID (`appId`) identifies the app; it is different from the service principal object ID used for role assignments. No client secret (a stored password for the identity) is created. The loop prints one client ID per environment as well as Azure responses.

```bash
for env in staging production; do
  az group create --name "rg-calendar-$env" --location uksouth
  client_id=$(az ad app create --display-name "calendar-deploy-$env" --query appId -o tsv)
  az ad sp create --id "$client_id"
  printf '%s client ID: %s\n' "$env" "$client_id"
done
```

Copy the two printed client IDs into the corresponding assignments below, replacing the placeholders. Keep them in the same shell for subsequent commands. The queries then display the groups, app registrations and service principals:

```bash
STAGING_CLIENT_ID='<staging-client-id>'
PRODUCTION_CLIENT_ID='<production-client-id>'
az group show --name rg-calendar-staging --query '{name:name,location:location}'
az group show --name rg-calendar-production --query '{name:name,location:location}'
az ad app show --id "$STAGING_CLIENT_ID" --query '{appId:appId,credentials:passwordCredentials}'
az ad app show --id "$PRODUCTION_CLIENT_ID" --query '{appId:appId,credentials:passwordCredentials}'
az ad sp show --id "$STAGING_CLIENT_ID" --query '{appId:appId,id:id}'
az ad sp show --id "$PRODUCTION_CLIENT_ID" --query '{appId:appId,id:id}'
```

Verify both groups are in UK South, IDs differ, both service principals exist, and password credentials are empty. If a partial run fails, inspect existing registrations before retrying to avoid duplicates.

## Federate GitHub environments

OpenID Connect (OIDC) is a protocol GitHub Actions uses to issue an identity token for a job. Workload identity federation lets Entra exchange a matching GitHub token for short-lived Azure access without a client secret. A federated credential is the trust rule on an app registration: its issuer identifies GitHub as token issuer, its audience identifies the intended token exchange, and its subject identifies the repository and GitHub environment. Entra checks all three exactly.

Inspect the repository OIDC configuration printed by the first command; immutable subjects include owner and repository IDs. `PREFIX` is the subject prefix used to build each environment-specific subject. If the response specifies custom claim keys or a format you cannot determine, stop and inspect an actual token's subject without printing the token. The following handles the default and immutable default formats only.

```bash
gh api repos/mgasca/calendar/actions/oidc/customization/sub
PREFIX=$(gh api repos/mgasca/calendar/actions/oidc/customization/sub --jq 'if .use_default == true and .use_immutable_subject == true then .sub_claim_prefix elif .use_default == true and .use_immutable_subject != true then "repo:mgasca/calendar" else empty end')
test -n "$PREFIX" || { echo 'Custom subject: determine the exact issued subject before continuing'; return 1 2>/dev/null || exit 1; }
for env in staging production; do
  if [ "$env" = staging ]; then client_id=$STAGING_CLIENT_ID; else client_id=$PRODUCTION_CLIENT_ID; fi
  jq -n --arg name "github-$env" --arg subject "$PREFIX:environment:$env" \
    '{name:$name,issuer:"https://token.actions.githubusercontent.com",subject:$subject,audiences:["api://AzureADTokenExchange"]}' > /tmp/calendar-federated-credential.json
  az ad app federated-credential create --id "$client_id" --parameters /tmp/calendar-federated-credential.json
  az ad app federated-credential list --id "$client_id" -o json
done
rm /tmp/calendar-federated-credential.json
```

The list output for each app should contain exactly one credential. Verify its subject ends in the matching `:environment:staging` or `:environment:production`, and its full subject, issuer and audience match the issued token and the values in the command. The temporary JSON file is removed after both credentials are created. These operations require rights to modify the app registrations. See [Azure CLI federated credentials](https://learn.microsoft.com/cli/azure/ad/app/federated-credential) and [GitHub subject formats](https://docs.github.com/en/actions/reference/security/oidc).

## Grant resource-group roles

Azure role-based access control (RBAC) assigns roles to a principal at a scope. Contributor permits deployments within the resource group. The conditional Role Based Access Control Administrator grant permits creating or deleting assignments only for AcrPull and Key Vault Secrets User, needed by later infrastructure. The condition follows [Microsoft's write and delete example](https://learn.microsoft.com/azure/role-based-access-control/delegate-role-assignments-examples); it does not limit the recipient principal. Do not grant these roles at subscription scope.

```bash
CONDITION="((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {7f951dda-4ed3-4680-a7ca-43fe172d538d, 4633458b-17de-408a-b874-0445c86b69e6})) AND ((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {7f951dda-4ed3-4680-a7ca-43fe172d538d, 4633458b-17de-408a-b874-0445c86b69e6}))"
for env in staging production; do
  if [ "$env" = staging ]; then client_id=$STAGING_CLIENT_ID; else client_id=$PRODUCTION_CLIENT_ID; fi
  principal_id=$(az ad sp show --id "$client_id" --query id -o tsv)
  scope=$(az group show --name "rg-calendar-$env" --query id -o tsv)
  az role assignment create --assignee-object-id "$principal_id" --assignee-principal-type ServicePrincipal --role Contributor --scope "$scope"
  az role assignment create --assignee-object-id "$principal_id" --assignee-principal-type ServicePrincipal --role 'Role Based Access Control Administrator' --scope "$scope" --condition "$CONDITION" --condition-version 2.0
  az role assignment list --assignee "$principal_id" --all --include-inherited -o json
done
```

The command prints assignments for each service principal, including inherited grants. Verify each identity has only the two intended assignments on its own group, the second includes the full condition and version `2.0`, and there are no inherited subscription grants. Role propagation may take several minutes.

## Configure GitHub environments

GitHub environment branch policies restrict which branches can deploy; they are separate from the OIDC subject, which names the environment but does not include the branch. Both environments restrict deployments to `main`; production requires a reviewer and disallows administrator bypass. The reviewer must have repository read access. Self-review remains enabled so a single owner can approve; turn it off only after ensuring another eligible reviewer exists. These commands require repository admin rights and configure new environments; inspect existing settings first to avoid overwriting them.

```bash
REVIEWER_ID='<github-user-numeric-id>'
gh api repos/mgasca/calendar/environments
# Obtain the reviewer ID with: gh api users/<github-username> --jq .id
gh api -X PUT repos/mgasca/calendar/environments/staging --input - <<'JSON'
{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
jq -n --argjson reviewer "$REVIEWER_ID" '{deployment_branch_policy:{protected_branches:false,custom_branch_policies:true},reviewers:[{type:"User",id:$reviewer}],prevent_self_review:false,can_admins_bypass:false}' | gh api -X PUT repos/mgasca/calendar/environments/production --input -
for env in staging production; do
  gh api -X POST "repos/mgasca/calendar/environments/$env/deployment-branch-policies" -f name=main -f type=branch
  gh api "repos/mgasca/calendar/environments/$env"
  gh api "repos/mgasca/calendar/environments/$env/deployment-branch-policies"
done
```

Verify exactly one branch policy, `main`, on each environment; production has the intended reviewer, `prevent_self_review: false`, and `can_admins_bypass: false`. Remove any pre-existing extra policies explicitly. See [environment API](https://docs.github.com/en/rest/deployments/environments) and [branch policy API](https://docs.github.com/en/rest/deployments/branch-policies).

Set GitHub environment variables so each job knows which Azure identity, tenant, subscription and resource group to use. These identifiers are not secrets. The CLI creates or updates each variable, then lists the variables for inspection.

```bash
for env in staging production; do
  if [ "$env" = staging ]; then client_id=$STAGING_CLIENT_ID; else client_id=$PRODUCTION_CLIENT_ID; fi
  gh variable set AZURE_CLIENT_ID --repo mgasca/calendar --env "$env" --body "$client_id"
  gh variable set AZURE_TENANT_ID --repo mgasca/calendar --env "$env" --body "$TENANT_ID"
  gh variable set AZURE_SUBSCRIPTION_ID --repo mgasca/calendar --env "$env" --body "$SUBSCRIPTION_ID"
  gh variable set AZURE_RESOURCE_GROUP --repo mgasca/calendar --env "$env" --body "rg-calendar-$env"
  gh variable list --repo mgasca/calendar --env "$env"
done
```

Verify all four values in each environment match the intended IDs and group. They are environment variables, not GitHub secrets.

## Verify the workflow

Once `.github/workflows/azure-oidc-check.yml` has merged to `main`, dispatch (start) it there. The workflow checks Azure login and runs a no-op what-if: an Azure Resource Manager preview of changes, not a deployment. Production must wait for its reviewer after staging succeeds. The first command starts the workflow; the second lists recent runs so you can find it.

```bash
gh workflow run azure-oidc-check.yml --repo mgasca/calendar --ref main
gh run list --repo mgasca/calendar --workflow azure-oidc-check.yml --limit 5
```

In GitHub, open the repository’s **Actions** tab and select the new run. Verify staging passed, approve the pending production job as the configured reviewer, and verify production passes. A failed job or a production job that never waits for approval needs investigation before proceeding. Check repository and environment secrets contain no Azure credentials. This owner-run verification is required for acceptance.

## Troubleshooting, rotation and teardown

For `AADSTS70021`, compare the exact subject, issuer and audience on the app with the issued token's claims and the current `gh api repos/mgasca/calendar/actions/oidc/customization/sub` output. Do not print or share the bearer token. Check environment spelling and immutable IDs; renames, transfers or claim customization can change the subject. Check tenant, client ID, branch policy and role propagation for other failures.

Rotation replaces an identity while preserving the environment’s ability to deploy. To rotate an identity, create a replacement app and service principal, federate and grant it as above, update that environment's client ID variable, run the check, then remove the old grants and registration. Never add a client secret.

To tear down, first confirm the resources and data can be deleted. Deleting a group deletes all its resources. After removing workloads, remove role assignments and app registrations using their saved IDs; remove the GitHub environments only when no workflows depend on them:

```bash
# Repeat for each environment after confirming deletion is intended:
env=staging
client_id=$STAGING_CLIENT_ID
principal_id=$(az ad sp show --id "$client_id" --query id -o tsv)
scope=$(az group show --name "rg-calendar-$env" --query id -o tsv)
az role assignment delete --assignee-object-id "$principal_id" --scope "$scope"
az group delete --name "rg-calendar-$env" --yes
az ad app delete --id "$client_id"
gh api -X DELETE "repos/mgasca/calendar/environments/$env"
az group exists --name "rg-calendar-$env"
```

The example selects staging; for production, set `env=production` and `client_id=$PRODUCTION_CLIENT_ID` before running the remaining commands. `az group exists` should eventually print `false`. Verify the app and service principal are gone with `az ad app show --id "$client_id"` and `az ad sp show --id "$client_id"` (both should report that they cannot find the object), and verify the environment is absent with `gh api repos/mgasca/calendar/environments`. Deletion may take time and requires appropriate Azure and Entra rights.
