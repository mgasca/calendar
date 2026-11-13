import { assert, assertEquals, assertInstanceOf, assertStringIncludes, assertThrows } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import {
  changesRulesPath,
  findRoot,
  guards,
  jobsApiSkipException,
  loadFiles,
  needsSkipException,
  type RepoFiles,
  runGuard,
} from "../delivery-guards.ts";
import { parseYaml, Workflow, YamlMapping, YamlScalar } from "../workflow-yaml.ts";
const root = findRoot(dirname(fromFileUrl(import.meta.url)))!;
const workflow = Deno.readTextFileSync(new URL("./fixtures/workflow.yml", import.meta.url));
const toolsJustfile = Deno.readTextFileSync(new URL("./fixtures/tools.just", import.meta.url));
function failures(id: string, from = "", to = "", just = false): string[] {
  const files: RepoFiles = { workflow, toolsJustfile };
  if (from) {
    const key = just ? "toolsJustfile" : "workflow";
    assertStringIncludes(files[key], from, "mutation must alter the fixture");
    files[key] = files[key].replaceAll(from, to);
  }
  return runGuard(guards.find((g) => g.id === id)!, files);
}
for (const guard of guards) {
  Deno.test(`Guard_PassesOnThisCheckout: ${guard.id}`, () => assertEquals(runGuard(guard, loadFiles(root)), []));
  Deno.test(`Guard_PassesOnTheFixture: ${guard.id}`, () => assertEquals(failures(guard.id), []));
}
Deno.test("Guards_HaveDistinctIdsAndCiteAFix", () => {
  assertEquals(new Set(guards.map((g) => g.id)).size, guards.length);
  assert(guards.every((g) => g.fix.startsWith("#") && (g.record === "none" || g.record.length === 4)));
});
Deno.test("Workflow_IsReadAsTheJobsItHolds", () => {
  const parsed = Workflow.parse(loadFiles(root).workflow);
  assert(parsed.jobNamed("CI result"));
  assert(parsed.jobs.length > 5);
  assert(parsed.jobs.every((j) => j.steps.length > 0));
});
Deno.test("AnUnreadableWorkflow_FailsTheGuard", () => {
  const errors = runGuard(guards[0]!, { workflow: workflow + "\n  bad: [unclosed\n", toolsJustfile });
  assertEquals(errors.length, 1);
  assertStringIncludes(errors[0]!, "could not be read");
});
const mutations: [string, string, string, string, string, boolean?][] = [
  [
    "AGroupPerRef_Fails",
    "superseded-runs",
    ">-\n    ${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository\n    && github.run_id || github.ref }}",
    "${{ github.workflow }}-${{ github.ref }}",
    "github.run_id",
  ],
  ["NoCancelJob_Fails", "superseded-runs", "name: Cancel superseded runs", "name: Something else", "no job is named"],
  ["ACancelJobWithoutActionsWrite_Fails", "superseded-runs", "actions: write", "actions: read", "actions: write"],
  [
    "ACancelJobThatChecksOut_Fails",
    "superseded-runs",
    "      - run: |\n          for id",
    "      - uses: actions/checkout@v7\n      - run: |\n          for id",
    "fetches code",
  ],
  ["ACancelJobThatCancelsNothing_Fails", "superseded-runs", "gh run cancel", "echo", "gh run cancel"],
  [
    "ACancelJobOnEveryEvent_Fails",
    "superseded-runs",
    "    if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository\n",
    "",
    "only for same-repository pull requests",
  ],
  [
    "ACancelJobForOtherRuns_Fails: no repo condition",
    "superseded-runs",
    " && github.event.pull_request.head.repo.full_name == github.repository\n    permissions",
    "\n    permissions",
    "only for same-repository pull requests",
  ],
  [
    "ACancelJobForOtherRuns_Fails: inequality",
    "superseded-runs",
    "if: github.event_name == 'pull_request' &&",
    "if: github.event_name != 'pull_request' &&",
    "only for same-repository pull requests",
  ],
  [
    "ACancelJobForOtherRuns_Fails: target",
    "superseded-runs",
    "if: github.event_name == 'pull_request' &&",
    "if: github.event_name == 'pull_request_target' || github.event_name == 'pull_request' &&",
    "only for same-repository pull requests",
  ],
  [
    "ACancelJobWithMorePermissions_Fails: contents",
    "superseded-runs",
    "      actions: write\n",
    "      actions: write\n      contents: write\n",
    "exactly `permissions: actions: write`",
  ],
  [
    "ACancelJobWithMorePermissions_Fails: token",
    "superseded-runs",
    "      actions: write\n",
    "      actions: write\n      id-token: write\n",
    "exactly `permissions: actions: write`",
  ],
  [
    "ASerialLoop_Fails",
    "parallel-tool-tests",
    "printf '%s\\n' $tests | xargs -P \"${TOOLS_TEST_JOBS:-4}\" -I{} bash -c 'dotnet run \"$1\"' _ {}",
    'for t in $tests; do dotnet run "$t"; done',
    "xargs -P",
    true,
  ],
  ["ADefaultOfOne_Fails", "parallel-tool-tests", ":-4}", ":-1}", "defaults TOOLS_TEST_JOBS to 1", true],
  [
    "AWorkflowThatSerialises_Fails: env",
    "parallel-tool-tests",
    "        run: just tools test",
    "        run: just tools test\n        env:\n          TOOLS_TEST_JOBS: 1",
    "TOOLS_TEST_JOBS",
  ],
  [
    "AWorkflowThatSerialises_Fails: expression",
    "parallel-tool-tests",
    "        run: just tools test",
    "        run: just tools test\n        env:\n          TOOLS_TEST_JOBS: ${{ vars.JOBS }}",
    "TOOLS_TEST_JOBS",
  ],
  [
    "AWorkflowThatSerialises_Fails: inline",
    "parallel-tool-tests",
    "        run: just tools test",
    "        run: TOOLS_TEST_JOBS=1 just tools test",
    "TOOLS_TEST_JOBS",
  ],
  ["NoNuGetCache_Fails", "parallel-tool-tests", "cache: true", "cache: false", "NuGet cache"],
  [
    "AJobLeftOutOfNeeds_Fails",
    "ci-result-needs-all",
    "[changes, backend, frontend, docs, tooling]",
    "[changes, backend, frontend, docs]",
    "does not need `tooling` (Tooling)",
  ],
  [
    "ANewJobNotNeeded_Fails",
    "ci-result-needs-all",
    "  supersede:\n",
    "  gate:\n    name: Run-time gate\n    steps:\n      - run: echo\n  supersede:\n",
    "does not need `gate` (Run-time gate)",
  ],
  ["NeedingTheOptionalCancelJob_Fails", "ci-result-needs-all", "tooling]", "tooling, supersede]", "needs `supersede`"],
  ["NotAlways_Fails", "ci-result-needs-all", "    if: ${{ always() }}\n", "", "always()"],
  [
    "ASkipThatChangesDidNotIntend_Fails",
    "ci-result-needs-all",
    ' and $needs.changes.outputs[.key] == "false"',
    "",
    "beyond a skip the Changes job intended",
  ],
  [
    "AJobsApiCheckThatAcceptsEverySkip_Fails",
    "ci-result-needs-all",
    jobsApiSkipException,
    'select(.conclusion != "skipped")',
    "beyond a skip the Changes job intended",
  ],
  [
    "NoJobsApiCheck_Fails",
    "ci-result-needs-all",
    '          gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/jobs" --jq \'.jobs[] | select(.conclusion != "success")',
    "          true '",
    "jobs API",
  ],
  ["NoChangesJob_Fails", "changes-job", "name: Changes", "name: Paths", "no job is named `Changes`"],
  [
    "AConditionalChangesJob_Fails",
    "changes-job",
    "name: Changes\n",
    "name: Changes\n    if: github.event_name == 'pull_request'\n",
    "must run on every event",
  ],
  [
    "RulesInlineInsteadOfTheTestedFile_Fails",
    "changes-job",
    "jq -c -f .github/ci-changes.jq",
    "jq -c -f rules.jq",
    changesRulesPath,
  ],
  [
    "AJobThatDoesNotNeedChanges_Fails",
    "changes-job",
    "name: Tooling\n    needs: changes\n",
    "name: Tooling\n",
    "`Tooling` does not need `changes`",
  ],
  [
    "AJobWithNoOutput_Fails",
    "changes-job",
    "      tooling: ${{ steps.decide.outputs.tooling }}\n",
    "",
    "no `tooling` output",
  ],
  [
    "NoSkippedOutput_Fails",
    "changes-job",
    "      skipped: ${{ steps.decide.outputs.skipped }}\n",
    "",
    "no `skipped` output",
  ],
  [
    "NoTypecheckStep_Fails",
    "single-web-typecheck",
    "      - run: pnpm -r --filter '!@calendar/docs' typecheck\n",
    "",
    "type-checks in 0 steps",
  ],
  [
    "FrontendRunningTheDocsSite_Fails: typecheck",
    "docs-site-job",
    "pnpm -r --filter '!@calendar/docs' typecheck",
    "pnpm -r typecheck",
    "`typecheck`",
  ],
  [
    "FrontendRunningTheDocsSite_Fails: coverage",
    "docs-site-job",
    "pnpm -r --filter '!@calendar/docs' test:coverage",
    "pnpm -r test:coverage",
    "`test:coverage`",
  ],
  ["ADocsTypecheckThatSyncsAgain_Fails", "docs-site-job", " --noSync", "", "--noSync"],
  ["NoDocsJob_Fails", "docs-site-job", "name: Docs site", "name: Docs", "Docs site"],
];
for (const [name, guard, from, to, expected, just] of mutations) {
  Deno.test(name, () => {
    const errors = failures(guard, from, to, just);
    assert(errors.some((error) => error.includes(expected)), JSON.stringify(errors));
  });
}
for (
  const step of [
    "      - uses: Actions/Checkout@v7\n",
    '      - run: git clone "https://github.com/$GITHUB_REPOSITORY"\n',
    '      - run: gh pr checkout "$PR"\n',
  ]
) {
  Deno.test(`ACancelJobThatFetchesCode_Fails: ${step.trim()}`, () => {
    const errors = failures(
      "superseded-runs",
      "      - run: |\n          for id",
      step + "      - run: |\n          for id",
    );
    assertEquals(errors.length, 1);
    assertStringIncludes(errors[0]!, "fetches code");
  });
}
for (
  const condition of [
    "needs.changes.outputs.frontend == 'true'",
    "needs.changes.outputs.docs == 'true' || needs.changes.outputs.frontend == 'true'",
    "always()",
  ]
) {
  Deno.test(`AJobThatReadsAnotherCondition_Fails: ${condition}`, () => {
    const errors = failures("changes-job", "if: needs.changes.outputs.docs == 'true'", `if: ${condition}`);
    assertEquals(errors.length, 1);
    assertStringIncludes(errors[0]!, "`Docs site` must run `if: needs.changes.outputs.docs == 'true'`");
  });
}
for (
  const replacement of [
    "pnpm --filter @calendar/web build",
    "pnpm -r --filter '!@calendar/docs' build",
    "pnpm --filter @calendar/web exec tsc -b && pnpm --filter @calendar/web exec vite build",
  ]
) {
  Deno.test(`ASecondTypecheck_Fails: ${replacement}`, () => {
    const errors = failures("single-web-typecheck", "pnpm --filter @calendar/web exec vite build", replacement);
    assert(errors.some((e) => e.includes("type-checks in 2 steps")), JSON.stringify(errors));
  });
}
Deno.test("ANewJobNeeded_Passes", () => {
  const w = workflow.replace(
    "  supersede:\n",
    "  gate:\n    name: Run-time gate\n    steps:\n      - run: echo\n  supersede:\n",
  ).replace("tooling]", "tooling, gate]");
  assertEquals(runGuard(guards.find((g) => g.id === "ci-result-needs-all")!, { workflow: w, toolsJustfile }), []);
});
Deno.test("NeedsAsABlockList_IsRead", () =>
  assertEquals(
    failures(
      "ci-result-needs-all",
      "needs: [changes, backend, frontend, docs, tooling]",
      "needs:\n      - changes\n      - backend\n      - frontend\n      - docs\n      - tooling",
    ),
    [],
  ));
Deno.test("AResultCheckThatAcceptsAnyNonFailure_Fails", () =>
  assertEquals(failures("ci-result-needs-all", '.value.result == "success"', '.value.result != "failure"'), [
    '`CI result` no longer requires every needed job\'s result to be success (`.result == "success"`).',
    `\`CI result\` accepts a job that did not succeed beyond a skip the Changes job intended (\`${needsSkipException}\`).`,
  ]));
Deno.test("TheStrictCheckWithoutSkips_Passes", () => {
  const w = workflow.replace(` or (${needsSkipException})`, "").replace(`| ${jobsApiSkipException}`, "");
  assertEquals(runGuard(guards.find((g) => g.id === "ci-result-needs-all")!, { workflow: w, toolsJustfile }), []);
});
Deno.test("TheBuildBeforeTheTypecheck_Fails", () => {
  const w = workflow.replace("      - run: pnpm -r --filter '!@calendar/docs' typecheck\n", "").replace(
    "run: pnpm --filter @calendar/web exec vite build",
    "run: pnpm --filter @calendar/web exec vite build\n      - run: pnpm -r --filter '!@calendar/docs' typecheck",
  );
  const errors = runGuard(guards.find((g) => g.id === "single-web-typecheck")!, { workflow: w, toolsJustfile });
  assertEquals(errors.length, 1);
  assertStringIncludes(errors[0]!, "before its typecheck step");
});
Deno.test("Parse_ReadsMappingsSequencesAndScalars", () => {
  const root = parseYaml(
    "# comment\non:\n  push:\n    branches: [main, 'release']\nenv:\n  A: \"quoted # not a comment\"\n  B: plain # a comment\njobs:\n  x:\n    needs:\n    - a\n    - b\n    steps:\n      - uses: actions/checkout@v7 # v7.0.0\n      - name: Two lines\n        run: |\n          echo one # kept\n          # also kept\n\n          echo two\n      - run: >-\n          folded\n          text\n",
  );
  assertInstanceOf(root, YamlMapping);
  assertEquals(root.map("on")!.map("push")!.list("branches").map((s) => (s as YamlScalar).value), ["main", "release"]);
  assertEquals(root.map("env")!.text("A"), "quoted # not a comment");
  assertEquals(root.map("env")!.text("B"), "plain");
  const job = root.map("jobs")!.map("x")!;
  assertEquals(job.list("needs").map((s) => (s as YamlScalar).value), ["a", "b"]);
  const steps = job.list("steps") as YamlMapping[];
  assertEquals(steps[0]!.text("uses"), "actions/checkout@v7");
  assertEquals(steps[1]!.text("name"), "Two lines");
  assertEquals(steps[1]!.text("run"), "echo one # kept\n# also kept\n\necho two\n");
  assertEquals(steps[2]!.text("run"), "folded text");
});
for (const yaml of ["a: [1", "a:\n  b: 1\n c: 2", "a: 1\n---\nb: 2", ""]) {
  Deno.test(`Parse_RejectsInvalidYamlAndMultipleDocuments: ${JSON.stringify(yaml)}`, () => {
    assertThrows(() => parseYaml(yaml));
  });
}
const allJobs = ["backend", "frontend", "docs", "tooling", "adr", "narratives", "image"];
async function runRules(event: string, complete: boolean, files: string[]): Promise<Record<string, unknown>> {
  const process = new Deno.Command("jq", {
    args: ["-c", "-f", join(root, changesRulesPath)],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = process.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify({ event, complete, files })));
  await writer.close();
  const result = await process.output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  return JSON.parse(new TextDecoder().decode(result.stdout));
}
function expected(jobs: string): Record<string, boolean> {
  return Object.fromEntries(allJobs.map((j) => [j, jobs.split(" ").includes(j)]));
}
async function checkRules(event: string, complete: boolean, files: string[], jobs: string): Promise<void> {
  const output = await runRules(event, complete, files);
  assertEquals(Object.fromEntries(allJobs.map((j) => [j, output[j]])), expected(jobs));
}
const fileCases: [string, string][] = JSON.parse(
  Deno.readTextFileSync(new URL("./fixtures/changes-cases.json", import.meta.url)),
);
for (const [file, jobs] of fileCases) {
  Deno.test(`AFile_RunsTheJobsItIsAnInputOf: ${file}`, () => checkRules("pull_request", true, [file], jobs));
}
for (const file of [".github/workflows/ci.yml", ".github/ci-changes.jq"]) {
  Deno.test(`AChangeToTheRules_RunsEverything: ${file}`, () =>
    checkRules("pull_request", true, ["README.md", file], "backend frontend docs tooling image"));
}
const combinedCases: [string, string, boolean, string[], string][] = [
  [
    "FilesInSeveralSets_RunTheUnion",
    "merge_group",
    true,
    ["docs/runbooks/x.md", "backend/crates/a/src/lib.rs"],
    "backend docs image",
  ],
  [
    "AThemeOnlyChange_RunsTheDocsSite",
    "pull_request",
    true,
    ["frontend/packages/theme/src/tokens.css"],
    "docs frontend image",
  ],
  ["ARenameOutOfTheThemePackage_RunsTheDocsSite", "pull_request", true, [
    "frontend/packages/theme/tokens.css",
    "frontend/apps/web/src/tokens.css",
  ], "docs frontend image"],
  ["ThemeAndAppFilesTogether_RunTheDocsSiteThroughTheNamedFile", "pull_request", true, [
    "frontend/apps/web/src/main.tsx",
    "frontend/packages/theme/src/fonts.css",
  ], "docs frontend image"],
  ["UnrelatedFrontendFilesTogether_DoNotRunTheDocsSite", "pull_request", true, [
    "frontend/apps/web/src/main.tsx",
    "frontend/packages/api-client/src/index.ts",
    "contracts/openapi.json",
  ], "backend frontend image"],
  ["ACardWithAToolChange_RunsToolingInsteadOfTheAdrCheck", "pull_request", true, [
    "docs/stories/0038-x.md",
    "tools/ci-timings/CiTimings.cs",
  ], "docs tooling"],
  ["TheModelWithAnAdr_RunsToolingInsteadOfTheAdrCheck", "pull_request", true, [
    "docs/architecture/calendar.architecture.json",
    "docs/decisions/0046-x.md",
  ], "docs tooling"],
  ["ACardWithABackendChange_RunsTheAdrCheckBesideTheOthers", "merge_group", true, [
    "docs/stories/0038-x.md",
    "backend/crates/a/src/lib.rs",
  ], "backend docs adr image"],
  ["ANarrativeWithAToolChange_RunsToolingInsteadOfTheNarrativesCheck", "pull_request", true, [
    "docs/narratives/kata/01-setup.md",
    "tools/ci-timings/CiTimings.cs",
  ], "docs tooling"],
  ["ANarrativeWithABackendChange_RunsTheNarrativesCheckBesideTheOthers", "merge_group", true, [
    "docs/narratives/kata/01-setup.md",
    "backend/crates/a/src/lib.rs",
  ], "backend docs narratives image"],
  ["AStitcherChange_RunsToolingWhichRunsTheCheck", "pull_request", true, [
    ".claude/skills/architecture-narrative-builder/scripts/stitch/stitch.ts",
  ], "tooling"],
  ["AnIncompleteListing_RunsEverything", "pull_request", false, ["README.md"], "backend frontend docs tooling image"],
  [
    "AnIncompleteMergeGroupListing_RunsEverythingButTheAdrCheck",
    "merge_group",
    false,
    ["docs/stories/0038-x.md"],
    "backend frontend docs tooling image",
  ],
  ["APushOrDispatch_RunsEverything: push", "push", true, [], allJobs.join(" ")],
  ["APushOrDispatch_RunsEverything: dispatch", "workflow_dispatch", true, [], allJobs.join(" ")],
];
for (const [name, event, complete, files, jobs] of combinedCases) {
  Deno.test(name, () => checkRules(event, complete, files, jobs));
}
Deno.test("ThePublicationArtifact_IsBuiltOnlyForMainAndSameRepositoryPullRequests", () => {
  const steps = Workflow.parse(loadFiles(root).workflow).jobNamed("Docs site")!.steps;
  const configure = steps.find((s) => s.text("name") === "Read GitHub Pages configuration")!;
  const condition = configure.text("if") ?? "";
  assertStringIncludes(condition, "github.event.pull_request.head.repo.full_name == github.repository");
  assertStringIncludes(condition, "github.event_name == 'push' && github.ref == 'refs/heads/main'");
  assertEquals(configure.text("id"), "pages");
  for (const name of ["Build and verify publication artifact", "Upload verified publication artifact"]) {
    assertEquals(steps.find((s) => s.text("name") === name)!.text("if"), "steps.pages.outcome == 'success'");
  }
});
Deno.test("SkippedNames_AreTheJobNamesInCi", async () => {
  const output = await runRules("pull_request", true, ["README.md"]);
  assertEquals(output.skipped, [
    "Backend",
    "Frontend",
    "Docs site",
    "Tooling",
    "ADR conventions",
    "Narratives",
    "Container image",
  ]);
  const workflow = Workflow.parse(loadFiles(root).workflow);
  for (const id of allJobs) {
    assert(workflow.jobs.some((j) => j.id === id && (output.skipped as string[]).includes(j.name)));
  }
  assertEquals(
    workflow.jobs.filter((j) =>
      j.name !== "CI result" && j.body.list("needs").some((n) => n instanceof YamlScalar && n.value === "changes")
    ).map((j) => j.id).sort(),
    [...allJobs].sort(),
  );
});
