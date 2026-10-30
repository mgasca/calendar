# Azure PostgreSQL operations

Run these steps separately for staging and production. Select the correct Azure subscription and environment. A protected GitHub environment requires approval before a production migration. A migration changes the database schema, which defines its tables and permissions.

A vault is an Azure Key Vault that stores secrets. A role is a PostgreSQL identity with permissions. The ops vault stores database passwords. The app vault stores the app connection string, which contains the information needed to connect.

## First-time setup

1. Complete the foundation and full deployments in [Azure infrastructure](azure-infrastructure.md).
2. Grant the operator Key Vault Secrets Officer on both vaults.
3. On the operator's machine, run `make infra-init-roles ENV=staging ARGS="--client-ip <public-ipv4>"`. Initialization creates the database roles and grants their permissions. Use the public IPv4 address that the machine uses to reach Azure. The command temporarily allows that address through the PostgreSQL firewall.
4. If you omit `--client-ip`, the tool asks `https://api.ipify.org` for the public IPv4 address. If that service is unavailable or uses a different route to the database, supply `--client-ip`.
5. From `main`, dispatch the migration workflow for staging. Make sure that it succeeds.
6. Deploy the app with its connection string from the app vault. Make sure that it connects as `calendar_app`.
7. Connect as `calendar_app` and run `CREATE TABLE public.permission_probe (id integer)`. Make sure that PostgreSQL denies permission. If the command succeeds, ask an administrator to remove the table. Investigate the grants before you allow traffic.
8. Repeat these steps for production. Record the migration restore point and obtain the required environment approval.

## Initialization recovery

Initialization removes the public database CONNECT grant but keeps CONNECT for the administrator who runs it. This allows that administrator to reconnect and rerun initialization.

The ops vault is the source of truth for `calendar-migrator-password` and `calendar-app-password`. For each role, initialization stores a new password before it creates a missing role. If the secret exists but the role does not, initialization creates the role with that secret. If both exist, initialization tests the password before it reapplies grants. If the role exists without a secret, initialization stops. If the password cannot authenticate, initialization stops. Initialization never changes a role password automatically.

Initialization derives `calendar-connection-string` in the app vault from the app password and server FQDN. The FQDN is the server's full domain name. If the existing connection string differs, initialization stops without overwriting it.

If the vault and PostgreSQL disagree, stop deployments and coordinate recovery with the owner. The owner can choose a new password and change the role with `ALTER ROLE ... PASSWORD` over a protected administrator connection. The owner must store that exact password in the matching ops-vault secret through a protected secret input. For `calendar_app`, the owner must also update the app-vault connection string to match.

If the role owns no objects and has no dependencies, the owner can instead remove it. First, make sure that the role has no ownership or dependencies. Then rerun initialization with its existing secret. Do not put passwords in shell history, process arguments, logs, or issue comments. Rerun initialization to test authentication and grants.

## Password rotation

Password rotation replaces a password. Schedule a maintenance window. Stop migrations and app traffic as appropriate. Generate the replacement password securely. Change the role through a protected administrator connection. Update its ops-vault secret with the same password.

For `calendar_app`, update the app-vault connection string with the same password. Refresh or redeploy the app so its connection pools and secret reference use the new value. A connection pool reuses database connections. A secret reference points the app to a vault secret.

For `calendar_migrator`, make sure that no migration is running before you change its password and vault secret. The database and vault updates do not happen together. Connections can fail between the updates. Test role authentication and the app or migration workflow after the change. Do not put passwords in command arguments or logs.

## Migration failure and rollback

Migrations only move forward. Use expand/contract changes to keep old and new app revisions compatible during deployment. Expand/contract makes compatible additions before it removes old structures. Before a production migration, record the printed UTC restore point.

If the migration bundle fails, the existing app revision continues to serve traffic. A bundle is the executable that applies migrations. Earlier migrations can already have committed. EF normally wraps each PostgreSQL migration in a transaction when supported. A transaction groups changes into one unit. Operations outside transactions and failures between migrations can leave partial changes.

Inspect migration history and database state. Resolve the cause. Apply a reviewed forward fix. Do not assume that stopping deployment restored the database.

If recovery requires a point-in-time restore, restore to a new PostgreSQL server at the recorded UTC time. This restores data from a chosen time and can lose later changes. Make sure that the data, grants, connectivity, and app compatibility are correct. Coordinate the traffic and connection-string switch. Do not overwrite the original server during investigation. The restore drill is tracked separately in S10.

The tool and app use `SSL Mode=VerifyFull` and the system CA store. This setting checks the server certificate and hostname. A CA store contains trusted certificate authorities. Azure currently uses DigiCert Global Root G2 and Microsoft RSA Root CA 2017. Before the live check, make sure that the runner and runtime image trust both roots. See [Azure PostgreSQL TLS guidance](https://learn.microsoft.com/azure/postgresql/flexible-server/security-tls) and [Npgsql certificate validation](https://www.npgsql.org/doc/security.html).

## Check schema privileges live

Immediately after initialization, obtain the server FQDN. Initialization removes its temporary firewall rule. A firewall rule allows selected network addresses to connect. If no existing rule allows the operator's public IPv4, temporarily allow it. Replace the placeholders with actual values:

```sh
az postgres flexible-server firewall-rule create --resource-group <resource-group> --server-name <server-name> --name calendar-operator-check --start-ip-address <public-ipv4> --end-ip-address <public-ipv4>
```

Use a recent `psql` that supports `sslrootcert=system`. If the client is older, configure a verified root certificate file instead. Replace `<server-fqdn>` with the server's FQDN. At the password prompt, enter the matching ops-vault password. Do not put the password in an argument or shell history.

```sh
psql "host=<server-fqdn> dbname=calendar user=calendar_migrator sslmode=verify-full sslrootcert=system" -W
```

At the `psql` prompt, make sure that the migrator can create and remove a table:

```sql
CREATE TABLE public.t();
DROP TABLE public.t;
\q
```

Connect as the app role:

```sh
psql "host=<server-fqdn> dbname=calendar user=calendar_app sslmode=verify-full sslrootcert=system" -W
```

At the `psql` prompt, make sure that creation fails with `permission denied for schema public`:

```sql
CREATE TABLE public.t();
\q
```

If you created the temporary rule, remove it after the checks:

```sh
az postgres flexible-server firewall-rule delete --resource-group <resource-group> --server-name <server-name> --name calendar-operator-check --yes
```

If initialization reports a PostgreSQL permissions failure, inspect the failure as administrator. Azure owns `public` as `azure_pg_admin`. The administrator can lack rights to revoke `CREATE` from `PUBLIC`. PostgreSQL can report `permission denied for schema public` or `must be owner of schema public`.

One fallback is unverified and requires owner review. It changes schema ownership and depends on Azure allowing the operation. If the owner approves, run `ALTER SCHEMA public OWNER TO calendar_migrator;` as administrator. Rerun initialization and repeat both checks.

To run the role agreement integration test locally, start Docker. From the repository root, run `dotnet run tools/infra/integration/database.cs`. The test compares the tool grants to the local initialization script. It tests access for the migrator, app, and unprivileged role.

## Temporary firewall rules and concurrent operators

Run only one initializer per environment at a time. Do not run initialization during a migration for the same server. Each command removes leftover `calendar-migration-*` rules before it starts. Concurrent commands can remove each other's access.

After writing a secret, initialization tests its latest value and the role state again. These tests do not lock out other operators. If initialization reports concurrent work, stop the other operator. Inspect the vault and roles before retrying.

SIGINT and SIGTERM request cancellation and the tool waits for firewall cleanup. SIGKILL, runner loss, or other abrupt termination can leave a rule behind. Before manual cleanup, make sure that no initialization or migration is running. Replace the placeholders with actual resource names. List the rules, then delete only stale rules:

```sh
az postgres flexible-server firewall-rule list --resource-group <resource-group> --server-name <server-name> --query "[?starts_with(name, 'calendar-migration-')].name" -o tsv
az postgres flexible-server firewall-rule delete --resource-group <resource-group> --server-name <server-name> --name <stale-rule-name> --yes
```
