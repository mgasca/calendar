# Azure bootstrap

This procedure creates separate deployment identities for staging and production. A deployment identity gives a workflow access to Azure. It also tests short-lived Azure credentials from GitHub.

Use a trusted machine with Bash, GitHub CLI (`gh`), `jq`, and the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli). Sign in to `gh` with repository administrator access. Replace each angle-bracket placeholder with your value. Do not commit those values. Run the commands in order in the same shell.

You need subscription access and Entra directory rights to create app registrations and service principals. An app registration identifies an application in Entra. A service principal gives that application access to Azure resources. If Entra forbids these operations, ask a directory administrator. You also need `Microsoft.Authorization/roleAssignments/write` on each resource group. A resource group holds Azure resources.

## Sign in and select the subscription

Run these commands on the trusted machine:

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

Make sure that the displayed subscription and tenant are the intended ones. A tenant is an Entra directory. Run `az configure --list-defaults`. Make sure that the output shows `uksouth`.

## Register providers and check capacity

A provider enables an Azure service for a subscription. Provider registration can require subscription-level permission and can take time. Run these commands in the same shell:

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

Make sure that every state is `Registered`. If a state is not `Registered`, repeat the second loop.

The first capacity command lists Consumption core quota, usage, and limit. A quota is a subscription limit. The second lists Burstable PostgreSQL SKUs, vCores, memory per vCore in MB, and zones. An SKU is a product size. If either command prints nothing, run it without the `jq` filter. Make sure that its field names match the filter.

Before S5, make sure that both environments have enough capacity. Also inspect regional service availability and subscription quotas in the Azure portal. A listed SKU does not guarantee allocation. If you need a higher quota, request it through Azure support.

## Create resource groups and identities

Each environment gets a resource group, an app registration, and a service principal. The commands create no client secret. Run these commands in the same shell:

```bash
for env in staging production; do
  az group create --name "rg-calendar-$env" --location uksouth
  client_id=$(az ad app create --display-name "calendar-deploy-$env" --query appId -o tsv)
  az ad sp create --id "$client_id"
  printf '%s client ID: %s\n' "$env" "$client_id"
done
```

Copy the printed client IDs into the following placeholders. A client ID identifies an app registration. Run these commands in the same shell:

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

Make sure that both groups are in UK South and that the IDs differ. Make sure that both service principals exist and that both password credential lists are empty. If a partial run fails, inspect existing registrations before you retry. This prevents duplicate registrations.

## Federate GitHub environments

Federation lets GitHub exchange a token for Azure access. A token is a signed proof of identity. Entra matches the issuer, audience, and subject exactly. The issuer identifies the token provider. The audience identifies the intended recipient. The subject identifies the repository and environment. Immutable subjects include owner and repository IDs.

Inspect the repository configuration with the first command. If it uses custom claim keys or an unknown format, stop. Inspect an actual token subject without printing the token. The commands support only the default and immutable default formats. Run them in the same shell:

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

Make sure that each app has exactly one credential. A credential is a record that permits authentication. Make sure that each credential has its own exact subject, issuer, and audience. You need rights to modify the app registrations. See [Azure CLI federated credentials](https://learn.microsoft.com/cli/azure/ad/app/federated-credential) and [GitHub subject formats](https://docs.github.com/en/actions/reference/security/oidc).

## Grant resource-group roles

A role grants permissions. Contributor permits deployments. Role Based Access Control Administrator permits role assignments. Its condition limits creation and deletion to AcrPull and Key Vault Secrets User assignments. Later infrastructure needs these assignments. The condition does not limit the recipient principal. A principal is an identity that can receive permissions. The condition follows [Microsoft's write and delete example](https://learn.microsoft.com/azure/role-based-access-control/delegate-role-assignments-examples).

Do not grant these roles at subscription scope. Run these commands in the same shell:

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

Make sure that each identity has only the two intended assignments on its own group. Make sure that the second assignment has the full condition and version `2.0`. Make sure that neither identity inherits subscription grants. Role propagation can take several minutes.

## Configure GitHub environments

A GitHub environment controls access to a deployment target. Both environments restrict deployments to `main`. Production requires a reviewer and disallows administrator bypass. The reviewer must have repository read access. Self-review stays enabled so that a single owner can approve. If another eligible reviewer exists, you can turn self-review off.

These commands require repository administrator rights. Inspect existing environments before you run them. The commands configure new environments and can overwrite existing configuration. Set `REVIEWER_ID` to the numeric GitHub user ID. Run these commands in the same shell:

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

Make sure that each environment has exactly one branch policy, `main`. Make sure that production has the intended reviewer, `prevent_self_review: false`, and `can_admins_bypass: false`. If extra policies exist, remove them explicitly. See the [environment API](https://docs.github.com/en/rest/deployments/environments) and [branch policy API](https://docs.github.com/en/rest/deployments/branch-policies).

An environment variable stores a value for a GitHub environment. These identifiers are not secrets. The CLI creates or updates each variable. Run these commands in the same shell:

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

Make sure that all four values in each environment match the intended IDs and group. Store them as environment variables, not GitHub secrets.

## Test the workflow

A workflow is a GitHub Actions job sequence. After `azure-oidc-check.yml` merges to `main`, run these commands in the same shell. The workflow runs a no-op what-if and does not deploy. A what-if previews Azure changes. Production waits for its reviewer after staging succeeds.

```bash
gh workflow run azure-oidc-check.yml --repo mgasca/calendar --ref main
gh run list --repo mgasca/calendar --workflow azure-oidc-check.yml --limit 5
```

Open the run in GitHub. Make sure that staging passed. As the configured reviewer, approve the pending production job. Make sure that production passes. Make sure that repository and environment secrets contain no Azure credentials. The owner must complete this test for acceptance.

## Troubleshooting, rotation and teardown

If `AADSTS70021` occurs, compare the app's subject, issuer, and audience with the issued token's claims. A claim is a value in a token. Compare them with `gh api repos/mgasca/calendar/actions/oidc/customization/sub` too. Do not print or share the bearer token. A bearer token grants access to its holder. Make sure that environment spelling and immutable IDs match. Renames, transfers, or claim customization can change the subject. For other failures, inspect the tenant, client ID, branch policy, and role propagation.

To rotate an identity, create a replacement app and service principal. Follow the federation and role steps above. Update that environment's client ID variable. Run the workflow test. Remove the old grants and registration. Never add a client secret.

To tear down, first make sure that you can delete the resources and data. Deleting a group deletes all its resources. Remove workloads before the commands below. Remove GitHub environments only when no workflows depend on them. Repeat the commands for each environment with its saved client ID:

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

Make sure that the group no longer exists. Make sure that the app, service principal, and GitHub environment are absent. Deletion can take time and requires Azure and Entra rights.
