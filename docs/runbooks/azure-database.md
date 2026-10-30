# Azure PostgreSQL operations

Perform these steps separately for staging and production, using the correct Azure subscription and environment. Production migrations require the protected GitHub environment approval.

## First-time setup

1. Complete the foundation and full infrastructure deployments in [Azure infrastructure](azure-infrastructure.md). Then make sure the **operator**, meaning your own signed-in Azure user (not the deployment identity), has **Key Vault Secrets Officer** on both vaults of the environment. That role lets you write the database passwords and the app connection string. If you followed step 3 of the infrastructure runbook you already granted it: run the check below, and only run the grant if the check shows nothing.

   ```bash
   # Which environment you are setting up: staging or production.
   ENV=staging
   # The resource group created for that environment.
   RG="rg-calendar-$ENV"
   # The two vault names were recorded as outputs of the foundation deployment.
   app_vault=$(az deployment group show -g "$RG" -n calendar-foundation --query properties.outputs.appKeyVaultName.value -o tsv)
   ops_vault=$(az deployment group show -g "$RG" -n calendar-foundation --query properties.outputs.opsKeyVaultName.value -o tsv)
   # The object ID of the user you are signed in as with `az login`.
   owner_id=$(az ad signed-in-user show --query id -o tsv)

   for vault in "$app_vault" "$ops_vault"; do
     # The full Azure resource ID of this vault, which is the scope the role applies to.
     vault_id=$(az keyvault show -g "$RG" -n "$vault" --query id -o tsv)
     # CHECK: list your Key Vault Secrets Officer assignment on this vault. Empty output [] means you do not have it yet.
     az role assignment list --assignee "$owner_id" --scope "$vault_id" --query "[?roleDefinitionName=='Key Vault Secrets Officer'].{role:roleDefinitionName,scope:scope}" -o json
     # GRANT: only if the list above was empty. This needs permission to assign roles on the vault (Owner or User Access Administrator).
     # az role assignment create --assignee-object-id "$owner_id" --assignee-principal-type User --role 'Key Vault Secrets Officer' --scope "$vault_id"
   done
   ```

   Each vault should list one assignment. A new assignment can take up to about 10 minutes to take effect, so if the next step fails with a permission error, wait and retry. Repeat the whole step for production with `ENV=production`.

2. Run `make infra-init-roles ENV=staging ARGS="--client-ip <public-ipv4>"` from the operator's machine. The command temporarily permits that address through the PostgreSQL firewall. Use the public egress address actually used to reach Azure. If `--client-ip` is omitted, the tool asks `https://api.ipify.org` for the public IPv4 address; use the override when that service is unavailable or its route differs from the database route.
3. Dispatch the migration workflow from `main` for staging. Confirm it succeeds before proceeding.
4. Deploy the app with its app-vault connection string and check that it connects as `calendar_app`. With a connection as that role, attempt `CREATE TABLE public.permission_probe (id integer)` and confirm PostgreSQL denies permission. If it unexpectedly succeeds, remove the probe using an administrator and investigate the grants before allowing traffic.
5. Repeat for production, recording the migration restore point and obtaining the required environment approval.

## Initialization recovery

Initialization preserves database CONNECT for the executing administrator after revoking the public database grant, so the owner can reconnect on a rerun. The ops vault is the source of truth for `calendar-migrator-password` and `calendar-app-password`. For each role, initialization stores a new password before creating a missing role. If a secret exists but the role does not, it creates the role with that secret. If both exist, it checks that the credential authenticates before reapplying grants. If a role exists without a secret, or the existing credential cannot authenticate, initialization stops; it never changes a role password automatically. The app vault's `calendar-connection-string` is derived from the app password and server FQDN. An existing different value stops initialization rather than being overwritten.

If the vault and PostgreSQL disagree, stop deployments and coordinate recovery with the owner. The owner can choose a new password, change the role with `ALTER ROLE ... PASSWORD` over a protected administrative connection, and store that exact password in the corresponding ops-vault secret using a protected secret-input method. For `calendar_app`, also update the app-vault connection string to match. Alternatively, if the role owns no objects and has no dependencies, the owner can remove it and rerun initialization with its existing secret. Check ownership and dependencies before dropping a role. Do not put passwords in shell history, process arguments, logs, or issue comments. Rerun initialization to verify authentication and grants.

## Password rotation

Schedule a maintenance window and stop migrations and application traffic as appropriate. Generate the replacement secret securely, update the role through a protected administrator connection, then update its ops-vault secret. For the app role, update the app-vault connection string to the same password and refresh or redeploy the app so its connection pools and secret reference use the new value. For the migrator, ensure no migration is running before changing its password and vault secret. The database and vault updates are not atomic: during the interval between them connections can fail. Verify role authentication and the app or migration workflow after the change. Never expose the password in command arguments or logs.

## Migration failure and rollback

Migrations are forward-only; use expand/contract changes so old and new application revisions remain compatible across the deployment. Record the printed UTC restore point before a production migration. A failed bundle leaves the existing application revision serving, but earlier migrations may already have committed. EF normally wraps each PostgreSQL migration in a transaction where supported; operations outside transactions and failures between migrations can leave partial progress. Inspect migration history and database state, resolve the cause, and apply a reviewed forward fix; do not assume that stopping the deployment restored the database.

If recovery requires point-in-time restore, restore to a new PostgreSQL server at the recorded UTC time, verify the data, grants, connectivity and application compatibility, and coordinate the traffic and connection-string switch. This can lose changes made after the restore point. Do not overwrite the original server while investigating. The restore drill is tracked separately in S10.

The tool and app use `SSL Mode=VerifyFull` and the system CA store. Azure currently uses DigiCert Global Root G2 and Microsoft RSA Root CA 2017; ensure both are trusted in the runner and runtime image before the live check. See [Azure PostgreSQL TLS guidance](https://learn.microsoft.com/azure/postgresql/flexible-server/security-tls) and [Npgsql certificate validation](https://www.npgsql.org/doc/security.html).

## Check schema privileges live

Immediately after initialization, obtain the server FQDN and connect using `psql` with a password prompt. Initialization removes its temporary firewall rule, so first permit the operator's public IPv4 temporarily (or use an existing allowlist rule):

```sh
az postgres flexible-server firewall-rule create --resource-group <resource-group> --server-name <server-name> --name calendar-operator-check --start-ip-address <public-ipv4> --end-ip-address <public-ipv4>
```

After the checks, remove that rule:

```sh
az postgres flexible-server firewall-rule delete --resource-group <resource-group> --server-name <server-name> --name calendar-operator-check --yes
```

Enter the relevant ops-vault password at the prompt; never put it in an argument or shell history. Replace `<server-fqdn>` with the server's actual FQDN:

```sh
psql "host=<server-fqdn> dbname=calendar user=calendar_migrator sslmode=verify-full sslrootcert=system" -W
```

These commands use a recent `psql` with `sslrootcert=system`; on older clients, configure the verified root certificate file instead. At the `psql` prompt, confirm that the migrator can create and remove an object:

```sql
CREATE TABLE public.t();
DROP TABLE public.t;
\q
```

Then connect as the app role and confirm creation fails with `permission denied for schema public`:

```sh
psql "host=<server-fqdn> dbname=calendar user=calendar_app sslmode=verify-full sslrootcert=system" -W
```

```sql
CREATE TABLE public.t();
\q
```

If initialization reports a PostgreSQL permissions failure, the administrator may lack rights to revoke `CREATE` from `PUBLIC` because Azure owns `public` as `azure_pg_admin`. PostgreSQL can report `permission denied for schema public` or `must be owner of schema public`. Inspect the failure as administrator. An **unverified fallback**, subject to Azure allowing the operation, is to run `ALTER SCHEMA public OWNER TO calendar_migrator;` as administrator, rerun initialization, and repeat both checks. This changes schema ownership and requires owner review before use.

To run the role agreement integration test locally, start Docker and run `dotnet run tools/infra/integration/database.cs` from the repository root. It compares the tool grants to the local initialization script and checks migrator, app, and unprivileged-role access.

## Temporary firewall rules and concurrent operators

Run only one initializer per environment at a time, and do not run initialization concurrently with a migration for the same server. Each command removes leftover `calendar-migration-*` rules on that server before starting, so concurrent commands could remove each other's access. After writing a secret, initialization checks its latest value and the role state again, but these checks are not a distributed lock. If concurrent initialization is reported, stop the other operator and inspect the vault and roles before retrying.

SIGINT and SIGTERM request cooperative cancellation and the tool waits for firewall cleanup. SIGKILL, runner loss, and other abrupt termination can still leave a rule behind. Before manually sweeping, ensure no initialization or migration is running. List and delete only the stale rules shown by these commands, replacing the placeholders with actual resource names:

```sh
az postgres flexible-server firewall-rule list --resource-group <resource-group> --server-name <server-name> --query "[?starts_with(name, 'calendar-migration-')].name" -o tsv
az postgres flexible-server firewall-rule delete --resource-group <resource-group> --server-name <server-name> --name <stale-rule-name> --yes
```
