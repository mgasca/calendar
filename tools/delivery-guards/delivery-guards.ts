#!/usr/bin/env -S deno run --allow-read
import { dirname, join, resolve } from "@std/path";
import { Workflow, YamlScalar } from "./workflow-yaml.ts";
export interface RepoFiles {
  workflow: string;
  toolsJustfile: string;
}
export interface Guard {
  id: string;
  fix: string;
  record: string;
  mechanism: string;
  check(files: RepoFiles): string[];
}
export const workflowPath = ".github/workflows/ci.yml", changesRulesPath = ".github/ci-changes.jq";
export const needsSkipException = '.value.result == "skipped" and $needs.changes.outputs[.key] == "false"';
export const jobsApiSkipException = 'select(.conclusion != "skipped" or (.name | IN($skipped[]) | not))';
const sameRepository = [
  "github.event_name == 'pull_request'",
  "github.event.pull_request.head.repo.full_name == github.repository",
];
export function loadFiles(root: string): RepoFiles {
  return {
    workflow: Deno.readTextFileSync(join(root, workflowPath)),
    toolsJustfile: Deno.readTextFileSync(join(root, "tools/mod.just")),
  };
}
export function justRecipe(text: string, recipe: string): string[] | null {
  const lines = text.replaceAll("\r\n", "\n").split("\n"),
    escaped = recipe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    header = new RegExp(`^@?${escaped}(\\s[^:=]*)?:(?!=)`),
    start = lines.findIndex((line) => header.test(line));
  if (start < 0) return null;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.length && !/^[ \t]/.test(line)) break;
    body.push(line);
  }
  return body;
}
function supersededRuns(files: RepoFiles): string[] {
  const workflow = Workflow.parse(files.workflow),
    group = workflow.root.map("concurrency")?.text("group") ?? "",
    errors: string[] = [];
  for (const part of [...sameRepository, "github.run_id"]) {
    if (!group.includes(part)) {
      errors.push(
        `concurrency.group does not contain \`${part}\`, so a same-repository pull request run shares a group with the run it supersedes and queues until GitHub stops it.`,
      );
    }
  }
  const job = workflow.jobNamed("Cancel superseded runs");
  if (!job) return [...errors, "no job is named `Cancel superseded runs`."];
  const condition = job.body.text("if") ?? "";
  if (
    !sameRepository.every((p) => condition.includes(p)) || condition.includes("!=") ||
    condition.includes("pull_request_target")
  ) {
    errors.push(
      `\`Cancel superseded runs\` does not run only for same-repository pull requests (its \`if\` must require \`${
        sameRepository[0]
      }\` and \`${sameRepository[1]}\`).`,
    );
  }
  const permissions = job.body.map("permissions");
  if (!permissions || permissions.entries.length !== 1 || permissions.text("actions") !== "write") {
    errors.push(
      "`Cancel superseded runs` must have exactly `permissions: actions: write`: it cannot cancel runs without it, and any other scope is more than it needs.",
    );
  }
  if (
    job.steps.some((s) =>
      /^actions\/checkout/i.test(s.text("uses") ?? "") ||
      /\b(git\s+(clone|fetch|checkout|pull|worktree)|gh\s+(repo\s+clone|pr\s+checkout))\b/.test(Workflow.run(s))
    )
  ) {
    errors.push(
      "`Cancel superseded runs` fetches code; with actions: write it must run no code from the pull request.",
    );
  }
  if (!job.steps.some((s) => Workflow.run(s).includes("gh run cancel"))) {
    errors.push("`Cancel superseded runs` has no step that runs `gh run cancel`.");
  }
  return errors;
}
function parallelToolTests(files: RepoFiles): string[] {
  const errors: string[] = [],
    test = justRecipe(files.toolsJustfile, "test"),
    jobs = test?.map((l) => /xargs\s+(?:\S+\s+)*?-P\s*"?\$\{TOOLS_TEST_JOBS:-(\d+)\}"?/.exec(l)).find(Boolean);
  if (!jobs) errors.push('tools/mod.just `test` does not run the test apps with `xargs -P "${TOOLS_TEST_JOBS:-N}"`.');
  else if (Number(jobs[1]) <= 1) {
    errors.push(
      `tools/mod.just \`test\` defaults TOOLS_TEST_JOBS to ${jobs[1]}: the test apps would run one at a time.`,
    );
  }
  const workflow = Workflow.parse(files.workflow);
  for (const [where, value] of workflow.envValues("TOOLS_TEST_JOBS")) {
    if (!/^\d+$/.test(value) || Number(value) <= 1) {
      errors.push(`${where} sets TOOLS_TEST_JOBS to \`${value}\`; it must be a number above 1.`);
    }
  }
  for (const job of workflow.jobs) {
    for (const step of job.steps) {
      for (const m of Workflow.run(step).matchAll(/\bTOOLS_TEST_JOBS=(\d+)/g)) {
        if (Number(m[1]) <= 1) errors.push(`a step runs with \`${m[0]}\`: the test apps would run one at a time.`);
      }
    }
  }
  const tooling = workflow.jobs.find((j) => j.steps.some((s) => Workflow.run(s).includes("just tools test")));
  if (!tooling) return [...errors, "no job runs `just tools test`."];
  const setup = tooling.steps.find((s) => (s.text("uses") ?? "").startsWith("actions/setup-dotnet")),
    settings = setup?.map("with");
  // During coexistence the original NuGet cache remains guarded. Once .NET is removed, Deno cache must replace it.
  const denoCache = tooling.steps.some((s) =>
    (s.text("uses") ?? "").startsWith("actions/cache") && (s.map("with")?.text("key") ?? "").includes("deno") &&
    (s.map("with")?.text("key") ?? "").includes("deno.lock")
  );
  if (
    setup
      ? settings?.text("cache") !== "true" || !(settings?.text("cache-dependency-path") ?? "").includes("tools/")
      : !denoCache
  ) {
    errors.push(
      setup
        ? `the \`${tooling.name}\` job's setup-dotnet step has no NuGet cache keyed on the tools' packages.lock.json files.`
        : `the \`${tooling.name}\` job has no Deno cache keyed on the tools' deno.lock files.`,
    );
  }
  return errors;
}
function ciResultNeedsAll(files: RepoFiles): string[] {
  const workflow = Workflow.parse(files.workflow), result = workflow.jobNamed("CI result"), errors: string[] = [];
  if (!result) return ["no job is named `CI result`."];
  if (!(result.body.text("if") ?? "").includes("always()")) {
    errors.push("`CI result` does not run `if: always()`, so it is skipped, not failed, when a needed job fails.");
  }
  const needs = new Set(
      result.body.list("needs").filter((n): n is YamlScalar => n instanceof YamlScalar).map((n) => n.value),
    ),
    optional = workflow.jobNamed("Cancel superseded runs")?.id;
  for (const job of workflow.jobs) {
    if (job.id !== result.id && job.id !== optional && !needs.has(job.id)) {
      errors.push(
        `\`CI result\` does not need \`${job.id}\` (${job.name}), so the required check can pass without it.`,
      );
    }
  }
  if (optional && needs.has(optional)) {
    errors.push(
      `\`CI result\` needs \`${optional}\`, which is skipped on every run but a same-repository pull request.`,
    );
  }
  const script = result.steps.map(Workflow.run).join("\n");
  if (!script.includes('.result == "success"')) {
    errors.push('`CI result` no longer requires every needed job\'s result to be success (`.result == "success"`).');
  }
  const otherSkips = script.replaceAll(needsSkipException, "").replaceAll(jobsApiSkipException, "");
  if (otherSkips.includes('"skipped"') || otherSkips.includes('!= "failure"')) {
    errors.push(
      `\`CI result\` accepts a job that did not succeed beyond a skip the Changes job intended (\`${needsSkipException}\`).`,
    );
  }
  if (!script.includes("/jobs") || !script.includes('.conclusion != "success"')) {
    errors.push("`CI result` no longer checks the jobs API for jobs that did not succeed (run 42270142424).");
  }
  return errors;
}
function singleWebTypecheck(files: RepoFiles): string[] {
  const frontend = Workflow.parse(files.workflow).jobNamed("Frontend");
  if (!frontend) return ["no job is named `Frontend`."];
  const runs = frontend.steps.map(Workflow.run),
    checks = runs.flatMap((run, i) =>
      run.split("\n").some((l) =>
          l.includes("typecheck") || /(^|[\s;&|(])(npx\s+|pnpm\s+(exec\s+)?)?tsc\b/.test(l) ||
          /\bpnpm\b(?!.*\bexec\b).*\s(run\s+)?build\b/.test(l)
        )
        ? [i]
        : []
    ),
    bundles = runs.flatMap((run, i) =>
      run.split("\n").some((l) => /\bpnpm\b.*\bexec\s+vite\s+build\b/.test(l)) ? [i] : []
    ),
    errors: string[] = [];
  if (checks.length !== 1) {
    errors.push(
      `the Frontend job type-checks in ${checks.length} steps; it must be once, in its typecheck step (a \`pnpm build\` runs \`tsc -b\` again).`,
    );
  }
  if (!bundles.length) errors.push("the Frontend job has no web build step that runs `vite build` alone.");
  else if (checks.length && bundles[0]! < checks[0]!) {
    errors.push("the Frontend job's `vite build` step runs before its typecheck step.");
  }
  return errors;
}
function docsSiteJob(files: RepoFiles): string[] {
  const workflow = Workflow.parse(files.workflow),
    frontend = workflow.jobNamed("Frontend"),
    docs = workflow.jobNamed("Docs site"),
    errors: string[] = [];
  if (!frontend) errors.push("no job is named `Frontend`.");
  else {for (const script of ["typecheck", "test:coverage"]) {
      const steps = frontend.steps.map(Workflow.run).filter((r) => r.includes(script));
      if (!steps.length) errors.push(`the Frontend job has no \`${script}\` step.`);
      else if (!steps.every((r) => r.includes("--filter '!@calendar/docs'"))) {
        errors.push(
          `the Frontend job's \`${script}\` step no longer excludes \`@calendar/docs\`, which the Docs site job runs.`,
        );
      }
    }}
  if (!docs) return [...errors, "no job is named `Docs site`."];
  const checks = docs.steps.map(Workflow.run).filter((r) => r.includes("typecheck"));
  if (!checks.length || !checks.every((r) => r.includes("--noSync"))) {
    errors.push(
      "the Docs site job's typecheck does not pass `--noSync`, so `astro check` repeats the content sync the build ran.",
    );
  }
  return errors;
}
function changesJob(files: RepoFiles): string[] {
  const workflow = Workflow.parse(files.workflow), changes = workflow.jobNamed("Changes"), errors: string[] = [];
  if (!changes) return ["no job is named `Changes`."];
  const condition = changes.body.text("if");
  if (condition !== null) {
    errors.push(
      `\`Changes\` runs only \`if: ${condition}\`; it must run on every event, or every job after it is skipped.`,
    );
  }
  if (!changes.steps.some((s) => Workflow.run(s).includes(`jq -c -f ${changesRulesPath}`))) {
    errors.push(`\`Changes\` does not run \`jq -c -f ${changesRulesPath}\`, the rules the tests check.`);
  }
  const outputs = changes.body.map("outputs"),
    skip = [changes.id, workflow.jobNamed("CI result")?.id, workflow.jobNamed("Cancel superseded runs")?.id];
  for (const job of workflow.jobs.filter((j) => !skip.includes(j.id))) {
    if (!job.body.list("needs").some((n) => n instanceof YamlScalar && n.value === changes.id)) {
      errors.push(`\`${job.name}\` does not need \`${changes.id}\`, so it cannot read whether this run needs it.`);
    }
    const expected = `needs.${changes.id}.outputs.${job.id} == 'true'`;
    if (job.body.text("if") !== expected) {
      errors.push(`\`${job.name}\` must run \`if: ${expected}\`, its own Changes output and nothing else.`);
    }
    if (outputs?.text(job.id) === null || outputs?.text(job.id) === undefined) {
      errors.push(`\`Changes\` has no \`${job.id}\` output for \`${job.name}\`.`);
    }
  }
  if (!outputs?.text("skipped")) {
    errors.push("`Changes` has no `skipped` output, which CI result's jobs API check reads.");
  }
  return errors;
}
export const guards: Guard[] = [
  {
    id: "superseded-runs",
    fix: "#348",
    record: "0008",
    mechanism:
      "A same-repository pull request run has a concurrency group of its own, and the Cancel superseded runs job cancels the older runs.",
    check: supersededRuns,
  },
  {
    id: "parallel-tool-tests",
    fix: "#351",
    record: "0011",
    mechanism:
      "just tools test runs the test apps TOOLS_TEST_JOBS at a time (default above 1), with a dependency cache in the Tooling job.",
    check: parallelToolTests,
  },
  {
    id: "ci-result-needs-all",
    fix: "#368",
    record: "none",
    mechanism:
      "CI result always runs, needs every other job (except Cancel superseded runs) and passes only when each succeeded or was skipped because the Changes job said the run does not need it.",
    check: ciResultNeedsAll,
  },
  {
    id: "single-web-typecheck",
    fix: "#276",
    record: "0006",
    mechanism:
      "The Frontend job type-checks the web app once, in its typecheck step, and its build step is the bundler alone.",
    check: singleWebTypecheck,
  },
  {
    id: "docs-site-job",
    fix: "#274",
    record: "0004",
    mechanism:
      "The docs site is checked in its own Docs site job: Frontend excludes it, and the docs typecheck reuses the build's sync.",
    check: docsSiteJob,
  },
  {
    id: "changes-job",
    fix: "#418",
    record: "0016",
    mechanism:
      "A Changes job runs .github/ci-changes.jq on every run, and each other job but CI result and Cancel superseded runs needs it and runs only when its own output is true.",
    check: changesJob,
  },
];
export function runGuard(guard: Guard, files: RepoFiles): string[] {
  try {
    return guard.check(files);
  } catch (error) {
    if (error instanceof Error) return [`${workflowPath} could not be read: ${error.message}`];
    throw error;
  }
}
export function findRoot(start: string): string | null {
  for (let path = resolve(start);; path = dirname(path)) {
    try {
      if (Deno.statSync(join(path, ".just-version")).isFile) return path;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    if (dirname(path) === path) return null;
  }
}
export function main(args: string[]): number {
  let root: string | null = null;
  const pending = [...args];
  while (pending.length) {
    const arg = pending.shift();
    if (arg === "--root" && pending.length) root = pending.shift()!;
    else {
      console.error("usage: delivery-guards.ts [--root <repo root>]");
      return 2;
    }
  }
  root ??= findRoot(Deno.cwd());
  if (!root) {
    console.error("No repo root (a directory with .just-version) above the current directory; pass --root.");
    return 2;
  }
  const files = loadFiles(root);
  let failed = 0;
  for (const guard of guards) {
    const failures = runGuard(guard, files), record = guard.record === "none" ? "" : `, record ${guard.record}`;
    console.log(`${failures.length ? "FAIL" : "ok  "} ${guard.id} (${guard.fix}${record}): ${guard.mechanism}`);
    for (const failure of failures) console.log(`       ${failure}`);
    if (failures.length) failed++;
  }
  return failed ? 1 : 0;
}
if (import.meta.main) Deno.exit(main(Deno.args));
