#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run=git
import { dirname, join, resolve } from "@std/path";
import {
  adrFiles,
  checkFile,
  checkModel,
  checkRepository,
  checkStories,
  exists,
  fixLinks,
  inventory,
  nextNumber,
  parseFirstAdded,
  readRecords,
} from "./adr-validator.ts";

function repoRoot(): string {
  for (let path = Deno.cwd();; path = dirname(path)) {
    if (exists(join(path, ".git"))) return path;
    if (dirname(path) === path) return Deno.cwd();
  }
}
export async function main(args: string[]): Promise<number> {
  let fix = false,
    next = false,
    list = false,
    dir: string | undefined,
    modelOption: string | undefined,
    storiesOption: string | undefined;
  const targets: string[] = [], pending = [...args];
  while (pending.length) {
    const arg = pending.shift()!;
    if (arg === "--fix-links") fix = true;
    else if (arg === "--next-number") next = true;
    else if (arg === "--inventory") list = true;
    else if (arg === "--dir" && pending.length) dir = pending.shift();
    else if (arg === "--model" && pending.length) modelOption = resolve(pending.shift()!);
    else if (arg === "--stories" && pending.length) storiesOption = resolve(pending.shift()!);
    else if (["-h", "--help"].includes(arg)) {
      console.log(
        "usage: check-adr [--fix-links] [--next-number] [--inventory] [--dir PATH] [--model PATH] [--stories PATH] [FILE...]",
      );
      return 0;
    } else if (arg.startsWith("-")) {
      console.error(`unknown option: ${arg}`);
      return 2;
    } else targets.push(resolve(arg));
  }
  const decisions = resolve(dir ?? join(repoRoot(), "docs", "decisions"));
  if (!exists(decisions) || !Deno.statSync(decisions).isDirectory) {
    console.error(`decisions directory not found: ${decisions}`);
    return 2;
  }
  if (modelOption && (!exists(modelOption) || !Deno.statSync(modelOption).isFile)) {
    console.error(`architecture model not found: ${modelOption}`);
    return 2;
  }
  if (storiesOption && (!exists(storiesOption) || !Deno.statSync(storiesOption).isDirectory)) {
    console.error(`stories directory not found: ${storiesOption}`);
    return 2;
  }
  const defaultModel = join(dirname(decisions), "architecture", "calendar.architecture.json"),
    defaultStories = join(dirname(decisions), "stories");
  const model = modelOption ?? (exists(defaultModel) ? defaultModel : null),
    stories = storiesOption ?? (exists(defaultStories) ? defaultStories : null),
    files = adrFiles(decisions);
  if (next) {
    console.log(nextNumber(decisions));
    return 0;
  }
  if (list) {
    let firstOnMain: Record<string, string> | null = null;
    try {
      const output = await new Deno.Command("git", {
        args: ["log", "--diff-filter=A", "--format=%cs", "--name-only", "origin/main", "--", "."],
        cwd: decisions,
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (output.success) firstOnMain = parseFirstAdded(new TextDecoder().decode(output.stdout));
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    if (firstOnMain === null) console.error("firstOnMain omitted: git or origin/main is not available");
    console.log(inventory(readRecords(decisions), model, firstOnMain));
    return 0;
  }
  if (!targets.length) targets.push(...[...files.values()].map((f) => join(decisions, f)));
  if (fix) {
    for (const target of targets) {
      const changed = fixLinks(target, files);
      if (changed) console.log(`${target.split("/").at(-1)}: linked ${changed} reference(s)`);
    }
  }
  const records = readRecords(decisions),
    errors = [
      ...checkRepository(decisions),
      ...(model ? checkModel(model, records) : []),
      ...(stories ? checkStories(stories, records) : []),
    ];
  let failed = errors.length > 0;
  for (const error of errors) console.log(`repo: ${error}`);
  for (const target of targets) {
    const result = checkFile(target, files);
    console.log(`${result.ok ? "OK  " : "FAIL"} ${result.fileName}`);
    for (const error of result.errors) console.log(`     - ${error}`);
    failed ||= !result.ok;
  }
  return failed ? 1 : 0;
}
if (import.meta.main) Deno.exit(await main(Deno.args));
