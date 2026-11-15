import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import {
  changedFiles,
  describePlan,
  describeResults,
  type Job,
  main,
  mappingGaps,
  parseArgs,
  plan,
  recipeMap,
  rulesFile,
  runPlan,
  selectJobs,
  type Step,
} from "../changed.ts";

const repoRoot = resolve(dirname(fromFileUrl(import.meta.url)), "../../..");

function git(cwd: string, ...args: string[]): void {
  const output = new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" }).outputSync();
  if (!output.success) throw new Error(`git ${args.join(" ")}: ${new TextDecoder().decode(output.stderr)}`);
}

function write(root: string, path: string, text = `${path}\n`): void {
  Deno.mkdirSync(dirname(join(root, path)), { recursive: true });
  Deno.writeTextFileSync(join(root, path), text);
}

/** A throwaway repository whose origin/main has `files` committed and whose HEAD is a branch off it. */
async function repository(files: string[], run: (root: string) => Promise<void>): Promise<void> {
  const root = Deno.makeTempDirSync({ prefix: "changed-" });
  try {
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.name", "Test");
    git(root, "config", "user.email", "test@example.invalid");
    git(root, "config", "commit.gpgsign", "false");
    for (const file of files) write(root, file);
    write(root, ".gitignore", ".plan/\n");
    write(root, rulesFile, Deno.readTextFileSync(join(repoRoot, rulesFile)));
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base");
    git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(root, "switch", "-q", "-c", "topic");
    await run(root);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
}

async function jq(files: string[]): Promise<Record<string, unknown>> {
  const child = new Deno.Command("jq", {
    args: ["-c", "-f", rulesFile],
    cwd: repoRoot,
    stdin: "piped",
    stdout: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify({ event: "pull_request", complete: true, files })));
  await writer.close();
  const output = await child.output();
  assert(output.success, "jq must be installed (just doctor checks it)");
  return JSON.parse(new TextDecoder().decode(output.stdout));
}

const selected = (jobs: Job[]) => jobs.filter((job) => job.selected).map((job) => job.id);

Deno.test("parseArgs reads every option and rejects unknown ones", () => {
  assertEquals(parseArgs([]), { base: "origin/main", dryRun: false, failFast: false, image: false });
  assertEquals(parseArgs(["-n", "--base", "feature", "--fail-fast", "--image"]), {
    base: "feature",
    dryRun: true,
    failFast: true,
    image: true,
  });
  assertEquals(parseArgs(["--base=other"]), { base: "other", dryRun: false, failFast: false, image: false });
  assertEquals(parseArgs(["--base"]), { error: "--base needs a ref" });
  assertEquals(parseArgs(["--base", "--dry-run"]), { error: "--base needs a ref" });
  assertEquals(parseArgs(["--base="]), { error: "--base needs a ref" });
  assertEquals(parseArgs(["build"]), { error: "unknown argument: build" });
  assertEquals(parseArgs(["--help"]), { help: true });
});

for (
  const files of [
    ["docs/stories/0065-a.md"],
    ["backend/crates/calendar-api/src/app.rs"],
    ["tools/changed/changed.ts", "docs/decisions/0001-x.md"],
    ["frontend/package.json"],
    ["frontend/apps/e2e/src/a.ts", "Dockerfile"],
    ["docs/narratives/calendar/act-1.md"],
    [".github/ci-changes.jq"],
    ["README.md"],
    [],
  ]
) {
  Deno.test(`the selection is ci-changes.jq's for ${JSON.stringify(files)}`, async () => {
    const jobs = await selectJobs(repoRoot, files);
    const expected = await jq(files);
    assertEquals(
      Object.fromEntries(jobs.map((job) => [job.id, job.selected])),
      Object.fromEntries(Object.entries(expected).filter(([key]) => key !== "skipped")),
    );
  });
}

Deno.test("job names come from the rules", async () => {
  const jobs = await selectJobs(repoRoot, []);
  assertEquals(jobs.find((job) => job.id === "docs")?.name, "Docs site");
  assertEquals(jobs.find((job) => job.id === "image")?.name, "Container image");
});

Deno.test("every CI job in the rules has local recipes, and every mapping has a job", async () => {
  const jobs = await selectJobs(repoRoot, []);
  assertEquals(mappingGaps(jobs, recipeMap([])), { unmapped: [], stale: [] });
});

Deno.test("a story card alone runs ADR conventions and Docs site", async () => {
  assertEquals(selected(await selectJobs(repoRoot, ["docs/stories/0065-a.md"])), ["docs", "adr"]);
});

Deno.test("a change to the rules selects every job but those CI runs inside Tooling and Frontend", async () => {
  const jobs = await selectJobs(repoRoot, [".github/ci-changes.jq"]);
  assertEquals(
    jobs.filter((job) => !job.selected).map((job) => job.id).sort(),
    ["adr", "binding", "narratives"],
  );
  assert(jobs.length > 3);
});

Deno.test("a job the recipe map lacks fails before anything runs, naming the job", async () => {
  await repository([], async (root) => {
    write(
      root,
      "rules.jq",
      'if (.files | length) == 1 and .files[0] == "\\u0000 no such path" ' +
        'then {backend: false, deploy: false, skipped: ["Backend", "Deploy"]} ' +
        "else {backend: true, deploy: true, skipped: []} end",
    );
    const ran: string[][] = [];
    const errors: string[] = [];
    const original = console.error;
    console.error = (message: string) => errors.push(message);
    try {
      assertEquals(await main([], root, (command) => (ran.push(command), Promise.resolve(true)), "rules.jq"), 1);
    } finally {
      console.error = original;
    }
    assertEquals(ran, []);
    assertStringIncludes(errors.join("\n"), "deploy (Deploy)");
    assertStringIncludes(errors.join("\n"), "frontend");
  });
});

Deno.test("changed files cover commits, staged, unstaged, untracked, renames and deletions, not ignored files", async () => {
  await repository(
    ["frontend/apps/web/old.ts", "backend/src/staged.rs", "backend/src/edited.rs", "docs/gone.md", "keep.md"],
    async (root) => {
      write(root, "docs/stories/0001-card.md");
      git(root, "add", "-A");
      git(root, "commit", "-q", "-m", "card");
      Deno.mkdirSync(join(root, "tools"));
      git(root, "mv", "frontend/apps/web/old.ts", "tools/new.ts");
      write(root, "backend/src/staged.rs", "changed\n");
      git(root, "add", "backend/src/staged.rs");
      write(root, "backend/src/edited.rs", "changed\n");
      git(root, "rm", "-q", "docs/gone.md");
      write(root, "tools/untracked.ts");
      write(root, ".plan/ignored.md");
      const { base, files } = await changedFiles(root, "origin/main");
      assertEquals(base.length, 40);
      assertEquals(files, [
        "backend/src/edited.rs",
        "backend/src/staged.rs",
        "docs/gone.md",
        "docs/stories/0001-card.md",
        "frontend/apps/web/old.ts",
        "tools/new.ts",
        "tools/untracked.ts",
      ]);
    },
  );
});

Deno.test("a rename out of the web app selects Frontend through the old path", async () => {
  await repository(["frontend/apps/web/old.ts"], async (root) => {
    Deno.mkdirSync(join(root, "notes"));
    git(root, "mv", "frontend/apps/web/old.ts", "notes/old.ts");
    git(root, "commit", "-q", "-m", "move");
    const { files } = await changedFiles(root, "origin/main");
    assert(selected(await selectJobs(root, files)).includes("frontend"));
  });
});

Deno.test("an uncommitted backend edit selects Backend", async () => {
  await repository(["backend/src/lib.rs"], async (root) => {
    write(root, "backend/src/lib.rs", "edited\n");
    const { files } = await changedFiles(root, "origin/main");
    assertEquals(selected(await selectJobs(root, files)), ["backend", "image"]);
  });
});

Deno.test("--base compares with the merge base of HEAD and that ref", async () => {
  await repository(["a.md"], async (root) => {
    write(root, "backend/src/lib.rs");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "lower layer");
    git(root, "branch", "lower");
    write(root, "tools/x.ts");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "upper layer");
    assertEquals((await changedFiles(root, "lower")).files, ["tools/x.ts"]);
    assertEquals((await changedFiles(root, "origin/main")).files, ["backend/src/lib.rs", "tools/x.ts"]);
  });
});

const job = (id: string, selected = true): Job => ({ id, name: id.toUpperCase(), selected });
const step = (label: string, ...commands: string[][]): Step => ({
  label,
  commands: commands.length ? commands : [[label]],
});

Deno.test("the container image job is held without --image and planned with it", async () => {
  const jobs = await selectJobs(repoRoot, ["Dockerfile"]);
  const map = recipeMap([]);
  const held = plan(jobs, map, { image: false }).find((planned) => planned.id === "image")!;
  assertEquals(held.steps, []);
  const lines = describePlan(
    { ref: "origin/main", sha: "0".repeat(40) },
    ["Dockerfile"],
    plan(jobs, map, { image: false }),
  );
  assert(lines.some((line) => /Container image\s+selected, not run \(--image to run\)/.test(line)));
  const run = plan(jobs, map, { image: true }).find((planned) => planned.id === "image")!;
  assertEquals(run.steps.map((s) => s.commands), [[["just", "image", "build"]]]);
});

Deno.test("plan runs only selected jobs and runs a shared step once", () => {
  const map = { a: [step("x"), step("y")], b: [step("y"), step("z")], c: [step("w")] };
  const planned = plan([job("a"), job("b"), job("c", false)], map, { image: false });
  assertEquals(planned.map((p) => p.steps.map((s) => s.label)), [["x", "y"], ["z"], []]);
});

Deno.test("describePlan says when no job would run", () => {
  const lines = describePlan(
    { ref: "origin/main", sha: "abc" },
    [],
    plan([job("a", false)], { a: [] }, { image: false }),
  );
  assertStringIncludes(lines[0]!, "0 changed file(s)");
  assertStringIncludes(lines.join("\n"), "No CI job would run for these changes.");
});

Deno.test("every selected step runs after a failure, and the summary lists the failure", async () => {
  const planned = plan([job("a"), job("b")], { a: [step("fails")], b: [step("passes")] }, { image: false });
  const ran: string[] = [];
  const results = await runPlan(
    planned,
    ([c]) => (ran.push(c!), Promise.resolve(c !== "fails")),
    { failFast: false },
    () => {},
  );
  assertEquals(ran, ["fails", "passes"]);
  assertEquals(results.map((r) => r.passed), [false, true]);
  const summary = describeResults(results, planned).join("\n");
  assertStringIncludes(summary, "1 passed, 1 failed");
  assertStringIncludes(summary, "FAIL  A: fails");
});

Deno.test("--fail-fast stops at the first failure and lists what did not run", async () => {
  const planned = plan([job("a"), job("b")], { a: [step("fails")], b: [step("passes")] }, { image: false });
  const ran: string[] = [];
  const results = await runPlan(
    planned,
    ([c]) => (ran.push(c!), Promise.resolve(c !== "fails")),
    { failFast: true },
    () => {},
  );
  assertEquals(ran, ["fails"]);
  assertStringIncludes(describeResults(results, planned).join("\n"), "not run  B: passes");
});

Deno.test("a step stops at its first failing command", async () => {
  const planned = plan([job("a")], { a: [step("two", ["first"], ["second"])] }, { image: false });
  const ran: string[] = [];
  const results = await runPlan(
    planned,
    ([c]) => (ran.push(c!), Promise.resolve(false)),
    { failFast: false },
    () => {},
  );
  assertEquals(ran, ["first"]);
  assertEquals(results.map((r) => r.passed), [false]);
});

Deno.test("main exits 0 and runs nothing when nothing changed", async () => {
  await repository(["a.md"], async (root) => {
    const ran: string[][] = [];
    const lines: string[] = [];
    const original = console.log;
    console.log = (line: string) => lines.push(line);
    try {
      assertEquals(await main([], root, (command) => (ran.push(command), Promise.resolve(true))), 0);
    } finally {
      console.log = original;
    }
    assertEquals(ran, []);
    assertStringIncludes(lines.join("\n"), "No CI job would run for these changes.");
  });
});

Deno.test("main exits non-zero when a selected recipe fails, and --dry-run runs nothing", async () => {
  await repository(["docs/a.md"], async (root) => {
    write(root, "docs/a.md", "edited\n");
    const ran: string[][] = [];
    const original = console.log;
    console.log = () => {};
    try {
      assertEquals(await main(["--dry-run"], root, (c) => (ran.push(c), Promise.resolve(false))), 0);
      assertEquals(ran, []);
      assertEquals(await main([], root, (c) => (ran.push(c), Promise.resolve(false))), 1);
    } finally {
      console.log = original;
    }
    assertEquals(ran[0], ["just", "docs", "architecture"]);
  });
});
