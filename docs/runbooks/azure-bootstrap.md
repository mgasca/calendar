# Azure bootstrap

This walkthrough creates two isolated deployment identities and proves GitHub can obtain short-lived Azure credentials. Run in Bash from a trusted machine with GitHub CLI (`gh`), `jq`, and the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) installed. Sign in to `gh` with repository administrator access. Replace angle-bracket placeholders; do not commit your values. Run the commands in order in the same shell. Azure operations require subscription access; app registration and service principal creation also require appropriate Entra directory rights. Ask a directory administrator if these operations are forbidden. Creating role assignments requires `Microsoft.Authorization/roleAssignments/write` at each resource group.

## Sign in and select the subscription

This prevents commands from targeting the wrong tenant or subscription and sets the planned region.

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

Verify the displayed subscription and tenant are the intended ones; `az configure --list-defaults` should show `uksouth`.

## Register providers and check capacity

Registration enables the required Azure services. It may require subscription-level provider registration permission and can take time.

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

Verify each state is `Registered` (repeat the second loop until it is). A good result is a few tab-separated lines: the Consumption core quota with its used and limit values, then one line per Burstable PostgreSQL SKU (name, vCores, memory per vCore in MB, zones). If either command prints nothing, the CLI output layout may have changed: run it without the `jq` filter and check the field names. Inspect available capacity and confirm enough capacity for both environments before S5. Check the Azure portal's regional service availability and subscription quota pages too; a listed SKU does not guarantee allocation. Request quota increases through Azure support when needed.

## Create the resource groups and identities

The resource groups establish the isolation boundary. Each app registration and its service principal represent one environment; no client secret is created. App registration and service principal creation require Entra directory rights.

```bash
for env in staging production; do
  az group create --name "rg-calendar-$env" --location uksouth
  client_id=$(az ad app create --display-name "calendar-deploy-$env" --query appId -o tsv)
  az ad sp create --id "$client_id"
  printf '%s client ID: %s\n' "$env" "$client_id"
done
```

Save the printed IDs in your shell for subsequent commands (use the values just created):

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

Entra checks issuer, audience and subject exactly. Inspect the repository configuration first; immutable subjects include owner and repository IDs. If the response specifies custom claim keys or a format you cannot determine, stop and inspect an actual token's subject without printing the token. The following handles the default and immutable default formats only.

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

Verify each app has exactly one credential with its own exact subject, issuer and audience. These operations require rights to modify the app registrations. See [Azure CLI federated credentials](https://learn.microsoft.com/cli/azure/ad/app/federated-credential) and [GitHub subject formats](https://docs.github.com/en/actions/reference/security/oidc).

## Grant resource-group roles

Contributor permits deployments. The conditional Role Based Access Control Administrator grant permits creating or deleting assignments only for AcrPull and Key Vault Secrets User, needed by later infrastructure. The condition follows [Microsoft's write and delete example](https://learn.microsoft.com/azure/role-based-access-control/delegate-role-assignments-examples); it does not limit the recipient principal. Do not grant these roles at subscription scope.

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

Verify each identity has only the two intended assignments on its own group, the second includes the full condition and version `2.0`, and there are no inherited subscription grants. Role propagation may take several minutes.

## Configure GitHub environments

Both environments restrict deployments to `main`; production requires a reviewer and disallows administrator bypass. The reviewer must have repository read access. Self-review remains enabled so a single owner can approve; turn it off only after ensuring another eligible reviewer exists. These commands require repository admin rights and configure new environments; inspect existing settings first to avoid overwriting them.

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

Set environment variables (these identifiers are not secrets). The CLI creates or updates each variable.

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

Once this workflow has merged to `main`, dispatch it there. It performs a no-op what-if, not a deployment. Production must wait for its reviewer after staging succeeds.

```bash
gh workflow run azure-oidc-check.yml --repo mgasca/calendar --ref main
gh run list --repo mgasca/calendar --workflow azure-oidc-check.yml --limit 5
```

Open the run in GitHub, verify staging passed, approve the pending production job as the configured reviewer, and verify production passes. Check repository and environment secrets contain no Azure credentials. This owner-run verification is required for acceptance.

## Troubleshooting, rotation and teardown

For `AADSTS70021`, compare the exact subject, issuer and audience on the app with the issued token's claims and the current `gh api repos/mgasca/calendar/actions/oidc/customization/sub` output. Do not print or share the bearer token. Check environment spelling and immutable IDs; renames, transfers or claim customization can change the subject. Check tenant, client ID, branch policy and role propagation for other failures.

To rotate an identity, create a replacement app and service principal, federate and grant it as above, update that environment's client ID variable, run the check, then remove the old grants and registration. Never add a client secret.

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

Verify the group no longer exists, the app and service principal are gone, and the environment is absent. Deletion may take time and requires appropriate Azure and Entra rights.
