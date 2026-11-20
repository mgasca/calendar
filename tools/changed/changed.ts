#!/usr/bin/env -S deno run --allow-read --allow-run=git,jq,just,pnpm
// `just changed` (story 0065, issue #937): runs locally what CI would run for this branch. The changed files go to
// .github/ci-changes.jq (ADR-0046) unchanged, as a complete pull_request listing, so local and CI selection cannot
// disagree; each selected CI job then maps to the local recipes that check the same thing.

export const rulesFile = ".github/ci-changes.jq";

/** One check: a heading and the commands it runs in order, from the repository root. */
export interface Step {
  label: string;
  commands: string[][];
  /** The option that must be given for the step to run; without it the job is reported as selected, not run. */
  optIn?: "--image";
}

/** The justfile parse and format check of the Tooling job, one command per just file. */
export function justfileSteps(justfiles: string[]): Step {
  return {
    label: "justfile and its modules parse and are formatted",
    commands: [
      ["just", "--list", "--list-submodules"],
      ...justfiles.map((file) => ["just", "--fmt", "--check", "--justfile", file]),
    ],
  };
}

const just = (...words: string[]): Step => ({ label: ["just", ...words].join(" "), commands: [["just", ...words]] });

/** CI job id (ci-changes.jq) -> the local recipes that check what the job checks. */
export function recipeMap(justfiles: string[]): Record<string, Step[]> {
  return {
    backend: [just("backend", "lint"), just("backend", "test")],
    frontend: [
      just("frontend", "format-check"),
      just("frontend", "lint"),
      just("frontend", "typecheck"),
      just("frontend", "test"),
    ],
    docs: [just("docs", "architecture"), just("docs", "test"), just("docs", "slides-test"), just("docs", "build")],
    tooling: [
      justfileSteps(justfiles),
      just("tools", "test"),
      just("infra", "integration"),
      just("tools", "versions"),
      just("tools", "adr"),
      just("tools", "narratives", "--check"),
    ],
    adr: [just("tools", "adr")],
    narratives: [just("tools", "narratives", "--check")],
    binding: [{
      label: "pnpm --filter @calendar/e2e test",
      commands: [["pnpm", "--dir", "frontend", "--filter", "@calendar/e2e", "test"]],
    }],
    image: [{ ...just("image", "build"), optIn: "--image" }],
    native: [just("native", "lint"), just("native", "test")],
  };
}

export interface Options {
  base: string;
  dryRun: boolean;
  failFast: boolean;
  image: boolean;
}

export const usage = `Usage: just changed [--dry-run] [--base REF] [--fail-fast] [--image]

Runs the local checks of the CI jobs that this branch's changes select (.github/ci-changes.jq).
  --dry-run    print the plan and its commands without running them
  --base REF   compare with the merge base of HEAD and REF (default origin/main)
  --fail-fast  stop at the first failing check
  --image      also run the Container image job's recipe when it is selected`;

export function parseArgs(args: string[]): Options | { help: true } | { error: string } {
  const options: Options = { base: "origin/main", dryRun: false, failFast: false, image: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--help" || arg === "-h") return { help: true };
    else if (arg === "--dry-run" || arg === "-n") options.dryRun = true;
    else if (arg === "--fail-fast") options.failFast = true;
    else if (arg === "--image") options.image = true;
    else if (arg.startsWith("--base=")) options.base = arg.slice("--base=".length);
    else if (arg === "--base") {
      const value = args[++i];
      if (value === undefined || value.startsWith("-")) return { error: "--base needs a ref" };
      options.base = value;
    } else return { error: `unknown argument: ${arg}` };
  }
  if (options.base === "") return { error: "--base needs a ref" };
  return options;
}

async function capture(command: string, args: string[], cwd: string, stdin?: string): Promise<string> {
  const child = new Deno.Command(command, {
    args,
    cwd,
    stdin: stdin === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  if (stdin !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(stdin));
    await writer.close();
  }
  const output = await child.output();
  const decoder = new TextDecoder();
  if (!output.success) {
    throw new Error(`${command} ${args.join(" ")} failed: ${decoder.decode(output.stderr).trim()}`);
  }
  return decoder.decode(output.stdout);
}

const nulSplit = (text: string) => text.split("\0").filter((part) => part !== "");

/**
 * Every path that differs from the merge base of HEAD and `baseRef`: committed, staged and unstaged changes (deleted
 * files included), untracked files git does not ignore, and both paths of a rename, as CI lists them.
 */
export async function changedFiles(root: string, baseRef: string): Promise<{ base: string; files: string[] }> {
  const base = (await capture("git", ["merge-base", "HEAD", baseRef], root)).trim();
  const diff = nulSplit(await capture("git", ["diff", "--name-status", "-z", "-M", base], root));
  const files = new Set<string>();
  for (let i = 0; i < diff.length;) {
    const status = diff[i++]!;
    const paths = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    for (let p = 0; p < paths && i < diff.length; p++) files.add(diff[i++]!);
  }
  for (const file of nulSplit(await capture("git", ["ls-files", "--others", "--exclude-standard", "-z"], root))) {
    files.add(file);
  }
  return { base, files: [...files].sort() };
}

export interface Job {
  id: string;
  name: string;
  selected: boolean;
}

async function runRules(root: string, rules: string, files: string[]): Promise<Record<string, unknown>> {
  const input = JSON.stringify({ event: "pull_request", complete: true, files });
  return JSON.parse(await capture("jq", ["-c", "-f", rules], root, input));
}

/**
 * The CI jobs, in the rules' order, with their names and whether `files` select them. The names come from a probe
 * listing that selects nothing, whose `skipped` array names every job, so this tool keeps no copy of the job list.
 */
export async function selectJobs(root: string, files: string[], rules = rulesFile): Promise<Job[]> {
  const probe = await runRules(root, rules, ["\0 no such path"]);
  const ids = Object.keys(probe).filter((key) => key !== "skipped");
  const names = probe.skipped;
  if (!Array.isArray(names) || names.length !== ids.length) {
    throw new Error(`${rules}: a listing that changes nothing should skip every job`);
  }
  const result = await runRules(root, rules, files);
  return ids.map((id, i) => ({ id, name: String(names[i]), selected: result[id] === true }));
}

/** Job ids the rules name that the recipe map lacks, and map entries for jobs the rules no longer have. */
export function mappingGaps(jobs: Job[], map: Record<string, Step[]>): { unmapped: string[]; stale: string[] } {
  const ids = new Set(jobs.map((job) => job.id));
  return {
    unmapped: jobs.filter((job) => !(job.id in map)).map((job) => `${job.id} (${job.name})`),
    stale: Object.keys(map).filter((id) => !ids.has(id)),
  };
}

export interface PlannedJob extends Job {
  steps: Step[];
  /** Selected steps that need an option that was not given. */
  held: Step[];
}

export function plan(jobs: Job[], map: Record<string, Step[]>, options: Pick<Options, "image">): PlannedJob[] {
  const seen = new Set<string>();
  return jobs.map((job) => {
    const steps: Step[] = [], held: Step[] = [];
    if (job.selected) {
      for (const step of map[job.id] ?? []) {
        if (step.optIn === "--image" && !options.image) held.push(step);
        else if (!seen.has(step.label)) {
          seen.add(step.label);
          steps.push(step);
        }
      }
    }
    return { ...job, steps, held };
  });
}

export function describePlan(base: { ref: string; sha: string }, files: string[], planned: PlannedJob[]): string[] {
  const lines = [`Compared with ${base.ref} (merge base ${base.sha.slice(0, 12)}): ${files.length} changed file(s)`];
  const width = Math.max(...planned.map((job) => job.name.length));
  for (const job of planned) {
    const state = !job.selected
      ? "skipped"
      : job.steps.length === 0 && job.held.length > 0
      ? `selected, not run (${job.held[0]!.optIn} to run)`
      : "runs";
    lines.push(`  ${job.name.padEnd(width)}  ${state}`);
  }
  if (!planned.some((job) => job.selected)) lines.push("No CI job would run for these changes.");
  return lines;
}

export type Runner = (command: string[]) => Promise<boolean>;

export const inheritRunner = (root: string): Runner => async ([command, ...args]) =>
  (await new Deno.Command(command!, { args, cwd: root, stdin: "null", stdout: "inherit", stderr: "inherit" }).output())
    .success;

export interface StepResult {
  job: string;
  label: string;
  passed: boolean;
}

/** Runs every planned step (or up to the first failure with failFast); a step fails at its first failing command. */
export async function runPlan(
  planned: PlannedJob[],
  run: Runner,
  options: Pick<Options, "failFast">,
  log: (line: string) => void,
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const job of planned) {
    for (const step of job.steps) {
      log(`\n==> ${job.name}: ${step.label}`);
      let passed = true;
      for (const command of step.commands) {
        if (!await run(command)) {
          passed = false;
          break;
        }
      }
      results.push({ job: job.name, label: step.label, passed });
      if (!passed && options.failFast) return results;
    }
  }
  return results;
}

export function describeResults(results: StepResult[], planned: PlannedJob[]): string[] {
  const failed = results.filter((result) => !result.passed);
  const notRun = planned.flatMap((job) => job.steps.map((step) => `${job.name}: ${step.label}`))
    .filter((label) => !results.some((result) => `${result.job}: ${result.label}` === label));
  const lines = ["", `Summary: ${results.length - failed.length} passed, ${failed.length} failed`];
  for (const result of results) lines.push(`  ${result.passed ? "pass" : "FAIL"}  ${result.job}: ${result.label}`);
  for (const label of notRun) lines.push(`  not run  ${label}`);
  return lines;
}

export async function main(
  args: string[],
  root: string,
  run: Runner = inheritRunner(root),
  rules = rulesFile,
): Promise<number> {
  const parsed = parseArgs(args);
  if ("help" in parsed) {
    console.log(usage);
    return 0;
  }
  if ("error" in parsed) {
    console.error(`just changed: ${parsed.error}\n\n${usage}`);
    return 2;
  }
  const { base, files } = await changedFiles(root, parsed.base);
  const jobs = await selectJobs(root, files, rules);
  const justfiles = nulSplit(await capture("git", ["ls-files", "-z", "justfile", "*.just"], root));
  const map = recipeMap(justfiles);
  const gaps = mappingGaps(jobs, map);
  if (gaps.unmapped.length > 0 || gaps.stale.length > 0) {
    if (gaps.unmapped.length > 0) {
      console.error(`just changed: ${rules} has jobs with no local recipes: ${gaps.unmapped.join(", ")}`);
    }
    if (gaps.stale.length > 0) {
      console.error(`just changed: local recipes for jobs ${rules} no longer has: ${gaps.stale.join(", ")}`);
    }
    console.error("Update recipeMap in tools/changed/changed.ts.");
    return 1;
  }
  const planned = plan(jobs, map, parsed);
  for (const line of describePlan({ ref: parsed.base, sha: base }, files, planned)) console.log(line);
  if (parsed.dryRun) {
    for (const job of planned) {
      for (const step of job.steps) {
        for (const command of step.commands) console.log(`  [${job.name}] ${command.join(" ")}`);
      }
    }
    return 0;
  }
  const results = await runPlan(planned, run, parsed, (line) => console.log(line));
  for (const line of describeResults(results, planned)) console.log(line);
  return results.every((result) => result.passed) ? 0 : 1;
}

if (import.meta.main) {
  const root = (await capture("git", ["rev-parse", "--show-toplevel"], Deno.cwd())).trim();
  Deno.exit(await main(Deno.args, root));
}
