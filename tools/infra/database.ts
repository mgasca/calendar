// @deno-types="@types/pg"
import pg from "pg";
import { isIP } from "node:net";
import { resolve } from "node:path";
import type { Azure } from "./process.ts";
import { execute } from "./process.ts";
import {
  concurrent,
  passwordName,
  randomPassword,
  resourceName,
  secretNames,
  standardInputPath,
  validateEnvironment,
  vaultName,
  type Write,
} from "./common.ts";
export const recovery =
  "Vault and server disagree. Coordinate manual recovery: set the role password as owner, store the " +
  "same password in the ops vault, and update the app connection string when applicable; or drop the " +
  "role only if it owns nothing. See docs/runbooks/azure-database.md.";
export const grantsSql =
  "ALTER DATABASE calendar OWNER TO calendar_migrator; REVOKE ALL ON DATABASE calendar FROM PUBLIC; " +
  "GRANT CONNECT ON DATABASE calendar TO CURRENT_USER; GRANT CONNECT ON DATABASE calendar TO " +
  "calendar_app; REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE, CREATE ON SCHEMA public TO " +
  "calendar_migrator; GRANT USAGE ON SCHEMA public TO calendar_app; ALTER DEFAULT PRIVILEGES FOR ROLE " +
  "calendar_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO calendar_app; " +
  "ALTER DEFAULT PRIVILEGES FOR ROLE calendar_migrator IN SCHEMA public GRANT USAGE, SELECT ON " +
  "SEQUENCES TO calendar_app;";
export async function createRole(client: pg.Client, role: string, password: string): Promise<void> {
  const result = await client.query<{ sql: string }>(
    "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS sql",
    [role, password],
  );
  const sql = result.rows[0]?.sql;
  if (!sql) throw new Error("Unable to create role.");
  await client.query(sql);
}
export async function applyGrants(client: pg.Client): Promise<void> {
  await client.query(grantsSql);
}
export async function reconcileRole(
  exists: boolean,
  hasSecret: boolean,
  store: () => Promise<string>,
  read: () => Promise<string>,
  verify: (password: string) => Promise<boolean>,
  create: (password: string) => Promise<void>,
  report: (message: string) => void,
): Promise<string> {
  if (exists && !hasSecret) throw new Error(recovery);
  const written = hasSecret ? undefined : await store();
  const password = await read();
  if (written !== undefined && written !== password) throw new Error(concurrent);
  if (exists) {
    if (!await verify(password)) throw new Error(recovery);
    report("existing credential verified.");
  } else {
    await create(password);
    report("created.");
  }
  return password;
}
export async function confirmCreationState(
  roleExists: () => Promise<boolean>,
  readSecret: () => Promise<string>,
  expected: string,
): Promise<void> {
  if (await roleExists() || await readSecret() !== expected) throw new Error(concurrent);
}
export function checkConnectionSecret(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error("Existing app connection string differs from the expected value. " + recovery);
  }
}
// Npgsql-compatible values preserve the persisted app secret and Rust migrator input.
function quote(value: string): string {
  if (value.includes('"') && !value.includes("'")) return "'" + value + "'";
  if (/[;="'\r\n\t]/.test(value) || value.trim() !== value) return '"' + value.replaceAll('"', '""') + '"';
  return value;
}
export function connectionString(host: string, role: string, password: string): string {
  return `Host=${quote(host)};Database=calendar;Username=${quote(role)};Password=${
    quote(password)
  };SSL Mode=VerifyFull`;
}
export async function readSecret(az: Azure, vault: string, name: string, _output: Write): Promise<string> {
  const value = await az.run(
    "keyvault",
    "secret",
    "show",
    "--vault-name",
    vault,
    "--name",
    name,
    "--query",
    "value",
    "-o",
    "tsv",
  );
  return value;
}
export async function storeSecret(
  az: Azure,
  vault: string,
  name: string,
  value: string,
  output: Write = () => {},
): Promise<void> {
  await az.runWithInput(
    value,
    "keyvault",
    "secret",
    "set",
    "--vault-name",
    vault,
    "--name",
    name,
    "--file",
    standardInputPath,
    "--output",
    "none",
  );
  if (await readSecret(az, vault, name, output) !== value) throw new Error(concurrent);
}
export async function storeNewSecret(
  az: Azure,
  vault: string,
  name: string,
  value: string,
  output: Write,
): Promise<void> {
  if ((await secretNames(az, vault, false)).some((n) => n.toLowerCase() === name.toLowerCase())) {
    throw new Error(concurrent);
  }
  await storeSecret(az, vault, name, value, output);
}
async function deleteFirewall(az: Azure, group: string, server: string, rule: string): Promise<void> {
  try {
    await az.runCleanup(
      "postgres",
      "flexible-server",
      "firewall-rule",
      "delete",
      "--resource-group",
      group,
      "--server-name",
      server,
      "--name",
      rule,
      "--yes",
      "--output",
      "none",
    );
  } catch {
    throw new Error(`Could not remove temporary firewall rule ${rule} from ${server}; remove it manually.`);
  }
}
export async function sweepFirewall(az: Azure, group: string, server: string): Promise<void> {
  const names: unknown = JSON.parse(
    await az.run(
      "postgres",
      "flexible-server",
      "firewall-rule",
      "list",
      "--resource-group",
      group,
      "--server-name",
      server,
      "--query",
      "[].name",
      "-o",
      "json",
    ),
  );
  if (!Array.isArray(names)) throw new Error("Invalid firewall rule list.");
  for (const name of names) {
    if (typeof name === "string" && name.startsWith("calendar-migration-")) {
      await deleteFirewall(az, group, server, name);
    }
  }
}
export async function withFirewall(
  az: Azure,
  group: string,
  server: string,
  ip: string,
  action: () => Promise<void>,
): Promise<void> {
  const rule = "calendar-migration-" + crypto.randomUUID().replaceAll("-", "");
  let failure: unknown;
  try {
    await az.run(
      "postgres",
      "flexible-server",
      "firewall-rule",
      "create",
      "--resource-group",
      group,
      "--server-name",
      server,
      "--name",
      rule,
      "--start-ip-address",
      ip,
      "--end-ip-address",
      ip,
      "--output",
      "none",
    );
    await action();
  } catch (e) {
    failure = e;
    throw e;
  } finally {
    try {
      await deleteFirewall(az, group, server, rule);
    } catch (cleanup) {
      if (failure instanceof Error) {
        Object.assign(failure, { firewallCleanup: cleanup instanceof Error ? cleanup.message : String(cleanup) });
      } else {
        // A failed firewall cleanup is the primary error when the action succeeded.
        // deno-lint-ignore no-unsafe-finally
        throw cleanup;
      }
    }
  }
}
async function prepareServer(az: Azure, env: string, group: string, server: string): Promise<void> {
  const state = await az.run(
    "postgres",
    "flexible-server",
    "show",
    "--resource-group",
    group,
    "--name",
    server,
    "--query",
    "state",
    "-o",
    "tsv",
  );
  if (state === "Stopped" && env === "staging") {
    await az.run(
      "postgres",
      "flexible-server",
      "start",
      "--resource-group",
      group,
      "--name",
      server,
      "--output",
      "none",
    );
  } else if (state !== "Ready") throw new Error("PostgreSQL server is not ready.");
  await az.run(
    "postgres",
    "flexible-server",
    "wait",
    "--resource-group",
    group,
    "--name",
    server,
    "--custom",
    "state=='Ready'",
  );
}
const serverHost = (az: Azure, group: string, server: string) =>
  az.run(
    "postgres",
    "flexible-server",
    "show",
    "--resource-group",
    group,
    "--name",
    server,
    "--query",
    "fullyQualifiedDomainName",
    "-o",
    "tsv",
  );
async function runLocal(
  command: string,
  args: string[],
  directory: string,
  connection?: string,
  signal?: AbortSignal,
): Promise<void> {
  const result = await execute(command, args, {
    cwd: directory,
    signal,
    env: connection === undefined ? {} : { CALENDAR_MIGRATOR_CONNECTION: connection },
  });
  if (result.code !== 0) throw new Error(`Migration command failed (exit ${result.code}).`);
}
async function withClient<T>(
  host: string,
  user: string,
  password: string,
  signal: AbortSignal | undefined,
  action: (client: pg.Client) => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted();
  const client = new pg.Client({
    host,
    user,
    password,
    database: "calendar",
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15000,
    query_timeout: 30000,
  });
  const abort = () => {
    void client.end();
  };
  signal?.addEventListener("abort", abort, { once: true });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    return await action(client);
  } catch (e) {
    signal?.throwIfAborted();
    if (
      !connected || e instanceof pg.DatabaseError ||
      (e instanceof Error && (/timeout|connection.*(?:closed|terminated|reset)/i.test(e.message)))
    ) {
      throw new Error("PostgreSQL operation failed; check connectivity, permissions and server state.");
    }
    throw e;
  } finally {
    signal?.removeEventListener("abort", abort);
    await client.end();
  }
}
async function ensureRole(
  az: Azure,
  client: pg.Client,
  host: string,
  vault: string,
  names: string[],
  role: string,
  secret: string,
  output: Write,
  signal?: AbortSignal,
): Promise<string> {
  const exists = async () =>
    (await client.query<{ exists: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)", [role]))
      .rows[0]?.exists ?? false;
  return await reconcileRole(
    await exists(),
    names.some((n) => n.toLowerCase() === secret.toLowerCase()),
    async () => {
      const password = randomPassword();
      await storeNewSecret(az, vault, secret, password, output);
      return password;
    },
    () => readSecret(az, vault, secret, output),
    async (password) => {
      try {
        await withClient(host, role, password, signal, () => Promise.resolve());
        return true;
      } catch {
        signal?.throwIfAborted();
        return false;
      }
    },
    async (password) => {
      await confirmCreationState(exists, () => readSecret(az, vault, secret, output), password);
      await createRole(client, role, password);
    },
    (message) => output(`${role}: ${message}`),
  );
}
export async function databaseCommand(args: string[], az: Azure, output: Write, signal?: AbortSignal): Promise<number> {
  const init = args[0] === "db";
  const index = init ? 2 : 1;
  const env = args[index];
  if (env === undefined) throw new Error("Specify staging or production.");
  validateEnvironment(env);
  let ip: string;
  if (args.length === index + 3 && args[index + 1] === "--client-ip") ip = args[index + 2]!;
  else if (args.length === index + 1) {
    try {
      const response = await fetch("https://api.ipify.org", {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error();
      }
      ip = (await response.text()).trim();
    } catch {
      signal?.throwIfAborted();
      throw new Error("Unable to detect public IP; pass --client-ip IPv4.");
    }
  } else throw new Error("Use --client-ip IPv4.");
  if (isIP(ip) !== 4 || ip === "0.0.0.0") throw new Error("Client IP must be an IPv4 address.");
  const server = await resourceName(az, env, "Microsoft.DBforPostgreSQL/flexibleServers");
  const group = `rg-calendar-${env}`;
  const ops = await vaultName(az, env, "opsKeyVaultName");
  await prepareServer(az, env, group, server);
  await sweepFirewall(az, group, server);
  if (!init) {
    await runLocal("cargo", ["build", "--release", "--locked", "-p", "calendar-migrate"], "backend", undefined, signal);
    const binary = resolve("backend", "target", "release", "calendar-migrate");
    await withFirewall(az, group, server, ip, async () => {
      const password = await readSecret(az, ops, "calendar-migrator-password", output);
      const connection = connectionString(await serverHost(az, group, server), "calendar_migrator", password);
      if (env === "production") {
        output(`Production restore point (UTC): ${new Date().toISOString().replace("Z", "0000+00:00")}`);
      }
      try {
        await runLocal(binary, [], ".", connection, signal);
      } catch {
        signal?.throwIfAborted();
        throw new Error(
          "The migrator failed; the existing revision keeps serving. Inspect database migration state before retrying.",
        );
      }
    });
    return 0;
  }
  await withFirewall(az, group, server, ip, async () => {
    const host = await serverHost(az, group, server);
    const admin = await readSecret(az, ops, passwordName, output);
    const appVault = await vaultName(az, env, "appKeyVaultName");
    await withClient(host, "calendaradmin", admin, signal, async (client) => {
      const names = await secretNames(az, ops, false);
      await ensureRole(az, client, host, ops, names, "calendar_migrator", "calendar-migrator-password", output, signal);
      const app = await ensureRole(
        az,
        client,
        host,
        ops,
        names,
        "calendar_app",
        "calendar-app-password",
        output,
        signal,
      );
      const expected = connectionString(host, "calendar_app", app);
      if ((await secretNames(az, appVault, false)).some((n) => n.toLowerCase() === "calendar-connection-string")) {
        checkConnectionSecret(await readSecret(az, appVault, "calendar-connection-string", output), expected);
      } else await storeNewSecret(az, appVault, "calendar-connection-string", expected, output);
      signal?.throwIfAborted();
      await applyGrants(client);
      output("Role grants applied.");
    });
  });
  return 0;
}
