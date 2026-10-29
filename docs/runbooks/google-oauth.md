# Google OAuth for Azure

Use this runbook after the staging and production Container Apps exist. It creates one Google Cloud project with separate staging and production OAuth clients, then stores each environment's values in that environment's **app Key Vault**. Run Azure commands from the repository root with the intended subscription selected. Repeat environment-specific Azure steps for both staging and production.

## 1. Create a Google Cloud project

The project owns the shared app identity and the two separate environment clients.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select the project picker, then **New Project**. Enter a descriptive project name and choose the appropriate organization/location if offered; select **Create**.
2. Select the new project. Verify its project name and project ID in the project picker before continuing.

Google's current guide uses Google Auth Platform for sign-in configuration. Its help describes creating an application from **Google Auth Platform > Overview > Get started**. Console layouts can vary; if the labels differ, use the Google Auth Platform Overview and its Branding, Audience, Clients and Data Access pages rather than guessing a different setting.

## 2. Configure the consent and audience settings

External audience permits Google accounts outside a Workspace organization to sign in. Publishing in production removes the Testing-mode test-user limit and seven-day authorization expiry. The application's verified-email allow-list remains the actual access gate.

1. In the project, open **Google Auth Platform > Overview > Get started** (for a new application). Enter the app name, user support email and developer contact email, then save/continue through the setup. Google's current help calls these app information and contact information; exact save button labels are not confirmed here.
2. Open **Google Auth Platform > Audience**. Choose **External** for the audience/user type and save. Internal is only available to projects in a Google Workspace organization and is unsuitable for an external Google account.
3. Open **Google Auth Platform > Data Access**. Add only these OpenID Connect scopes, if not already present:
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`

   Verify the Data Access list contains only those three scopes. The API uses Google's server-side authentication-code handler and asks for the user's verified email; it does not call other Google APIs. Google classifies non-sensitive scopes as not requiring OAuth app verification. App/brand verification may still be needed to display app branding, and Google Workspace administrators or Advanced Protection can separately restrict access.

4. On **Audience**, use the publishing control to publish the app to **In production**. The current Google help says the status becomes In production after selecting **Publish app**. Verify the status reads **In production**. If the console presents additional review steps, check Google's Verification Center and current [verification requirements](https://support.google.com/cloud/answer/13464321); do not add extra scopes or submit an unnecessary verification request. Google says verification is required for sensitive or restricted scopes; these three basic sign-in scopes are non-sensitive.

Google Auth Platform help currently names the top-level areas **Branding**, **Audience**, **Clients**, **Data Access**, and **Verification Center**. Google's documentation confirms the publishing status and verification rules, but this runbook cannot exercise a live console account, so field-level labels beyond those stated are not asserted.

## 3. Read each deployed app's public FQDN

Each Google client must use that environment's actual HTTPS callback host. Get the fully qualified domain name (FQDN) from the deployed Container App:

```bash
ENV=staging
RG="rg-calendar-$ENV"
APP="ca-calendar-${ENV}"
az containerapp show --resource-group "$RG" --name "$APP" --query 'properties.configuration.ingress.fqdn' -o tsv
```

Verify the output is one hostname, with no scheme or path. Repeat with `ENV=production`. The callback URI is exactly `https://<that-fqdn>/api/auth/callback/google`.

## 4. Create the two OAuth clients

Separate clients make the production credential and callback independent from staging. This application uses ASP.NET Core's server-side Google authorization code flow; the API constructs the callback at `/api/auth/callback/google`, and the browser does not run Google's JavaScript client. Therefore no **Authorized JavaScript origins** are needed.

For each environment:

1. In Google Auth Platform, open **Clients**, choose **Create client** (the current help identifies Clients as the OAuth clients area), and choose **Web application** as the application type. The exact create button wording may vary in the live console.
2. Give the client a clear name such as `Calendar staging` or `Calendar production`.
3. In **Authorized redirect URIs**, add exactly one URI: `https://<environment-fqdn>/api/auth/callback/google`. Leave **Authorized JavaScript origins** empty. Create the client.
4. Save the displayed client ID and client secret into a secure password manager for the corresponding environment. Do not put either in the repository, a ticket, chat, a command argument or shell history. Verify the client type is Web application and it has exactly one redirect URI matching the deployed FQDN, scheme, path and case.

## 5. Store values in each environment's app vault

The owner needs **Key Vault Secrets Officer** on that environment's app vault. See [Azure infrastructure](azure-infrastructure.md#parameters-and-application-secrets) for vault roles and naming. Never pass a value with `--value`: it would be visible in command arguments/history. This pattern reads input silently, then writes exactly the bytes typed (no added newline) through stdin as a file.

First resolve the app-vault name from the environment's foundation deployment and prompt before writing each value:

```bash
ENV=staging
RG="rg-calendar-$ENV"
APP_VAULT=$(az deployment group show --resource-group "$RG" --name calendar-foundation --query properties.outputs.appKeyVaultName.value -o tsv)
read -r -s -p 'Google client ID: ' secret_value; printf '\n'
printf '%s' "$secret_value" | az keyvault secret set --vault-name "$APP_VAULT" --name google-client-id --file /dev/stdin --query name -o tsv
unset secret_value
read -r -s -p 'Google client secret: ' secret_value; printf '\n'
printf '%s' "$secret_value" | az keyvault secret set --vault-name "$APP_VAULT" --name google-client-secret --file /dev/stdin --query name -o tsv
unset secret_value
read -r -s -p 'Allowed Google email (blank to finish): ' email; printf '\n'
index=0
while [ -n "$email" ]; do
  printf '%s' "$email" | az keyvault secret set --vault-name "$APP_VAULT" --name "allowed-email-$index" --file /dev/stdin --query name -o tsv
  unset email
  index=$((index + 1))
  read -r -s -p 'Next allowed Google email (blank to finish): ' email; printf '\n'
done
unset email
```

Repeat for `ENV=production`, entering that environment's client values and allowed verified email(s). Review the allow-list carefully; the indexed names must be contiguous from zero. The `printf '%s'` is intentional: unlike `echo` or a here-string, it adds no trailing newline. Azure CLI documents `--file` as the secret source and permits `/dev/stdin` on Linux, but this exact CLI/platform combination has not been exercised against a live vault here. Before relying on the values, verify names and enabled attributes without requesting values:

```bash
for name in google-client-id google-client-secret allowed-email-0; do
  az keyvault secret show --vault-name "$APP_VAULT" --name "$name" --query '{name:name,enabled:attributes.enabled,updated:attributes.updated}' -o json
done
```

Add one show command per additional `allowed-email-N`. Verify each output has the expected name, `enabled: true`, and a recent update time. Never use `--query value` or print the secret value. To remove stale higher-numbered email entries, delete those names from the same vault and redeploy.

## 6. Deploy and verify Key Vault references

The S5 deployment tool discovers enabled app-vault secret names and supplies them to Bicep. Bicep maps the three fixed names and each `allowed-email-N` to the corresponding application configuration key. Deploy after storing values:

```bash
make infra-deploy ENV=staging PHASE=full
make infra-deploy ENV=production PHASE=full
```

Check the new revision for each Container App:

```bash
ENV=staging
RG="rg-calendar-$ENV"
APP="ca-calendar-${ENV}"
az containerapp revision list --resource-group "$RG" --name "$APP" --query '[].{name:name,active:properties.active,provisioningState:properties.provisioningState,runningState:properties.runningState}' -o json
az containerapp show --resource-group "$RG" --name "$APP" --query '{fqdn:properties.configuration.ingress.fqdn,secrets:properties.configuration.secrets[].{name:name,keyVaultUrl:keyVaultUrl},template:properties.template.containers[].env[].{name:name,secretRef:secretRef}}' -o json
```

In the CLI output, confirm the new revision is active and has no `Failed` provisioning state, and that the Google client and expected allow-list secret references resolve in the revision. Output exposes secret names and Key Vault URLs only, never values. Repeat for production. If resolution fails, inspect the Container App system identity's `Key Vault Secrets User` grant on the app vault and allow for RBAC propagation; never grant the app access to the ops vault.

ADR-0032 uses versionless Key Vault references. Container Apps checks for a new secret version within up to 30 minutes and restarts active revisions that consume it through environment variables. A restart can also be triggered by a redeployment. Check the new revision and sign-in after refresh; secret rotation may interrupt current sessions.

## 7. Sign-in deployment checklist

Perform these checks on **both staging and production** after the revision is healthy (ADR-0027):

- [ ] Sign in with an allow-listed Google account. The browser returns to the app and an authenticated API request succeeds.
- [ ] Sign in with a different, non-allow-listed Google account. It ends at `/signin?error=access_denied`.
- [ ] In the browser's authorization request, verify `redirect_uri` is the public `https://<fqdn>/api/auth/callback/google`. Google reports `redirect_uri_mismatch` if it differs from the client's registered URI.
- [ ] In browser DevTools > Network, inspect the session `Set-Cookie` response: the cookie has `Secure`, `HttpOnly`, and `SameSite=Lax`. Alternatively, inspect response headers with curl while completing an interactive login in a browser; do not put session cookies in shared logs.
- [ ] Check API responses for absence of `Access-Control-Allow-Origin` and other CORS response headers. The browser app and API are same-origin.

Record pass/fail and date for each environment. The repository agent cannot perform the owner’s live sign-in acceptance.

## Troubleshooting and routine changes

| Symptom                                            | Check                                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `redirect_uri_mismatch`                            | Compare the deployed FQDN, `https` scheme, exact callback path and the single URI on the matching environment's Web application client. Check the environment uses its own client ID.                                                                                    |
| Google says access is blocked or app is in testing | Verify Audience is External and publishing status is In production. Check the requested scopes are only `openid`, `userinfo.email`, and `userinfo.profile`; check Workspace administrator restrictions.                                                                  |
| User returns to `/signin?error=access_denied`      | Confirm the account email is verified and appears exactly in an enabled `allowed-email-N` secret in that environment. Check the indexed entries have no gaps.                                                                                                            |
| Callback fails or Google credential error          | Check that the staging/production client ID and matching secret are stored in the same environment's app vault and referenced by its active revision. Check the secret is enabled and allow up to 30 minutes for a version refresh; redeploy to force a revision update. |
| New revision reports failed secret resolution      | Check the app identity's Key Vault Secrets User role on the app vault, enabled secret names, and RBAC propagation. Re-run `make infra-deploy ENV=<env> PHASE=full` after correcting the cause.                                                                           |

### Rotate a Google client secret

In Google Auth Platform > Clients, open the relevant environment's client and create/rotate its client secret using the console's offered controls. Store the new value using the silent prompt and `--file /dev/stdin` method above, updating `google-client-secret` in that environment's app vault. Deploy with `make infra-deploy ENV=<env> PHASE=full`, then verify the active revision and allowed-account sign-in. A versionless Key Vault reference can take up to 30 minutes to refresh and restart the revision. For the quick path, after updating the vault, redeploy to create a revision immediately. If Google allows overlapping credentials, keep the previous one until sign-in succeeds, then revoke it; confirm the live console's rotation behavior before removing an old secret.

### Remove an allowed user

Identify the exact `allowed-email-N` entry in the environment's app vault, then delete that secret (without showing its value):

```bash
az keyvault secret delete --vault-name "$APP_VAULT" --name allowed-email-1 --query name -o tsv
```

If a later index remains, either delete and rewrite the later entries with contiguous indices (values must be re-entered securely), or keep the gap and verify binding behavior before relying on it. Prefer reindexing contiguously. Re-run `make infra-deploy ENV=<env> PHASE=full`; verify the new revision no longer references the removed account and that the removed account is denied. Existing issued sessions may remain valid until they expire; sign the user out/revoke sessions as required by the incident.

## References

- [ADR-0027: Google OIDC with a backend-for-frontend cookie session](../decisions/0027-google-oidc-bff-session.md)
- [ADR-0032: Azure Key Vault for secrets via managed identity](../decisions/0032-azure-key-vault-secrets.md)
- [Azure infrastructure](azure-infrastructure.md)
- [Google Auth Platform overview](https://support.google.com/cloud/answer/15544987)
- [Manage app audience and publishing status](https://support.google.com/cloud/answer/15549945)
- [OAuth app verification requirements](https://support.google.com/cloud/answer/13464321)
- [Azure CLI Key Vault secret commands](https://learn.microsoft.com/en-us/cli/azure/keyvault/secret)
