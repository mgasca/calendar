#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run=deno
import { basename, dirname, join, relative, resolve } from "@std/path";
export interface PinnedPackage {
  package: string;
  version: string;
  file: string;
  alias: string;
  specifier: string;
}
export interface VersionDrift {
  pin: PinnedPackage;
  expectedVersion: string;
}
const skipped = new Set(["bin", "obj", "fixtures", "node_modules", ".git", ".deno"]);
export function compareVersions(x: string, y: string): number {
  function split(version: string): [number[], string] {
    const dash = version.indexOf("-"), base = dash < 0 ? version : version.slice(0, dash), parts = base.split(".");
    return parts.every((p) => /^\d+$/.test(p))
      ? [parts.map(Number), dash < 0 ? "" : version.slice(dash + 1)]
      : [[], version];
  }
  const [a, aLabel] = split(x), [b, bLabel] = split(y);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return Math.sign(difference);
  }
  if (!aLabel || !bLabel) return Number(!aLabel) - Number(!bLabel);
  return aLabel < bLabel ? -1 : aLabel > bLabel ? 1 : 0;
}
function* walk(directory: string): Generator<string> {
  let entries: Deno.DirEntry[];
  try {
    entries = [...Deno.readDirSync(directory)];
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (skipped.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory) yield* walk(path);
    else if (entry.isFile && entry.name === "deno.json") yield path;
  }
}
export function findPins(root: string): PinnedPackage[] {
  const pins: PinnedPackage[] = [];
  for (const directory of [".claude/skills", "tools"]) {
    for (const path of walk(join(root, directory))) {
      const config: { imports?: Record<string, string>; tasks?: Record<string, string | { command: string }> } = JSON
        .parse(Deno.readTextFileSync(path));
      const dependencies = Object.entries(config.imports ?? {});
      for (const [task, value] of Object.entries(config.tasks ?? {})) {
        const command = typeof value === "string" ? value : value.command;
        for (const match of command.matchAll(/(?:jsr:|npm:)(?:@[^\s/@]+\/)?[^\s/@]+@[^\s"']+/g)) {
          dependencies.push([`task:${task}`, match[0]]);
        }
      }
      for (const [alias, specifier] of dependencies) {
        const match = /^(jsr:|npm:)((?:@[^/@]+\/)?[^/@]+)@(\d+\.\d+\.\d+(?:-[\w.-]+)?)(\/.*)?$/.exec(specifier);
        if (!match) {
          if (/^(jsr:|npm:)/.test(specifier)) {
            throw new Error(
              `${relative(root, path)} import '${alias}' must use an exact package version: ${specifier}`,
            );
          }
          continue;
        }
        pins.push({
          package: match[1]! + match[2]!,
          version: match[3]!,
          file: relative(root, path).replaceAll("\\", "/"),
          alias,
          specifier,
        });
      }
    }
  }
  return pins;
}
export function newestVersions(pins: PinnedPackage[]): Map<string, string> {
  const versions = new Map<string, string>();
  for (const pin of pins) {
    const previous = versions.get(pin.package);
    if (!previous || compareVersions(pin.version, previous) > 0) versions.set(pin.package, pin.version);
  }
  return versions;
}
export function findDrift(pins: PinnedPackage[]): VersionDrift[] {
  const newest = newestVersions(pins);
  return pins.filter((p) => newest.get(p.package) !== p.version).map((pin) => ({
    pin,
    expectedVersion: newest.get(pin.package)!,
  }));
}
export function fix(root: string, drifts: VersionDrift[]): { changed: number; configs: string[] } {
  let changed = 0;
  const configs = [...new Set(drifts.map((d) => d.pin.file))];
  for (const file of configs) {
    const path = join(root, file);
    let text = Deno.readTextFileSync(path);
    for (const drift of drifts.filter((d) => d.pin.file === file)) {
      const newSpecifier = drift.pin.specifier.replace(`@${drift.pin.version}`, `@${drift.expectedVersion}`);
      const specifier = drift.pin.specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const updated = text.replace(new RegExp(`${specifier}(?![\\w.-])`, "g"), () => newSpecifier);
      if (updated !== text) {
        changed++;
        text = updated;
      }
    }
    Deno.writeTextFileSync(path, text);
  }
  return { changed, configs };
}
export function repoRoot(): string {
  for (let path = Deno.cwd();; path = dirname(path)) {
    try {
      Deno.statSync(join(path, ".git"));
      return path;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    if (dirname(path) === path) return Deno.cwd();
  }
}
export async function main(args: string[]): Promise<number> {
  let apply = false, root: string | undefined;
  const pending = [...args];
  while (pending.length) {
    const arg = pending.shift();
    if (arg === "--fix") apply = true;
    else if (arg === "--root" && pending.length) root = resolve(pending.shift()!);
    else {
      console.error(`unknown argument: ${arg}\nusage: tool-versions [--fix] [--root PATH]`);
      return 2;
    }
  }
  root ??= repoRoot();
  let pins: PinnedPackage[];
  try {
    pins = findPins(root);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const drifts = findDrift(pins);
  for (const pin of pins) {
    const drift = drifts.find((d) => d.pin === pin);
    console.log(
      drift
        ? `DRIFT ${pin.package} ${pin.version} in ${pin.file}; another tool pins ${drift.expectedVersion}`
        : `OK    ${pin.package} ${pin.version} in ${pin.file}`,
    );
  }
  if (!drifts.length) return 0;
  if (apply) {
    const { changed, configs } = fix(root, drifts);
    for (const config of configs) {
      const output = await new Deno.Command(Deno.execPath(), {
        args: ["install", "--config", basename(config), "--frozen=false"],
        cwd: join(root, dirname(config)),
        stdout: "inherit",
        stderr: "inherit",
      }).output();
      if (!output.success) {
        console.error(`Lockfile refresh failed for ${config}; dependency edits remain for inspection.`);
        return 1;
      }
    }
    console.log(
      `Updated ${changed} pin(s) and refreshed affected deno.lock files. Run 'just tools test', then commit.`,
    );
    return 0;
  }
  console.log(
    `${drifts.length} pin(s) are behind the newest version pinned by another tool. Fix with: just tools versions --fix`,
  );
  return 1;
}
if (import.meta.main) Deno.exit(await main(Deno.args));
