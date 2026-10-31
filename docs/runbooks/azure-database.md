# Azure PostgreSQL operations

Use this runbook once for staging, then once for production. Finish and check staging first.

Terms used here:

- **Server**: the Azure Database for PostgreSQL Flexible Server. Its **firewall** allows only listed public IPv4 addresses to connect.
- **Role**: a PostgreSQL identity with its own permissions. `calendar_migrator` changes the schema. `calendar_app` is the app's identity and has fewer permissions.
- **Schema**: the database's tables and other structures. A **migration** is a versioned schema change. The app never applies migrations itself ([ADR-0015](../decisions/0015-ef-core-data-access.md)).
- **Vaults**: two Azure Key Vaults that store secrets. The **ops vault** stores the administrator and role passwords. The **app vault** stores the app's connection string, which holds the server address and the app password.
- **FQDN**: the server's full DNS hostname, for example `<server-name>.postgres.database.azure.com`.

See also [ADR-0031](../decisions/0031-azure-postgresql-flexible-server.md) and [ADR-0034](../decisions/0034-github-actions-oidc-deployment.md).

## Before you start

- Complete the foundation and full deployments in [Azure infrastructure](azure-infrastructure.md). They create the server and both vaults.
- Use a trusted machine with the repository, the tools the infrastructure runbook lists, Azure CLI (`az`) and a recent `psql`. Run `make` commands from the repository root.
- Sign in with `az login` and select the subscription, as in [Azure bootstrap](azure-bootstrap.md). Check `az account show` before each environment.
- Make sure the server is running. Staging can be stopped to save cost; see [Azure infrastructure](azure-infrastructure.md).
- You need **Key Vault Secrets Officer** on both vaults and permission to manage the server's firewall rules. You also need access to run GitHub Actions workflows. Production migrations need approval in the protected GitHub environment.
- Connections use TLS with `SSL Mode=VerifyFull`. This checks the server's certificate and hostname against the system certificate authority (CA) store. The runner and the app image must trust DigiCert Global Root G2 and Microsoft RSA Root CA 2017. See [Azure PostgreSQL TLS guidance](https://learn.microsoft.com/azure/postgresql/flexible-server/security-tls) and [Npgsql certificate validation](https://www.npgsql.org/doc/security.html).
- Only one person may initialize or migrate a server at a time. See [Temporary firewall rules and concurrent operators](#temporary-firewall-rules-and-concurrent-operators).

### Set up your shell

Run this block first, in the Bash shell you will use for all the steps. It needs no editing. After that, the commands below can be copied and run as they are. If you open a new shell, run it again. For production, change `ENV` and run it again.

```bash
# Check that you are signed in to the right Azure subscription. If this fails, run `az login` first.
az account show --query '{subscription:name,id:id}' -o table

# The environment to work on: staging or production.
ENV=staging
# The resource group created for this environment.
RG="rg-calendar-$ENV"
# The name of this environment's database server. The group has one server.
SERVER_NAME=$(az postgres flexible-server list -g "$RG" --query '[0].name' -o tsv)
# The server's full hostname (FQDN). Use the FQDN, not the server name, in psql: the certificate check needs it.
FQDN=$(az postgres flexible-server show -g "$RG" -n "$SERVER_NAME" --query fullyQualifiedDomainName -o tsv)
# The name of the ops vault, which holds the database passwords. The foundation deployment recorded it.
ops_vault=$(az deployment group show -g "$RG" -n calendar-foundation --query properties.outputs.opsKeyVaultName.value -o tsv)

# Your public IPv4 address, as the internet sees it. api.ipify.org is a third-party service: it learns your address
# when you ask. -4 forces IPv4, -f fails on an HTTP error and --max-time stops a slow request after 10 seconds.
PUBLIC_IP=$(curl -4 -fsS --max-time 10 https://api.ipify.org)
# This warns if the address is empty or has other characters than digits and dots. Then set PUBLIC_IP by hand.
# It must be one IPv4 address here, not a range.
case "$PUBLIC_IP" in
  *[!0-9.]* | "" ) echo "Could not detect your public IPv4 address. Set PUBLIC_IP by hand." >&2 ;;
esac

# Print what you set. Check it before you go on.
echo "ENV=$ENV RG=$RG SERVER_NAME=$SERVER_NAME FQDN=$FQDN ops_vault=$ops_vault PUBLIC_IP=$PUBLIC_IP"
```

Keep `ENV` as a plain shell variable, as shown. Do not `export` it: some shells read an exported `ENV` as the name of a startup file. The `make` commands below get it on their command line instead.

## First-time setup

1. Create the roles and their permissions:

   ```bash
   # Allow your address through the firewall for a short time, create or check the roles, then remove the rule.
   make infra-init-roles ENV="$ENV" ARGS="--client-ip $PUBLIC_IP"
   ```

   The command reads the administrator password from the ops vault, creates or checks the roles and their permissions, and removes its firewall rule at the end. If you omit `--client-ip`, the tool asks `https://api.ipify.org` for your address, as the setup block does. Supply it yourself if that service is unavailable or reaches Azure by a different route than the database.

   The command must exit without an error. If it reports that the vault and a role disagree, stop and go to [Initialization recovery](#initialization-recovery). Do not make up a new password.

2. Run the [live privilege checks](#check-schema-privileges-live). Both must give the expected result before you continue.

3. Run the migration. Start the **Database migration** workflow from the `main` branch and select the environment. The migration job runs only from `main`. You can start it in GitHub (**Actions** > **Database migration** > **Run workflow**), or with the GitHub CLI (`gh`, signed in with `gh auth login`):

   ```bash
   # Start the workflow on main for this environment.
   gh workflow run migrate.yml --ref main -f environment="$ENV"
   # Wait a few seconds for the run to appear, then find the newest run of this workflow.
   sleep 5
   run_id=$(gh run list --workflow migrate.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
   # Follow the run until it ends. The command fails if the run fails. Production waits here for your approval in GitHub.
   gh run watch "$run_id" --exit-status
   ```

   Wait for the run to succeed. If it fails, go to [Migration failure and rollback](#migration-failure-and-rollback).

4. Deploy the app with the app-vault `calendar-connection-string`, as described in [Azure infrastructure](azure-infrastructure.md). Make sure the app is healthy and connects as `calendar_app`.

5. Repeat steps 1–4 for production. Set `ENV=production` in the setup block, run it again, and use the production subscription if it differs. Get the environment approval for the workflow. Before it migrates, the workflow log prints `Production restore point (UTC): ...`. Record that time; you need it for a restore:

   ```bash
   # Print the restore point line from the production run you just watched.
   gh run view "$run_id" --log | grep "Production restore point"
   ```

   Allow traffic only after the workflow, the privilege checks and the app all succeed.

## Check schema privileges live

These checks prove that the migrator can create tables and the app cannot. They create and drop a test table named `public.t`, so make sure no real table has that name. Run the [setup block](#set-up-your-shell) first.

1. Initialization removed its own firewall rule. Unless another rule already allows your address, add a temporary one:

   ```bash
   # Allow your address to reach the database. The rule is named so you can find and remove it later.
   az postgres flexible-server firewall-rule create --resource-group "$RG" --server-name "$SERVER_NAME" --name calendar-operator-check --start-ip-address "$PUBLIC_IP" --end-ip-address "$PUBLIC_IP"
   ```

2. Connect as the migrator and create and drop a table. The password comes from the ops vault straight into the `psql` process: it is not in the command line or your shell history.

   ```bash
   # Run two SQL commands as calendar_migrator. Expect CREATE TABLE, then DROP TABLE.
   PGPASSWORD=$(az keyvault secret show --vault-name "$ops_vault" --name calendar-migrator-password --query value -o tsv) \
     psql "host=$FQDN dbname=calendar user=calendar_migrator sslmode=verify-full sslrootcert=system" \
     -c 'CREATE TABLE public.t();' -c 'DROP TABLE public.t;'
   ```

   `sslrootcert=system` needs a recent `psql`. With an older client, point `sslrootcert` at a trusted root certificate file instead. If the create fails, stop and investigate. If the drop fails, ask an administrator to remove `public.t`.

   If you prefer to type the password yourself, leave out the `PGPASSWORD=...` line, add `-W` to the `psql` command, and paste the value of `calendar-migrator-password` at the prompt. Never put a password in a command argument or a log.

3. Connect as the app and try to create a table. This must fail.

   ```bash
   # Run one SQL command as calendar_app. Expect an error: permission denied for schema public.
   PGPASSWORD=$(az keyvault secret show --vault-name "$ops_vault" --name calendar-app-password --query value -o tsv) \
     psql "host=$FQDN dbname=calendar user=calendar_app sslmode=verify-full sslrootcert=system" \
     -c 'CREATE TABLE public.t();'
   ```

   Expect `ERROR:  permission denied for schema public`. The command exits with an error code; that is the correct result. If the table is created, the grants are wrong: ask an administrator to remove `public.t`, keep traffic off and investigate the grants.

4. Remove the rule you added in step 1, even if a check failed. Do not remove a rule that others use.

   ```bash
   # Remove the temporary firewall rule.
   az postgres flexible-server firewall-rule delete --resource-group "$RG" --server-name "$SERVER_NAME" --name calendar-operator-check --yes
   ```

### If initialization reports a permissions failure

Azure makes `azure_pg_admin` the owner of the `public` schema. The administrator may then be unable to revoke `CREATE` from `PUBLIC` (the group that contains every role). PostgreSQL reports `permission denied for schema public` or `must be owner of schema public`. Inspect the failure as administrator.

An **unverified fallback** is to run `ALTER SCHEMA public OWNER TO calendar_migrator;` as administrator. It changes who owns the schema, Azure may not allow it, and the owner must approve it first. If it succeeds, rerun initialization and repeat both checks.

### Local integration test

To check the role grants without Azure, start Docker and run `dotnet run tools/infra/integration/database.cs` from the repository root. It compares the tool's grants with the local initialization script and tests access for the migrator, the app and a role with no privileges. It does not replace the live checks.

## Initialization recovery

The ops vault is the source of truth for `calendar-migrator-password` and `calendar-app-password`. For each role, initialization does this:

| Vault secret | PostgreSQL role | What initialization does |
| --- | --- | --- |
| Missing | Missing | Stores a new password, then creates the role. |
| Exists | Missing | Creates the role with the stored password. |
| Exists | Exists | Checks the password works, then reapplies the grants. |
| Missing | Exists | Stops. |
| Exists, wrong | Exists | Stops. |

Initialization never changes a role's password. It also builds the app vault's `calendar-connection-string` from the app password and the FQDN. If a different value is already stored, it stops instead of overwriting it.

Initialization revokes the public `CONNECT` grant on the database, but keeps `CONNECT` for the administrator who runs it, so a rerun can reconnect.

If the vault and PostgreSQL disagree, stop deployments and agree the recovery with the owner. The owner either:

- chooses a new password, sets it with `ALTER ROLE ... PASSWORD` over a protected administrator connection, and stores the same password in the matching ops-vault secret through a protected secret input. For `calendar_app`, the owner also updates the app-vault connection string; or
- drops the role, if it owns no objects and has no dependencies (check both first), so that initialization recreates it from the stored secret.

Never put passwords in shell history, process arguments, logs or issue comments. Then rerun initialization, make sure it succeeds, and repeat the live checks.

## Password rotation

1. Schedule a maintenance window. Stop migrations and app traffic as needed. For the migrator, make sure no migration is running.
2. Generate the new password securely.
3. Set it on the role over a protected administrator connection.
4. Store the same password in the role's ops-vault secret.
5. For `calendar_app`, update the app-vault connection string with the same password. Then refresh or redeploy the app, so its connection pools and secret reference use the new value.
6. Check that the new password works and that the app or the migration workflow succeeds.

Steps 3 and 4 do not happen together, so connections can fail between them. Never put the password in command arguments or logs.

## Migration failure and rollback

Migrations only move forward. Make schema changes in two steps (expand, then contract): first add what the new app needs, and remove old structures only in a later release. Old and new app revisions then both work during a deployment.

If the migration bundle (the program that applies migrations) fails, the current app revision keeps serving. Earlier migrations in the same run may already be committed. EF normally runs each PostgreSQL migration in a transaction, but operations outside a transaction, or a failure between migrations, can leave partial changes. Stopping the deployment does not undo them.

1. Inspect the migration history and the database state.
2. Fix the cause and apply a reviewed forward fix.
3. Check the migration and the app before you change traffic.

If you must restore the data, do a point-in-time restore to a **new** server at the recorded UTC restore point. Changes made after that time are lost. Do not overwrite the original server while you investigate. Check the data, grants, connectivity and app compatibility on the new server, then plan the switch of traffic and connection string. The restore drill is tracked in S10.

## Temporary firewall rules and concurrent operators

Run only one initialization per environment at a time, and never during a migration on the same server. Before it starts, each initialization or migration deletes leftover `calendar-migration-*` firewall rules on that server, so two at once can remove each other's access. GitHub workflow concurrency does not cover a local initialization. Initialization checks the secret and role again after writing a secret, but this is not a lock. If concurrent initialization is reported, stop the other operator and inspect the vault and roles before you retry.

On SIGINT or SIGTERM, the tool cancels and removes its firewall rule first. SIGKILL, a lost runner or another abrupt stop can leave a rule behind. To clean up:

1. Make sure no initialization or migration is running.
2. List the leftover rules (run the [setup block](#set-up-your-shell) first):

   ```bash
   # Show the names of the leftover temporary rules. Read the list before you delete anything.
   az postgres flexible-server firewall-rule list --resource-group "$RG" --server-name "$SERVER_NAME" --query "[?starts_with(name, 'calendar-migration-')].name" -o tsv
   ```

3. Delete each stale rule from the list:

   ```bash
   # Delete every leftover temporary rule. Only run this after step 1 and after you have read the list.
   for rule in $(az postgres flexible-server firewall-rule list --resource-group "$RG" --server-name "$SERVER_NAME" --query "[?starts_with(name, 'calendar-migration-')].name" -o tsv); do
     az postgres flexible-server firewall-rule delete --resource-group "$RG" --server-name "$SERVER_NAME" --name "$rule" --yes
   done
   ```

4. List again. Expect an empty result.
