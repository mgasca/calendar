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
- You need **Key Vault Secrets Officer** on both vaults. To check, or to grant it, follow [Give yourself Key Vault Secrets Officer](azure-infrastructure.md#give-yourself-key-vault-secrets-officer). You also need permission to manage the server's firewall rules. You also need access to run GitHub Actions workflows. Production migrations need approval in the protected GitHub environment.
- Note the environment's resource group, server name and FQDN, and the public IPv4 address your machine uses to reach Azure. Replace each `<placeholder>` below, without the angle brackets. To get the FQDN:

  ```sh
  az postgres flexible-server show --resource-group <resource-group> --name <server-name> --query fullyQualifiedDomainName -o tsv
  ```

  Use the FQDN, not the server name, in `psql` connections. The certificate check needs the full hostname.
- Connections use TLS with `SSL Mode=VerifyFull`. This checks the server's certificate and hostname against the system certificate authority (CA) store. The runner and the app image must trust DigiCert Global Root G2 and Microsoft RSA Root CA 2017. See [Azure PostgreSQL TLS guidance](https://learn.microsoft.com/azure/postgresql/flexible-server/security-tls) and [Npgsql certificate validation](https://www.npgsql.org/doc/security.html).
- Only one person may initialize or migrate a server at a time. See [Temporary firewall rules and concurrent operators](#temporary-firewall-rules-and-concurrent-operators).

## First-time setup

1. Create the roles and their permissions on staging:

   ```sh
   make infra-init-roles ENV=staging ARGS="--client-ip <public-ipv4>"
   ```

   The command allows your address through the firewall for a short time. It reads the administrator password from the ops vault, creates or checks the roles and their permissions, then removes its firewall rule. If you omit `--client-ip`, the tool asks `https://api.ipify.org` for your address. Supply `--client-ip` if that service is unavailable or reaches Azure by a different route than the database.

   The command must exit without an error. If it reports that the vault and a role disagree, stop and go to [Initialization recovery](#initialization-recovery). Do not make up a new password.
2. Run the [live privilege checks](#check-schema-privileges-live). Both must give the expected result before you continue.
3. Run the migration. In GitHub, open **Actions** > **Database migration** > **Run workflow**. Select the `main` branch and the `staging` environment. The migration job runs only from `main`. Wait for the run to succeed. If it fails, go to [Migration failure and rollback](#migration-failure-and-rollback).
4. Deploy the app with the app-vault `calendar-connection-string`, as described in [Azure infrastructure](azure-infrastructure.md). Make sure the app is healthy and connects as `calendar_app`.
5. Repeat steps 1–4 for production, with its subscription, resource group, server and `ENV=production`. Select `production` in the workflow and get the environment approval. Before it migrates, the workflow log prints `Production restore point (UTC): ...`. Record that time; you need it for a restore. Allow traffic only after the workflow, the privilege checks and the app all succeed.

## Check schema privileges live

These checks prove that the migrator can create tables and the app cannot. They create and drop a test table named `public.t`, so make sure no real table has that name.

1. Initialization removed its own firewall rule. Unless another rule already allows your address, add a temporary one:

   ```sh
   az postgres flexible-server firewall-rule create --resource-group <resource-group> --server-name <server-name> --name calendar-operator-check --start-ip-address <public-ipv4> --end-ip-address <public-ipv4>
   ```

2. Connect as the migrator. At the password prompt, enter `calendar-migrator-password` from the ops vault. Never put a password in a command argument, shell history or log.

   ```sh
   psql "host=<server-fqdn> dbname=calendar user=calendar_migrator sslmode=verify-full sslrootcert=system" -W
   ```

   `sslrootcert=system` needs a recent `psql`. With an older client, point `sslrootcert` at a trusted root certificate file instead.

3. At the `psql` prompt, run:

   ```sql
   CREATE TABLE public.t();
   DROP TABLE public.t;
   \q
   ```

   Expect `CREATE TABLE` and then `DROP TABLE`. If the create fails, stop and investigate. If the drop fails, ask an administrator to remove `public.t`.

4. Connect as the app, with `calendar-app-password` from the ops vault:

   ```sh
   psql "host=<server-fqdn> dbname=calendar user=calendar_app sslmode=verify-full sslrootcert=system" -W
   ```

5. At the `psql` prompt, run:

   ```sql
   CREATE TABLE public.t();
   \q
   ```

   Expect `permission denied for schema public`. If the table is created, the grants are wrong: ask an administrator to remove `public.t`, keep traffic off and investigate the grants.

6. Remove the rule you added in step 1, even if a check failed. Do not remove a rule that others use.

   ```sh
   az postgres flexible-server firewall-rule delete --resource-group <resource-group> --server-name <server-name> --name calendar-operator-check --yes
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
2. List the leftover rules:

   ```sh
   az postgres flexible-server firewall-rule list --resource-group <resource-group> --server-name <server-name> --query "[?starts_with(name, 'calendar-migration-')].name" -o tsv
   ```

3. Delete each stale rule from the list:

   ```sh
   az postgres flexible-server firewall-rule delete --resource-group <resource-group> --server-name <server-name> --name <stale-rule-name> --yes
   ```

4. List again. Expect an empty result.
