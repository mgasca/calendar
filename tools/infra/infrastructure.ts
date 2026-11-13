import { isIP } from "node:net";
import type { Azure } from "./process.ts";
import {
  maskSecret,
  passwordName,
  randomPassword,
  resourceName,
  secretNames,
  standardInputPath,
  sweepStaleFiles,
  validateEnvironment,
  vaultName,
  withPrivateFile,
  type Write,
} from "./common.ts";
import { databaseCommand } from "./database.ts";
export function ipRange(value: string): { startIpAddress: string; endIpAddress: string } {
  const parts = value.split("/");
  const prefix = parts.length === 2 ? Number(parts[1]) : 32;
  if (
    parts.length > 2 || isIP(parts[0] ?? "") !== 4 || !Number.isInteger(prefix) || prefix < 0 || prefix > 32 ||
    (parts.length === 2 && !/^\s*[+-]?\d+\s*$/.test(parts[1]!))
  ) throw new Error("Allowed firewall addresses must be IPv4 addresses or IPv4 CIDRs (0–32).");
  const number = parts[0]!.split(".").reduce((n, part) => (n * 256 + Number(part)) >>> 0, 0);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const address = (n: number) => [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join(".");
  return { startIpAddress: address(number & mask), endIpAddress: address(number | ~mask) };
}
function sensitive(name: string) {
  return /secret|password|credential|token/i.test(name);
}
export function safePreview(json: string): string {
  const node: unknown = JSON.parse(json);
  if (node === null) throw new Error("Invalid what-if result.");
  function redact(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(redact);
    if (value !== null && typeof value === "object") {
      const object = value as Record<string, unknown>;
      if (["path", "propertyName"].some((key) => typeof object[key] === "string" && sensitive(object[key] as string))) {
        return { redacted: true };
      }
      return Object.fromEntries(
        Object.entries(object).map(([key, child]) => [key, sensitive(key) ? "[redacted]" : redact(child)]),
      );
    }
    return value;
  }
  return JSON.stringify(redact(node), null, 2);
}
const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function run(
  args: string[],
  az: Azure,
  output: Write,
  error: Write,
  signal?: AbortSignal,
): Promise<number> {
  try {
    sweepStaleFiles();
    if (args[0] === "migrate" || (args[0] === "db" && args[1] === "init-roles")) {
      return await databaseCommand(args, az, output, signal);
    }
    if (args.length < 2) {
      throw new Error(
        "Usage: deploy|what-if ENV [--phase foundation|full], db start|stop staging, or secret init-postgres-password ENV",
      );
    }
    if (args[0] === "db") {
      if (args.length !== 3 || !["start", "stop"].includes(args[1]!) || args[2] !== "staging") {
        throw new Error("db start|stop requires staging.");
      }
      const server = await resourceName(az, "staging", "Microsoft.DBforPostgreSQL/flexibleServers");
      await az.run(
        "postgres",
        "flexible-server",
        args[1]!,
        "--resource-group",
        "rg-calendar-staging",
        "--name",
        server,
        "--output",
        "none",
      );
      return 0;
    }
    if (args[0] === "secret") {
      if (args.length !== 3 || args[1] !== "init-postgres-password") throw new Error("Invalid secret command.");
      validateEnvironment(args[2]!);
      const vault = await vaultName(az, args[2]!, "opsKeyVaultName");
      if ((await secretNames(az, vault, false)).some((n) => n.toLowerCase() === passwordName)) {
        throw new Error("Password already exists; coordinated manual rotation is required.");
      }
      const password = randomPassword();
      maskSecret(output, password);
      await az.runWithInput(
        password,
        "keyvault",
        "secret",
        "set",
        "--vault-name",
        vault,
        "--name",
        passwordName,
        "--file",
        standardInputPath,
        "--output",
        "none",
      );
      output("PostgreSQL password stored in Key Vault.");
      return 0;
    }
    if (args[0] !== "deploy" && args[0] !== "what-if") throw new Error("Unknown command.");
    const env = args[1]!;
    validateEnvironment(env);
    let phase = "full";
    const allowedIps = (Deno.env.get("AZURE_ALLOWED_IPS") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    for (let i = 2; i < args.length; i += 2) {
      const option = args[i];
      const value = args[i + 1];
      if (value !== undefined && option === "--phase") phase = value;
      else if (value !== undefined && option === "--allow-ip") allowedIps.push(value);
      else throw new Error("Use --phase foundation|full and repeatable --allow-ip CIDR.");
    }
    if (phase !== "foundation" && phase !== "full") throw new Error("Invalid phase; use foundation or full.");
    allowedIps.forEach(ipRange);
    const clientId = (Deno.env.get("AZURE_DEPLOYER_CLIENT_ID") ?? "").trim().replace(/^\{(.*)\}$/, "$1");
    if (!guidPattern.test(clientId)) {
      throw new Error("Set AZURE_DEPLOYER_CLIENT_ID to the environment's deployment identity client ID (GUID).");
    }
    const principalId = await az.run(
      "rest",
      "--method",
      "get",
      "--url",
      `https://graph.microsoft.com/v1.0/servicePrincipals(appId='${clientId.toLowerCase()}')`,
      "--query",
      "id",
      "-o",
      "tsv",
    );
    if (!guidPattern.test(principalId)) throw new Error("Azure returned an invalid deployment principal object ID.");
    const compiled: unknown = JSON.parse(
      await az.run("bicep", "build-params", "--file", `infra/parameters/${env}.bicepparam`, "--stdout"),
    );
    if (
      !compiled || typeof compiled !== "object" || !("parametersJson" in compiled) ||
      typeof compiled.parametersJson !== "string"
    ) throw new Error("Invalid Bicep compiler output.");
    const parsed: unknown = JSON.parse(compiled.parametersJson);
    if (
      !parsed || typeof parsed !== "object" || !("parameters" in parsed) || !parsed.parameters ||
      typeof parsed.parameters !== "object" || Array.isArray(parsed.parameters)
    ) throw new Error("Invalid compiled parameters.");
    const parameters = parsed.parameters as Record<string, unknown>;
    parameters.deployDatabaseAndApp = { value: phase === "full" };
    parameters.allowedFirewallIps = { value: [...new Set(allowedIps)].sort().map(ipRange) };
    parameters.deployerPrincipalId = { value: principalId };
    const image = Deno.env.get("CALENDAR_CONTAINER_IMAGE");
    if (image?.trim()) parameters.containerImage = { value: image };
    else if (!("containerImage" in parameters)) {
      parameters.containerImage = { value: "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest" };
    }
    if (phase === "full") {
      const vault = await vaultName(az, env, "opsKeyVaultName");
      if (!(await secretNames(az, vault, false)).some((n) => n.toLowerCase() === passwordName)) {
        throw new Error("Postgres password missing; owner must run secret init-postgres-password first.");
      }
      const id = await az.run("keyvault", "show", "--name", vault, "--query", "id", "-o", "tsv");
      if (
        !/^\/subscriptions\/[0-9a-fA-F-]{36}\/resourceGroups\/[A-Za-z0-9._()-]+\/providers\/Microsoft\.KeyVault\/vaults\/[A-Za-z0-9-]+$/
          .test(id)
      ) throw new Error("Azure returned an invalid Key Vault resource ID.");
      parameters.postgresAdministratorPassword = { reference: { keyVault: { id }, secretName: passwordName } };
      parameters.keyVaultSecretNames = {
        value: await secretNames(az, await vaultName(az, env, "appKeyVaultName"), true),
      };
    }
    await withPrivateFile(JSON.stringify({ parameters }), async (path) => {
      const command = [
        "deployment",
        "group",
        args[0] === "deploy" ? "create" : "what-if",
        "--resource-group",
        `rg-calendar-${env}`,
        "--template-file",
        "infra/main.bicep",
        "--parameters",
        "@" + path,
        "--no-prompt",
      ];
      if (phase === "foundation") command.push("--name", "calendar-foundation");
      if (args[0] === "what-if") command.push("--no-pretty-print", "-o", "json");
      const result = await az.run(...command);
      if (args[0] === "what-if") output(safePreview(result));
    });
    return 0;
  } catch (e) {
    const failure = e instanceof Error ? e : new Error(String(e));
    error(signal?.aborted ? "Operation cancelled." : failure.message);
    if ("firewallCleanup" in failure) error(String(failure.firewallCleanup));
    return 1;
  }
}
