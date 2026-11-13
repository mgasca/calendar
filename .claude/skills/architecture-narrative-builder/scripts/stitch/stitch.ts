#!/usr/bin/env -S deno run --allow-read --allow-write
// Stitches docs/narratives/<system>/ parts into docs/narratives/<system>-narrative.md (ADR-0059, story 0063).
//   stitch [SYSTEM...]            stitch the named systems, or every system with parts
//   stitch --check                fail when a stitched narrative differs from a fresh stitch of its parts
//   stitch --remove-parts SYSTEM  build mode: stitch without the generated note, then remove the parts
import { dirname, join, resolve } from "@std/path";
import { hasParts, isSystemName, outputName, type PartFiles, partsToRemove, stitch } from "./narrative.ts";

const usage = "usage: stitch [--root DIR] [--check | --remove-parts SYSTEM | SYSTEM...]";

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function repoRoot(): string {
  for (let path = Deno.cwd();; path = dirname(path)) {
    if (exists(join(path, ".git"))) return path;
    if (dirname(path) === path) return Deno.cwd();
  }
}

function readParts(dir: string): PartFiles {
  const files = new Map<string, string>();
  for (const entry of Deno.readDirSync(dir)) {
    if (entry.isFile && (entry.name.endsWith(".md") || entry.name.endsWith(".mmd"))) {
      files.set(entry.name, Deno.readTextFileSync(join(dir, entry.name)));
    }
  }
  return files;
}

/** Every directory under docs/narratives that holds parts, sorted. */
function systemsWithParts(narratives: string): string[] {
  if (!exists(narratives)) return [];
  return [...Deno.readDirSync(narratives)]
    .filter((entry) => entry.isDirectory && hasParts(readParts(join(narratives, entry.name)).keys()))
    .map((entry) => entry.name)
    .sort();
}

function report(system: string, errors: string[]): void {
  for (const error of errors) console.error(`docs/narratives/${system}/${error}`);
}

export function main(args: string[]): number {
  let root: string | undefined, check = false, remove: string | undefined;
  const systems: string[] = [], pending = [...args];
  while (pending.length) {
    const arg = pending.shift()!;
    if (arg === "--check") check = true;
    else if (arg === "--root" && pending.length) root = resolve(pending.shift()!);
    else if (arg === "--remove-parts" && pending.length) remove = pending.shift();
    else if (arg === "-h" || arg === "--help") {
      console.log(usage);
      return 0;
    } else if (arg.startsWith("-")) {
      console.error(`unknown option: ${arg}\n${usage}`);
      return 2;
    } else systems.push(arg);
  }
  if ([check, remove !== undefined, systems.length > 0].filter(Boolean).length > 1) {
    console.error(usage);
    return 2;
  }
  const narratives = join(root ?? repoRoot(), "docs", "narratives");
  for (const system of [...systems, ...(remove === undefined ? [] : [remove])]) {
    if (!isSystemName(system) || !exists(join(narratives, system))) {
      console.error(`no part directory docs/narratives/${system}/`);
      return 2;
    }
  }

  if (remove !== undefined) {
    const dir = join(narratives, remove), files = readParts(dir), result = stitch(remove, files, { note: false });
    if (!result.ok) return report(remove, result.errors), 1;
    Deno.writeTextFileSync(join(narratives, outputName(remove)), result.text);
    for (const name of partsToRemove(files)) Deno.removeSync(join(dir, name));
    if ([...Deno.readDirSync(dir)].length === 0) Deno.removeSync(dir);
    console.log(`stitched docs/narratives/${outputName(remove)} and removed its parts`);
    return 0;
  }

  let failed = false;
  const targets = systems.length ? systems : systemsWithParts(narratives);
  for (const system of targets) {
    const result = stitch(system, readParts(join(narratives, system)), { note: true });
    if (!result.ok) {
      report(system, result.errors);
      failed = true;
      continue;
    }
    const output = join(narratives, outputName(system));
    if (check) {
      const current = exists(output) ? Deno.readTextFileSync(output) : undefined;
      if (current !== result.text) {
        console.error(
          `docs/narratives/${outputName(system)} ${current === undefined ? "is missing" : "differs from its parts"}: ` +
            `edit docs/narratives/${system}/ and run \`just tools narratives ${system}\``,
        );
        failed = true;
      }
    } else {
      Deno.writeTextFileSync(output, result.text);
      console.log(`stitched docs/narratives/${outputName(system)}`);
    }
  }
  if (check && !failed) console.log(`narratives match their parts (${targets.length} with parts)`);
  return failed ? 1 : 0;
}

if (import.meta.main) Deno.exit(main(Deno.args));
