import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { buildBaseline, gateDefaults, type SampledRun } from "../baseline.ts";
import { readBaseline, writeBaseline } from "../baseline-report.ts";
import type { WorkflowRun } from "../timings.ts";
const root = fromFileUrl(new URL("../../../", import.meta.url)), t0 = Date.parse("2026-11-06T20:04:12Z");
function run(id: number, event: string): WorkflowRun {
  return {
    id,
    status: "completed",
    conclusion: "success",
    createdAt: t0 + id * 60000,
    event,
    headBranch: "main",
    headSha: "c",
  };
}
function baseline(status = "pinned", withFrontend = true): string {
  const sampled: SampledRun[] = [];
  for (let i = 0; i < 4; i++) {
    const check = [{ runId: i, job: "Backend", path: "check", seconds: 80 }, {
      runId: i,
      job: "Docs site",
      path: "check",
      seconds: 80,
    }];
    if (withFrontend) check.push({ runId: i, job: "Frontend", path: "check", seconds: 40 });
    sampled.push({ run: run(i, "workflow_dispatch"), samples: check }, {
      run: run(i + 10, "push"),
      samples: [{ runId: i + 10, job: "Backend", path: "publication", seconds: 80 }, {
        runId: i + 10,
        job: "Docs site",
        path: "publication",
        seconds: 100,
      }],
    });
  }
  return writeBaseline(buildBaseline("ci.yml", "docs/benchmarks/0014-ci-job-baseline.md", 4, gateDefaults, sampled))
    .replaceAll('"status": "pinned"', `"status": "${status}"`);
}
function job(name: string, seconds: number, conclusion = "success", published = false) {
  return {
    name,
    status: conclusion ? "completed" : "in_progress",
    conclusion: conclusion || null,
    started_at: new Date(t0).toISOString().replace(".000Z", "Z"),
    completed_at: conclusion ? new Date(t0 + seconds * 1000).toISOString().replace(".000Z", "Z") : null,
    steps: name === "Docs site"
      ? [{ number: 14, name: "Build and verify publication artifact", conclusion: published ? "success" : "skipped" }]
      : [],
  };
}
async function gate(jobs: unknown[], baseline: string, event: string, format?: string) {
  const dir = await Deno.makeTempDir({ prefix: "ci-gate-tests-" });
  try {
    const jobsPath = join(dir, "jobs.json"), baselinePath = join(dir, "ci-baseline.json");
    await Deno.writeTextFile(jobsPath, JSON.stringify({ total_count: jobs.length, jobs }));
    await Deno.writeTextFile(baselinePath, baseline);
    const args = [
      "-r",
      "-f",
      join(root, ".github/ci-gate.jq"),
      "--slurpfile",
      "baseline",
      baselinePath,
      "--arg",
      "event",
      event,
      ...(format ? ["--arg", "format", format] : []),
      jobsPath,
    ];
    const result = await new Deno.Command("jq", { args, stdout: "piped", stderr: "piped" }).output();
    return {
      code: result.code,
      out: new TextDecoder().decode(result.stdout),
      err: new TextDecoder().decode(result.stderr),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}
Deno.test("AnOrdinaryPullRequestRun_Passes", async () => {
  const r = await gate([job("Backend", 82), job("Docs site", 79), job("Frontend", 41)], baseline(), "pull_request");
  assertEquals(r.err, "");
  assertEquals(r.code, 0);
  assertStringIncludes(r.out, "Backend: 1:22, within its threshold of 1:35 (median 1:20).");
  assert(!r.out.includes("::error::"));
  assert(!r.out.includes("::warning::"));
});
for (const event of ["pull_request", "merge_group"]) {
  Deno.test(`ASlowJobOnAGatingEvent_FailsAndNamesTheJobTimeThresholdAndMedian ${event}`, async () => {
    const r = await gate([job("Backend", 140), job("Docs site", 79)], baseline(), event);
    assertEquals(r.code, 1);
    assertStringIncludes(
      r.out,
      "::error::Backend took 2:20 on the check path, above its threshold of 1:35 (baseline median 1:20, n = 4, docs/benchmarks/0014-ci-job-baseline.md).",
    );
    assertStringIncludes(r.out, "Re-run all jobs");
    assertStringIncludes(r.out, "Docs site: 1:19, within");
    assertStringIncludes(r.err, "A job took longer than its pinned baseline allows");
  });
}
Deno.test("ExactlyAtTheThreshold_Passes", async () =>
  assertEquals((await gate([job("Backend", 95), job("Docs site", 79)], baseline(), "pull_request")).code, 0));
Deno.test("OneSecondAboveTheThreshold_Fails", async () =>
  assertEquals((await gate([job("Backend", 96), job("Docs site", 79)], baseline(), "pull_request")).code, 1));
Deno.test("APublishedRun_IsComparedWithThePublicationPath", async () => {
  const r = await gate([job("Docs site", 110, "success", true), job("Backend", 80)], baseline(), "pull_request");
  assertEquals(r.code, 0);
  assertStringIncludes(r.out, "Docs site: 1:50, within its threshold of 1:55 (median 1:40).");
});
Deno.test("AnUnpublishedRun_IsComparedWithTheCheckPath", async () =>
  assertStringIncludes(
    (await gate([job("Docs site", 110), job("Backend", 80)], baseline(), "pull_request")).out,
    "::error::Docs site took 1:50 on the check path, above its threshold of 1:35",
  ));
Deno.test("AJobWithNoBaselineEntry_WarnsAndPasses", async () => {
  const r = await gate([job("Backend", 80), job("Docs site", 80), job("Tooling", 900)], baseline(), "pull_request");
  assertEquals(r.code, 0);
  assertStringIncludes(
    r.out,
    "::warning::Tooling has no baseline on the check path; it is not gated until the next baseline update.",
  );
});
Deno.test("APathWithNoBaseline_WarnsOnceAndPasses", async () => {
  const b = writeBaseline(
    buildBaseline("ci.yml", "docs/benchmarks/0014-ci-job-baseline.md", 1, gateDefaults, [{
      run: run(1, "push"),
      samples: [{ runId: 1, job: "Backend", path: "publication", seconds: 80 }],
    }]),
  );
  const r = await gate([job("Backend", 900)], b, "pull_request");
  assertEquals(r.code, 0);
  assertEquals(r.out, "::warning::No baseline for the check path in .github/ci-baseline.json; no job is gated.\n");
});
for (const event of ["push", "workflow_dispatch"]) {
  Deno.test(`ASlowJobOnAMainRun_OnlyWarns ${event}`, async () => {
    const r = await gate([job("Backend", 140), job("Docs site", 79)], baseline(), event);
    assertEquals(r.code, 0);
    assertEquals(r.err, "");
    assertStringIncludes(r.out, "::warning::Backend took 2:20 on the check path, above its threshold of 1:35");
    assertStringIncludes(r.out, `Not failing: the gate only reports on a ${event} run.`);
  });
}
Deno.test("ASlowJobOnAProvisionalPath_OnlyWarns", async () => {
  const r = await gate([job("Backend", 140), job("Docs site", 79)], baseline("provisional"), "pull_request");
  assertEquals(r.code, 0);
  assertStringIncludes(r.out, "Not failing: the check baseline is provisional (fewer than 4 runs per job).");
});
Deno.test("FailedSkippedRunningAndUngatedJobs_AreIgnored", async () => {
  const r = await gate(
    [
      job("Backend", 900, "failure"),
      job("Frontend", 900, "skipped"),
      job("CI result", 900, ""),
      job("Cancel superseded runs", 900),
      job("Docs site", 79),
    ],
    baseline(),
    "pull_request",
  );
  assertEquals(r.code, 0);
  assertEquals(r.out, "Docs site: 1:19, within its threshold of 1:35 (median 1:20).\n");
});
Deno.test("TheSummary_IsAMarkdownTableAndNeverFails", async () => {
  const r = await gate(
    [job("Backend", 140), job("Docs site", 79), job("Tooling", 60)],
    baseline("pinned", false),
    "pull_request",
    "summary",
  );
  assertEquals(r.code, 0);
  for (
    const text of [
      "### Job run times on the check path (ADR 0045)\n",
      "| Backend | 2:20 | 1:35 | 1:20 | 4 | **above the threshold** |",
      "| Docs site | 1:19 | 1:35 | 1:20 | 4 | within |",
      "| Tooling | 1:00 | – | – | – | no baseline |",
    ]
  ) assertStringIncludes(r.out, text);
});
Deno.test("TheWorkflow_RunsThisGateFileInCiResult_OnTheSavedJobsResponse", async () => {
  const workflow = await Deno.readTextFile(join(root, ".github/workflows/ci.yml")),
    result = workflow.slice(workflow.indexOf("\n  result:\n"));
  for (
    const text of [
      "sparse-checkout: .github",
      '> "$RUNNER_TEMP/jobs.json"',
      'gate=(jq -r -f .github/ci-gate.jq --slurpfile baseline .github/ci-baseline.json --arg event "$GITHUB_EVENT_NAME")',
      '"${gate[@]}" "$RUNNER_TEMP/jobs.json"',
    ]
  ) assertStringIncludes(result, text);
  assert(result.indexOf("ci-gate.jq") > result.indexOf("All CI jobs passed."));
});
Deno.test("TheCommittedBaseline_IsReadableByTheTool_AndHoldsBothPaths", async () => {
  const file = readBaseline(await Deno.readTextFile(join(root, ".github/ci-baseline.json")));
  assertEquals(Object.keys(file.paths), ["check", "publication"]);
  assert(
    Object.values(file.paths).flatMap((path) => Object.values(path.jobs)).every((job) => job.threshold > job.median),
  );
});
