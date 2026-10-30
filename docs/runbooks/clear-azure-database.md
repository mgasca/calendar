# Azure PostgreSQL operations

Use this runbook separately for staging (the test environment, with synthetic data) and production (the live environment). Complete and verify staging first. Azure Database for PostgreSQL Flexible Server hosts the PostgreSQL database; its firewall restricts which public IPv4 addresses can connect. A PostgreSQL role is a database identity with specific permissions. `calendar_migrator` changes the schema (the database's tables and other structures); `calendar_app` is the less-privileged identity used by the application. A migration is a versioned schema change. The app must not apply migrations at startup. See [ADR-0015](../decisions/0015-ef-core-data-access.md), [ADR-0031](../decisions/0031-azure-postgresql-flexible-server.md), and [ADR-0034](../decisions/0034-github-actions-oidc-deployment.md).

## Before you start

- Complete the foundation and full deployments in [Azure infrastructure](azure-infrastructure.md), including the linked bootstrap. These create the server and two Azure Key Vaults, which store secrets: the ops vault holds administrative and role passwords; the app vault holds the application's connection string. A connection string describes how to connect and includes credentials.
- Use a trusted operator machine with the repository checkout, the tools required by the infrastructure runbook, Azure CLI (`az`), and a recent PostgreSQL command-line client (`psql`) for the live checks. Run `make` commands from the repository root. Sign in with `az login`, select the intended subscription as described in [Azure bootstrap](azure-bootstrap.md), and check `az account show` before each environment. Confirm the server is running; see staging start/stop in [Azure infrastructure](azure-infrastructure.md).
- The operator needs Key Vault Secrets Officer on both vaults, as well as the Azure permissions to manage the server's firewall rules. The infrastructure runbook explains how to grant and verify the vault roles. Allow time for Azure role assignments to propagate. The operator also needs access to dispatch and inspect GitHub Actions workflows; production requires approval in the protected GitHub environment.
- Identify the environment's resource group, server name, server fully qualified domain name (FQDN: its complete DNS hostname), vault names, and the public IPv4 address actually used by the operator machine to reach Azure. Use the matching values throughout; angle-bracket placeholders below must be replaced without the brackets. The infrastructure deployment outputs identify the vaults, and its server list identifies the server. Obtain the FQDN without exposing a secret:

  ```sh
  az postgres flexible-server show --resource-group <resource-group> --name <server-name> --query fullyQualifiedDomainName -o tsv
  ```

  Verify the output is the intended server's hostname. Do not substitute the server name for the FQDN in certificate-verified connections.
- Connections use TLS (encrypted transport) with `SSL Mode=VerifyFull`, which checks the certificate and hostname against the system certificate authority (CA) store. Ensure the runner and application runtime trust DigiCert Global Root G2 and Microsoft RSA Root CA 2017 before the live check. See [Azure PostgreSQL TLS guidance](https://learn.microsoft.com/azure/postgresql/flexible-server/security-tls) and [Npgsql certificate validation](https://www.npgsql.org/doc/security.html).
- Coordinate with other operators: run only one initializer per environment, and never initialize while a migration is running on the same server. Both commands sweep temporary migration firewall rules; concurrent operations can remove each other's access. GitHub workflow concurrency alone does not coordinate a local initializer.

## First-time setup

1. Initialize staging's roles and grants from the operator machine:

   ```sh
   make infra-init-roles ENV=staging ARGS="--client-ip <public-ipv4>"
   ```

   The tool temporarily allows that IPv4 address through the server firewall, reads the administrator password from the ops vault, creates or checks the role credentials and grants, and removes its temporary rule afterward. If `--client-ip` is omitted, it asks `https://api.ipify.org` for the public IPv4; use the override when that service is unavailable or its route differs from the database route. Check the command exits successfully. If it reports a vault/role mismatch, stop and use [Initialization recovery](#initialization-recovery); do not invent a replacement password.
2. Run the [live schema privilege checks](#check-schema-privileges-live) immediately after initialization. Both the successful migrator check and denied app check must match the expected results before proceeding.
3. In GitHub, open **Actions**, select **Database migration**, choose **Run workflow**, select the `main` branch and the `staging` environment, and dispatch it. A workflow is an automated GitHub Actions job; this one builds and runs the migration bundle as `calendar_migrator`. Open the resulting run and confirm its conclusion is successful before proceeding. A run dispatched from another branch does not run the migration job. If it fails, use [Migration failure and rollback](#migration-failure-and-rollback).
4. Deploy the app with the app-vault `calendar-connection-string` and check it connects as `calendar_app`. Confirm the app is healthy and can use the database; the live privilege check confirms this role cannot create a table. If creation unexpectedly succeeds, remove the probe using an administrator and investigate the grants before allowing traffic. App secret references are described in [Azure infrastructure](azure-infrastructure.md).
5. Repeat for production using its subscription, resource group, vaults, server and `ENV=production`. Select `production` in the workflow and obtain the protected environment approval. Before the bundle runs, the workflow prints `Production restore point (UTC): ...` in its output and step summary; record that timestamp for recovery. Verify the workflow succeeds, the privilege checks pass and the app connects before allowing traffic.

## Check schema privileges live

These checks create and remove a small test table to verify the intended separation of duties. A PostgreSQL schema is a namespace for database objects; `public` is the schema checked here. Make sure no unrelated table named `public.t` exists before starting. Initialization removes its temporary firewall rule, so temporarily permit the operator's public IPv4 unless an existing rule already permits it:

```sh
az postgres flexible-server firewall-rule create --resource-group <resource-group> --server-name <server-name> --name calendar-operator-check --start-ip-address <public-ipv4> --end-ip-address <public-ipv4>
```

Check the command succeeds and targets the intended server and address. Retrieve the relevant password from the ops vault through a protected secret-input method and enter it at each `psql` password prompt; do not put it in an argument, shell history or log. Replace `<server-fqdn>` with the hostname identified above:

```sh
psql "host=<server-fqdn> dbname=calendar user=calendar_migrator sslmode=verify-full sslrootcert=system" -W
```

A successful connection displays a `psql` prompt. These commands require a recent `psql` supporting `sslrootcert=system`; on older clients, configure a verified root certificate file instead. At the prompt run:

```sql
CREATE TABLE public.t();
DROP TABLE public.t;
\q
```

Expect `CREATE TABLE` and `DROP TABLE`, then exit. If creation fails, investigate before proceeding; if the drop fails, have an administrator remove the test table.

Connect as the application role:

```sh
psql "host=<server-fqdn> dbname=calendar user=calendar_app sslmode=verify-full sslrootcert=system" -W
```

At its prompt run:

```sql
CREATE TABLE public.t();
\q
```

Expect `permission denied for schema public`. If creation succeeds, have an administrator remove `public.t`, stop traffic and investigate the grants. After the checks, including if they fail, remove the rule you created:

```sh
az postgres flexible-server firewall-rule delete --resource-group <resource-group> --server-name <server-name> --name calendar-operator-check --yes
```

Verify deletion succeeds; if it fails, investigate and remove the rule before leaving. Do not delete an existing allowlist rule used by others.

If initialization reports a PostgreSQL permissions failure, the administrator may lack rights to revoke `CREATE` from `PUBLIC` (the PostgreSQL group containing all roles) because Azure owns `public` as `azure_pg_admin`. PostgreSQL can report `permission denied for schema public` or `must be owner of schema public`. Inspect the failure as administrator. An **unverified fallback**, subject to Azure allowing it and owner review, is `ALTER SCHEMA public OWNER TO calendar_migrator;` as administrator. This changes schema ownership. If approved and successful, rerun initialization and repeat both checks.

To run the role agreement integration test locally, start Docker and run `dotnet run tools/infra/integration/database.cs` from the repository root. It compares tool grants to the local initialization script and checks migrator, app and unprivileged-role access. Confirm the test succeeds; it does not replace the live Azure checks.

## Initialization recovery

Initialization preserves database `CONNECT` for the executing administrator after revoking the public database grant, so the owner can reconnect on a rerun. The ops vault is the source of truth for `calendar-migrator-password` and `calendar-app-password`. For each role, initialization stores a new password before creating a missing role. If a secret exists but the role does not, it creates the role with that secret. If both exist, it checks the credential authenticates before reapplying grants. If a role exists without a secret, or the existing credential cannot authenticate, initialization stops; it never changes a role password automatically. The app vault's `calendar-connection-string` is derived from the app password and server FQDN. An existing different value stops initialization rather than being overwritten.

If the vault and PostgreSQL disagree, stop deployments and coordinate recovery with the owner. The owner can choose a new password, change the role with `ALTER ROLE ... PASSWORD` over a protected administrative connection, and store that exact password in the corresponding ops-vault secret using a protected secret-input method. For `calendar_app`, also update the app-vault connection string to match. Alternatively, if the role owns no objects and has no dependencies, the owner can remove it and rerun initialization with its existing secret. Check ownership and dependencies before dropping a role. Do not put passwords in shell history, process arguments, logs or issue comments. Rerun initialization and confirm it succeeds, then repeat the live checks to verify authentication and grants.

## Password rotation

Schedule a maintenance window and stop migrations and application traffic as appropriate. Generate the replacement secret securely, update the role through a protected administrator connection, then update its ops-vault secret. For the app role, update the app-vault connection string to the same password and refresh or redeploy the app so its connection pools and secret reference use the new value. For the migrator, ensure no migration is running before changing its password and vault secret. The database and vault updates are not atomic: connections can fail between the two changes. Verify authentication with the new credential and check the app or migration workflow succeeds after the change. Never expose the password in command arguments or logs.

## Migration failure and rollback

Migrations are forward-only; use expand/contract changes so old and new application revisions remain compatible across the deployment. This means introducing compatible schema changes before removing old structures in a later release. Record the printed UTC restore point before a production migration. A failed bundle leaves the existing application revision serving, but earlier migrations may already have committed. EF normally wraps each PostgreSQL migration in a transaction where supported; operations outside transactions and failures between migrations can leave partial progress. Inspect migration history and database state, resolve the cause, and apply a reviewed forward fix; do not assume that stopping the deployment restored the database. Verify the corrected migration and application before proceeding with traffic changes.

If recovery requires point-in-time restore, restore to a new PostgreSQL server at the recorded UTC time, verify the data, grants, connectivity and application compatibility, and coordinate the traffic and connection-string switch. This can lose changes made after the restore point. Do not overwrite the original server while investigating. The restore drill is tracked separately in S10.

## Temporary firewall rules and concurrent operators

Each initializer or migration removes leftover `calendar-migration-*` rules on that server before starting. After writing a secret, initialization checks its latest value and the role state again, but these checks are not a distributed lock. If concurrent initialization is reported, stop the other operator and inspect the vault and roles before retrying.

SIGINT and SIGTERM request cooperative cancellation and the tool waits for firewall cleanup. SIGKILL, runner loss and other abrupt termination can still leave a rule behind. Before manually sweeping, ensure no initialization or migration is running. List stale rules, then delete only the identified stale rules, replacing placeholders with actual resource names:

```sh
az postgres flexible-server firewall-rule list --resource-group <resource-group> --server-name <server-name> --query "[?starts_with(name, 'calendar-migration-')].name" -o tsv
az postgres flexible-server firewall-rule delete --resource-group <resource-group> --server-name <server-name> --name <stale-rule-name> --yes
```

Run the delete once per stale rule. List again and verify the intended stale names are gone; an empty list is expected if none remain. Do not remove rules for active work or unrelated allowlists.
