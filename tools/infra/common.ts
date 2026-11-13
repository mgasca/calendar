import { isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import type { Azure } from "./process.ts";
export type Write = (line: string) => void;
export const passwordName = "postgres-admin-password";
export const standardInputPath = "/dev/stdin";
export const concurrent = "Concurrent initialization detected; stop other operators and retry.";
export function validateEnvironment(env: string): void {
  if (env !== "staging" && env !== "production") throw new Error("Environment must be staging or production.");
}
export async function resourceName(az: Azure, env: string, type: string): Promise<string> {
  const names: unknown = JSON.parse(
    await az.run(
      "resource",
      "list",
      "--resource-group",
      `rg-calendar-${env}`,
      "--resource-type",
      type,
      "--query",
      "[].name",
      "-o",
      "json",
    ),
  );
  if (!Array.isArray(names) || names.length !== 1 || typeof names[0] !== "string") {
    throw new Error(`Expected exactly one ${type} resource in rg-calendar-${env}.`);
  }
  return names[0];
}
export async function vaultName(az: Azure, env: string, name: string): Promise<string> {
  const value = await az.run(
    "deployment",
    "group",
    "show",
    "--resource-group",
    `rg-calendar-${env}`,
    "--name",
    "calendar-foundation",
    "--query",
    `properties.outputs.${name}.value`,
    "-o",
    "tsv",
  );
  if (!value.trim() || value === "null") throw new Error("Foundation vault output missing; deploy foundation first.");
  return value;
}
export async function secretNames(az: Azure, vault: string, appOnly: boolean): Promise<string[]> {
  const entries: unknown = JSON.parse(
    await az.run(
      "keyvault",
      "secret",
      "list",
      "--vault-name",
      vault,
      "--query",
      "[].{id:id,enabled:attributes.enabled}",
      "-o",
      "json",
    ),
  );
  if (!Array.isArray(entries)) throw new Error("Invalid Key Vault secret list.");
  return [
    ...new Set(
      entries.filter((entry) => !appOnly || entry?.enabled === true).map((entry) =>
        String(entry?.id ?? "").split("/").at(-1) ?? ""
      )
        .filter((name) =>
          !appOnly || ["calendar-connection-string", "google-client-id", "google-client-secret"].includes(name) ||
          /^allowed-email-[0-9]+$/.test(name)
        ),
    ),
  ].sort();
}
export function randomPassword(): string {
  return "Aa1!" + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(48))));
}
export function runtimeDirectory(): string {
  if (Deno.build.os === "windows") throw new Error("Infrastructure tooling requires Linux or WSL.");
  const runtime = Deno.env.get("XDG_RUNTIME_DIR");
  let parent: string | undefined;
  if (runtime?.trim() && isAbsolute(runtime)) {
    try {
      if (Deno.statSync(runtime).isDirectory) parent = runtime;
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }
  parent ??= join(homedir(), ".cache");
  const directory = join(parent, "calendar-infra-private");
  Deno.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = Deno.lstatSync(directory);
  if (info.isSymlink || (info.mode! & 0o7777) !== 0o700) {
    throw new Error("Infrastructure runtime directory must be private (0700) and not a symlink.");
  }
  return directory;
}
export function sweepStaleFiles(): void {
  const directory = runtimeDirectory();
  for (const entry of Deno.readDirSync(directory)) {
    const path = join(directory, entry.name);
    if (
      entry.isFile && entry.name.startsWith("calendar-infra-") &&
      (Deno.statSync(path).mtime?.getTime() ?? Infinity) < Date.now() - 86400000
    ) Deno.removeSync(path);
  }
}
export async function withPrivateFile(data: string, action: (path: string) => Promise<void>): Promise<void> {
  const path = join(runtimeDirectory(), "calendar-infra-" + crypto.randomUUID().replaceAll("-", ""));
  try {
    const file = await Deno.open(path, { createNew: true, write: true, mode: 0o600 });
    try {
      const bytes = new TextEncoder().encode(data);
      let offset = 0;
      while (offset < bytes.length) offset += await file.write(bytes.subarray(offset));
    } finally {
      file.close();
    }
    await action(path);
  } finally {
    try {
      await Deno.remove(path);
    } catch (e) {
      // Cleanup errors must be reported rather than leaving a private file behind.
      // deno-lint-ignore no-unsafe-finally
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }
}
