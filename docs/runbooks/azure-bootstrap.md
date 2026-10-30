# Azure bootstrap

This runbook prepares Azure and GitHub for deployments. It creates one deployment identity each for staging and production, and proves that GitHub can get short-lived Azure credentials without a stored password. It does not deploy the app. The design is in [ADR-0034](../decisions/0034-github-actions-oidc-deployment.md). When you finish, continue with [Azure infrastructure](azure-infrastructure.md).

## Terms

- **Tenant**: a Microsoft Entra directory, which holds identities. **Subscription**: the Azure account that holds resources and billing.
- **Resource group**: a named container for resources. Permissions granted on it apply only to its resources.
- **App registration**: an application identity in Entra. Its **service principal** is the entry in the tenant that receives Azure permissions. The **client ID** (`appId`) names the app; the service principal's **object ID** is what role assignments use.
- **Federated credential**: a trust rule on an app registration. It lets Entra exchange a GitHub Actions token (OIDC) for short-lived Azure access. Entra checks three values exactly: the **issuer** (GitHub), the **audience** (the Azure token exchange) and the **subject** (this repository and one GitHub environment).
- **GitHub environment**: a named deployment target (`staging`, `production`) with its own variables and protection rules.

## Before you start

- Use a trusted machine with Bash, GitHub CLI (`gh`), `jq` and the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`).
- Sign in to `gh` with repository administrator access. If `gh auth status` shows you are not signed in, run `gh auth login`.
- In Azure you need access to the subscription and permission to register resource providers on it.
- In Entra you need rights to create and change app registrations and service principals. If Entra forbids this, ask a directory administrator.
- You need `Microsoft.Authorization/roleAssignments/write` on each resource group.
- Choose the production reviewer: a GitHub user with read access to the repository.
- Run every block in order, in **one Bash shell**. Later blocks use variables set by earlier ones, such as `TENANT_ID`.
- Replace each `<placeholder>`, without the angle brackets. Do not commit your values.
- If a command fails, stop. Read the error and check what was already created before you retry.

## 1. Sign in and select the subscription

This makes sure every later command targets the right tenant and subscription, in UK South.

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

Check that the subscription and tenant shown are the intended ones. Then run `az configure --list-defaults` and check that it shows `uksouth`.

## 2. Register providers and check capacity

A resource provider makes an Azure service available to the subscription. Registration can take a few minutes. The last two commands show the Container Apps core quota and the Burstable PostgreSQL sizes in UK South. They only report capacity; they do not reserve it.

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

Expect:

- Every provider state is `Registered`. If not, wait and run the second loop again.
- A line with the Consumption core quota: name, used, limit.
- One line per Burstable PostgreSQL size: name, vCores, memory per vCore in MB, zones.

If a capacity command prints nothing, the CLI output format may have changed: run it without the `jq` part and compare the field names.

Make sure there is enough capacity for both environments before you deploy the infrastructure. Also check regional availability and quotas in the Azure portal; a listed size does not guarantee that Azure can allocate it. To raise a quota, ask Azure support.

## 3. Create the resource groups and identities

Each environment gets its own resource group, app registration and service principal. This keeps staging and production apart. No client secret (stored password) is created.

```bash
for env in staging production; do
  az group create --name "rg-calendar-$env" --location uksouth
  client_id=$(az ad app create --display-name "calendar-deploy-$env" --query appId -o tsv)
  az ad sp create --id "$client_id"
  printf '%s client ID: %s\n' "$env" "$client_id"
done
```

Copy the two printed client IDs into this block, then run it:

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

Expect both groups in `uksouth`, two different client IDs, two service principals, and `credentials` empty (`[]`) on both apps. Keep the client IDs: later runbooks and teardown need them. If an earlier run failed partway, check for existing `calendar-deploy-*` registrations before you retry, to avoid duplicates.

## 4. Federate the GitHub environments

This adds one federated credential per app, so only jobs in the matching GitHub environment can sign in as it.

The subject format depends on the repository's OIDC settings. The first command prints them. The block supports the default format and the immutable default format (which includes the owner and repository IDs). If the settings use custom claim keys or a format you cannot work out, the block stops: inspect the subject of a real token, without printing the token itself.

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

Expect exactly one credential per app. Its subject ends in `:environment:staging` or `:environment:production` to match the app, and its issuer and audience match the block. See [Azure CLI federated credentials](https://learn.microsoft.com/cli/azure/ad/app/federated-credential) and [GitHub subject formats](https://docs.github.com/en/actions/reference/security/oidc).

## 5. Grant the resource-group roles

Each identity gets two roles, on its own resource group only. Never grant them on the subscription.

- **Contributor** lets it deploy resources.
- **Role Based Access Control Administrator**, with a condition, lets it create and delete role assignments only for **AcrPull** and **Key Vault Secrets User**, which the infrastructure needs. The condition limits the roles, not who receives them. It follows [Microsoft's write and delete example](https://learn.microsoft.com/azure/role-based-access-control/delegate-role-assignments-examples).

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

Expect, for each identity, exactly these two assignments on its own group, the second with the full condition and `conditionVersion` `2.0`, and nothing inherited from the subscription. New roles can take several minutes to take effect.

## 6. Configure the GitHub environments

Both environments allow deployments only from `main`. Production also needs approval from the reviewer, and administrators cannot bypass it. Self-review stays allowed, so a single owner can approve; turn it off only when another eligible reviewer exists.

The branch rule is separate from the federated credential: the token subject names the environment, not the branch.

These commands overwrite environment settings. The first `gh api` command lists the existing environments; check them before you continue. To find the reviewer's numeric ID, run `gh api users/<github-username> --jq .id`.

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

Expect exactly one branch policy, `main`, on each environment. Production must show the reviewer, `prevent_self_review: false` and `can_admins_bypass: false`. Delete any other branch policies that were already there. See the [environment API](https://docs.github.com/en/rest/deployments/environments) and the [branch policy API](https://docs.github.com/en/rest/deployments/branch-policies).

Next, set the environment variables that tell each job which identity, tenant, subscription and resource group to use. These IDs are not secrets, so they are variables, not GitHub secrets. `gh variable set` creates or updates each one.

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

Expect four variables per environment, with that environment's client ID and resource group.

## 7. Test the sign-in from GitHub

The `azure-oidc-check.yml` workflow signs in to Azure from each environment and runs a no-op what-if (a preview of changes). It does not deploy anything. Start it from `main` and find the run:

```bash
gh workflow run azure-oidc-check.yml --repo mgasca/calendar --ref main
gh run list --repo mgasca/calendar --workflow azure-oidc-check.yml --limit 5
```

1. In GitHub, open **Actions** and select the new run.
2. Check that the staging job passes.
3. The production job waits for approval. As the reviewer, approve it.
4. Check that the production job passes.
5. Check that the repository and environment **secrets** hold no Azure credentials.

If a job fails, or the production job runs without waiting for approval, stop and investigate; see [Troubleshooting](#troubleshooting). The owner must complete this test for the bootstrap to be accepted.

## Troubleshooting

**`AADSTS70021` (no matching federated credential):** compare the subject, issuer and audience on the app with the claims in the issued token, and with the current output of `gh api repos/mgasca/calendar/actions/oidc/customization/sub`. Never print or share the token itself. Check the environment name's spelling. Renaming or transferring the repository, or changing its claim settings, can change the subject.

**Other sign-in failures:** check the tenant, the client ID variable, the branch policy and whether the roles have finished propagating.

## Rotate an identity

1. Create a replacement app registration and service principal (step 3).
2. Federate it (step 4) and grant its roles (step 5).
3. Update that environment's `AZURE_CLIENT_ID` variable (step 6).
4. Run the test (step 7).
5. Remove the old identity's role assignments and app registration.

Never add a client secret.

## Tear down

**Deleting a resource group deletes every resource and all data in it.** First make sure that this is intended. Remove the workloads first, and remove a GitHub environment only when no workflow depends on it.

The block below tears down staging. For production, set `env=production` and `client_id=$PRODUCTION_CLIENT_ID` instead.

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

Deletion can take a while. Expect:

- `az group exists` prints `false`.
- `az ad app show --id "$client_id"` and `az ad sp show --id "$client_id"` both report that the object does not exist. Deleting the app also deletes its service principal.
- `gh api repos/mgasca/calendar/environments` no longer lists the environment.
