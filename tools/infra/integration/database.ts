// Run against two disposable, task-owned PostgreSQL containers. No Azure calls are made.
// @deno-types="@types/pg"
import pg from "pg";
import { assertEquals, assertRejects } from "@std/assert";
import { fileURLToPath } from "node:url";
import { applyGrants, createRole } from "../database.ts";

const script = fileURLToPath(new URL("../../../docker/postgres/init/01-roles.sh", import.meta.url));
const image = "postgres:18.6-alpine";
const label = `calendar-infra-integration-${crypto.randomUUID()}`;
const containers: string[] = [];
async function docker(...args: string[]): Promise<string> {
  const result = await new Deno.Command("docker", { args, stdout: "piped", stderr: "piped" }).output();
  if (!result.success) throw new Error(`docker ${args[0]} failed: ${new TextDecoder().decode(result.stderr)}`);
  return new TextDecoder().decode(result.stdout).trim();
}
async function start(reference: boolean): Promise<number> {
  const args = [
    "run",
    "--detach",
    "--rm",
    "--label",
    `calendar.integration=${label}`,
    "--publish",
    "127.0.0.1::5432",
    "--env",
    "POSTGRES_DB=calendar",
    "--env",
    "POSTGRES_PASSWORD=admin-password",
  ];
  if (reference) {
    args.push(
      "--env",
      "CALENDAR_MIGRATOR_PASSWORD=migrator-password",
      "--env",
      "CALENDAR_APP_PASSWORD=app-password",
      "--volume",
      `${script}:/docker-entrypoint-initdb.d/01-roles.sh:ro`,
    );
  }
  const id = await docker(...args, image);
  containers.push(id);
  const endpoint = await docker("port", id, "5432/tcp");
  const port = Number(endpoint.split(":").at(-1));
  if (!Number.isInteger(port) || port < 1) throw new Error("Docker did not provide a database port");
  return port;
}
async function connect(port: number, user = "postgres", password = "admin-password"): Promise<pg.Client> {
  const deadline = Date.now() + 60000;
  while (true) {
    const client = new pg.Client({
      host: "127.0.0.1",
      port,
      user,
      password,
      database: "calendar",
      connectionTimeoutMillis: 2000,
    });
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
const snapshot = "SELECT (SELECT rolcanlogin::text || ',' || rolsuper::text || ',' || rolcreatedb::text || ',' || " +
  "rolcreaterole::text || ',' || rolinherit::text || ',' || rolreplication::text || ',' || " +
  "rolbypassrls::text FROM pg_roles WHERE rolname = 'calendar_migrator') || '|' || (SELECT " +
  "rolcanlogin::text || ',' || rolsuper::text || ',' || rolcreatedb::text || ',' || rolcreaterole::text " +
  "|| ',' || rolinherit::text || ',' || rolreplication::text || ',' || rolbypassrls::text FROM pg_roles " +
  "WHERE rolname = 'calendar_app') || '|' || (SELECT pg_get_userbyid(datdba) || ':' || datacl::text " +
  "FROM pg_database WHERE datname='calendar') || '|' || coalesce((SELECT string_agg(defaclobjtype::text " +
  "|| ':' || defaclacl::text, ',' ORDER BY defaclobjtype) FROM pg_default_acl), '') || '|' || " +
  "has_database_privilege('calendar_app','calendar','CONNECT')::text || '|' || " +
  "has_schema_privilege('calendar_app','public','USAGE')::text || '|' || coalesce((SELECT nspacl::text " +
  "FROM pg_namespace WHERE nspname='public'), '') AS snapshot";
async function main(): Promise<void> {
  const referencePort = await start(true);
  const candidatePort = await start(false);
  const reference = await connect(referencePort);
  const admin = await connect(candidatePort);
  try {
    await createRole(admin, "calendar_migrator", "migrator-password");
    await createRole(admin, "calendar_app", "app-password");
    await applyGrants(admin);
    await applyGrants(admin);
    assertEquals((await admin.query(snapshot)).rows, (await reference.query(snapshot)).rows);
    const migrator = await connect(candidatePort, "calendar_migrator", "migrator-password");
    try {
      await migrator.query("CREATE TABLE public.permission_probe (id integer)");
    } finally {
      await migrator.end();
    }
    const app = await connect(candidatePort, "calendar_app", "app-password");
    try {
      assertEquals((await app.query("INSERT INTO public.permission_probe VALUES (1)")).rowCount, 1);
      assertEquals((await app.query("SELECT count(*) AS n FROM public.permission_probe")).rows[0]?.n, "1");
      assertEquals((await app.query("UPDATE public.permission_probe SET id = 2")).rowCount, 1);
      assertEquals((await app.query("DELETE FROM public.permission_probe")).rowCount, 1);
      const error = await assertRejects(() => app.query("CREATE TABLE public.app_probe (id integer)"));
      assertEquals((error as { code?: string }).code, "42501");
    } finally {
      await app.end();
    }
    await admin.query(
      "CREATE ROLE extra_role LOGIN PASSWORD 'extra-password'; GRANT CONNECT ON DATABASE calendar TO extra_role;",
    );
    const extra = await connect(candidatePort, "extra_role", "extra-password");
    try {
      const error = await assertRejects(() => extra.query("CREATE TABLE public.extra_probe (id integer)"));
      assertEquals((error as { code?: string }).code, "42501");
    } finally {
      await extra.end();
    }
    console.log("PostgreSQL role grants match the local init script; app access and DDL restrictions verified.");
  } finally {
    await reference.end();
    await admin.end();
  }
}
try {
  await main();
} finally {
  for (const id of containers) {
    try {
      const owner = await docker("inspect", "--format", '{{ index .Config.Labels "calendar.integration" }}', id);
      if (owner !== label) {
        console.error(`Refusing to remove container ${id}: ownership label changed`);
        Deno.exitCode = 1;
      } else {
        await docker("rm", "--force", id);
      }
    } catch (error) {
      console.error(`Container cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      Deno.exitCode = 1;
    }
  }
}
