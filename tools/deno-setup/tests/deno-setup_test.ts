import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { findRoot } from "../../delivery-guards/delivery-guards.ts";
import { check, checkWorkflow, denoPath, dumpJust, invokedRecipes, loadFiles, type SetupFiles } from "../deno-setup.ts";

const here = dirname(fromFileUrl(import.meta.url));
const root = findRoot(here)!;
const e2e = ".github/workflows/e2e.yml";
const fixture = dumpJust(join(here, "fixtures", "recipes"));

// The step #986 added to e2e.yml; without it the nightly failed with `deno: command not found` (#980).
const e2eSetup =
  `      # \`just e2e up\` chooses its port slot with tools/e2e-slot, a Deno tool (#878); without Deno it exits 127 (#980).
      - uses: denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed # v2.0.5
        with:
          deno-version-file: .deno-version
          cache: true
`;

function files(): SetupFiles {
  return loadFiles(root);
}

/** The workflow without its setup-deno steps (and the comment lines just above each). */
function withoutDenoSetup(text: string): string {
  const lines = text.split("\n"), kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!, dash = /^(\s*)- /.exec(line);
    if (!dash) {
      kept.push(line);
      continue;
    }
    let end = i + 1;
    while (end < lines.length && (lines[end]!.trim() === "" || /^\s*/.exec(lines[end]!)![0].length > dash[1]!.length)) {
      end++;
    }
    if (lines.slice(i, end).some((l) => /uses:\s*denoland\/setup-deno@/.test(l))) {
      while (kept.length && kept.at(-1)!.trim().startsWith("#")) kept.pop();
      i = end - 1;
    } else kept.push(line);
  }
  return kept.join("\n");
}

function job(steps: string): string {
  return `name: Fixture\non: push\njobs:\n  work:\n    name: Work\n    runs-on: ubuntu-24.04\n    steps:\n${steps}`;
}
const setup = (versionFile = ".deno-version") =>
  `      - uses: denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed # v2.0.5\n        with:\n          deno-version-file: ${versionFile}\n`;
const step = (name: string, run: string) => `      - name: ${name}\n        run: ${run}\n`;
const fixtureErrors = (steps: string) => checkWorkflow("fixture.yml", job(steps), fixture);

Deno.test("ThisCheckout_Passes", () => assertEquals(check(files()), []));

Deno.test("TheCheckout_HasTheE2eSetupStep", () => assertStringIncludes(files().workflows.get(e2e)!, e2eSetup));

// The regression: e2e.yml as it was before #986 fails, and names the job, the step and the recipe line.
Deno.test("E2eBeforeTheFix_Fails", () => {
  const f = files();
  f.workflows.set(e2e, f.workflows.get(e2e)!.replace(e2eSetup, ""));
  const errors = check(f);
  assertEquals(errors.length, 1, errors.join("\n"));
  for (
    const expected of [
      e2e,
      "job `E2E flows`",
      "(`Start the throwaway stack`)",
      "`just e2e up`",
      "`e2e::up`",
      "deno run",
    ]
  ) {
    assertStringIncludes(errors[0]!, expected);
  }
});

// Every workflow that calls Deno today, directly or through a recipe, is one the guard sees: without its setup steps,
// exactly these six fail.
Deno.test("EveryWorkflowThatCallsDeno_FailsWithoutItsSetup", () => {
  const f = files();
  for (const [path, text] of f.workflows) f.workflows.set(path, withoutDenoSetup(text));
  const failing = new Set(check(f).map((e) => e.split(",")[0]));
  assertEquals([...failing].sort(), [
    ".github/workflows/ci-trend.yml",
    ".github/workflows/ci.yml",
    ".github/workflows/dashboard-snapshot.yml",
    ".github/workflows/e2e.yml",
    ".github/workflows/infra-whatif.yml",
    ".github/workflows/migrate.yml",
  ]);
});

Deno.test("ARecipeReachingDenoOnlyThroughANestedJustCall_IsCaught", () => {
  assertEquals(denoPath(fixture, "outer")?.chain, ["outer", "m::inner"]);
  const errors = fixtureErrors(step("Outer", "just outer"));
  assertEquals(errors.length, 1, errors.join("\n"));
  assertStringIncludes(errors[0]!, "`outer` → `m::inner` calls Deno in `deno run --quiet tool.ts`");
});

Deno.test("ARecipeReachingDenoThroughADependency_IsCaught", () =>
  assertEquals(denoPath(fixture, "m::built")?.chain, ["m::built", "m::inner"]));

Deno.test("ARecipeReachingDenoThroughJustExecutable_IsCaught", () =>
  assertEquals(denoPath(fixture, "m::nested")?.chain, ["m::nested", "m::inner"]));

Deno.test("ADenoScriptRecipe_IsCaught", () => assertEquals(denoPath(fixture, "m::script")?.chain, ["m::script"]));

Deno.test("ARecipeThatOnlyMentionsDeno_IsNotCaught", () => {
  assertEquals(denoPath(fixture, "m::mentions"), null);
  assertEquals(denoPath(fixture, "plain"), null);
});

Deno.test("RunNamesEachRecipe_AndTheOneCallingDenoIsCaught", () => {
  assertEquals(invokedRecipes(" m run quiet built --flag x", fixture), ["m::run", "m::quiet", "m::built"]);
  assertEquals(fixtureErrors(step("Run", "just m run quiet built")).length, 1);
  assertEquals(fixtureErrors(step("Run", "just m run quiet")), []);
});

Deno.test("TheInvocationForms_Resolve", () => {
  assertEquals(invokedRecipes("", fixture), ["outer"]);
  assertEquals(invokedRecipes(" m", fixture), ["m::list"]);
  assertEquals(invokedRecipes(" m::inner", fixture), ["m::inner"]);
  assertEquals(invokedRecipes(" --justfile x -n m inner", fixture), ["m::inner"]);
  assertEquals(invokedRecipes(" --list --list-submodules", fixture), null);
});

Deno.test("AStepOnlyQuotingJust_IsNotCaught", () =>
  assertEquals(fixtureErrors(step("Echo", `echo "run 'just m inner' later"`)), []));

Deno.test("AStepCallingDenoThroughCommandSubstitution_IsCaught", () =>
  assertEquals(fixtureErrors(step("Sub", `echo "$(just m inner)"`)).length, 1));

Deno.test("AStepCallingDenoDirectly_IsCaught", () => {
  const errors = fixtureErrors(step("Direct", "deno task --config tools/deno.json delivery-guards"));
  assertEquals(errors.length, 1, errors.join("\n"));
  assertStringIncludes(errors[0]!, "runs `deno task");
});

Deno.test("SetupBeforeTheStep_Passes", () => assertEquals(fixtureErrors(setup() + step("Outer", "just outer")), []));

Deno.test("SetupAfterTheStep_Fails", () =>
  assertEquals(fixtureErrors(step("Outer", "just outer") + setup()).length, 1));

Deno.test("SetupWithoutTheVersionFile_Fails", () => {
  const errors = fixtureErrors(setup("other-version") + step("Quiet", "just m quiet"));
  assertEquals(errors.length, 1, errors.join("\n"));
  assertStringIncludes(errors[0]!, "without `deno-version-file: .deno-version`");
});

Deno.test("AStepNamingAMissingRecipe_Fails", () => {
  const errors = fixtureErrors(step("Typo", "just m innr"));
  assert(errors.some((e) => e.includes("`m::innr`, which does not exist")), errors.join("\n"));
});

Deno.test("ARecipeWithoutDeno_NeedsNoSetup", () => assertEquals(fixtureErrors(step("Plain", "just plain")), []));
