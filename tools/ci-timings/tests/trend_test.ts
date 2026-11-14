import { assert, assertAlmostEquals, assertEquals, assertStringIncludes } from "@std/assert";
import { buildBaseline, gateDefaults, type SampledRun } from "../baseline.ts";
import { evaluateTrend, issueAction, issueTitle, recentRuns, trendDefaults, trendReport } from "../trend.ts";
import { parseIssues, type WorkflowRun } from "../timings.ts";
const t0 = Date.parse("2026-11-06T20:04:12Z");
const history = (count: number) => Array.from({ length: count }, (_, i) => 80 + (i * 7) % 11 - 5);
const recent = (count: number, shift: number) => Array.from({ length: count }, (_, i) => 80 + (i * 3) % 11 - 5 + shift);
function run(id: number, event = "push", conclusion = "success", branch = "main"): WorkflowRun {
  return {
    id,
    status: "completed",
    conclusion,
    createdAt: t0 + id * 60000,
    event,
    headBranch: branch,
    headSha: `sha${String(id).padStart(4, "0")}0000`,
  };
}
function sampled(backend: number[], frontend?: number[], offset = 0): SampledRun[] {
  return backend.map((seconds, i) => ({
    run: run(i + offset),
    samples: [
      { runId: i + offset, job: "Backend", path: "publication", seconds },
      ...(frontend ? [{ runId: i + offset, job: "Frontend", path: "publication", seconds: frontend[i]! }] : []),
    ],
  }));
}
function baseline(backend = history(30), frontend?: number[]) {
  return buildBaseline(
    "ci.yml",
    "docs/benchmarks/0014-ci-job-baseline.md",
    30,
    gateDefaults,
    sampled(backend, frontend, 1),
  );
}
const later = (backend: number[], frontend?: number[]) => sampled(backend, frontend, 1000);
Deno.test("AHistoryShiftedByTwentySeconds_IsReportedSlower", () => {
  const result = evaluateTrend(baseline(), later(recent(20, 20)), trendDefaults), row = result.rows[0]!;
  assertEquals(row.verdict, "Slower");
  assert(row.pSlower < 0.002);
  assertAlmostEquals(row.shift, 20, 2);
  assertEquals(row.minEffect, 10);
  assert(result.regressed);
});
Deno.test("AnUnshiftedHistory_IsNotReported", () => {
  const result = evaluateTrend(baseline(), later(recent(20, 0)), trendDefaults);
  assertEquals(result.rows[0]!.verdict, "NoShift");
  assert(result.rows[0]!.pSlower > 0.002);
  assert(!result.regressed);
});
Deno.test("ASignificantShiftBelowTheMinimumEffect_IsNotReported", () => {
  const result = evaluateTrend(
      baseline(Array.from({ length: 30 }, (_, i) => 60 + i % 2)),
      later(Array(20).fill(64)),
      trendDefaults,
    ),
    row = result.rows[0]!;
  assert(row.pSlower < 0.0001);
  assert(row.shift < 10);
  assertEquals(row.verdict, "NoShift");
});
Deno.test("TheMinimumEffect_GrowsWithALongJob", () => {
  const result = evaluateTrend(
      baseline(history(30).map((s) => s + 220)),
      later(recent(20, 12).map((s) => s + 220)),
      trendDefaults,
    ),
    row = result.rows[0]!;
  assertEquals(row.minEffect, 15);
  assert(row.pSlower < 0.002);
  assertEquals(row.verdict, "NoShift");
});
Deno.test("AFasterHistory_IsOnlyASuggestion", () => {
  const pinned = baseline(), result = evaluateTrend(pinned, later(recent(20, -20)), trendDefaults);
  assertEquals(result.rows[0]!.verdict, "Faster");
  assert(!result.regressed);
  assertEquals(issueAction(result, []), null);
  assertStringIncludes(trendReport(result, pinned, trendDefaults), "Suggestion: **Backend** (publication) is faster");
});
Deno.test("EachJobIsJudgedOnItsOwn", () => {
  const result = evaluateTrend(baseline(history(30), history(30)), later(recent(20, 25), recent(20, 0)), trendDefaults);
  assertEquals(result.rows.map((r) => [r.job, r.verdict]), [["Backend", "Slower"], ["Frontend", "NoShift"]]);
});
Deno.test("WithFewerRunsThanN_NothingIsConcluded", () => {
  const pinned = baseline(), result = evaluateTrend(pinned, later(recent(19, 40)), trendDefaults);
  assert(!result.enough);
  assert(!result.regressed);
  assert(result.rows.every((r) => r.verdict === "NoShift"));
  assertStringIncludes(trendReport(result, pinned, trendDefaults), "Not enough runs since the baseline: 19 of 20.");
});
Deno.test("AJobWithoutABaselineOnItsPath_IsLeftOut", () => {
  const result = evaluateTrend(
    baseline(),
    later(recent(20, 40)).map((r) => ({ ...r, samples: r.samples.map((s) => ({ ...s, path: "check" })) })),
    trendDefaults,
  );
  assertEquals(result.rows, []);
});
Deno.test("RecentRuns_AreTheNewestSuccessfulPushesOnMainNotInTheBaseline_OldestFirst", () => {
  const listed = [1, 2, 3, 4, 5, 6, 7].map((id) => run(id));
  listed.push(
    run(8, "workflow_dispatch"),
    run(9, "push", "failure"),
    run(10, "push", "success", "feature"),
    run(11, "pull_request"),
  );
  assertEquals(recentRuns(baseline(history(3)), listed, { ...trendDefaults, runs: 3 }).map((r) => r.id), [5, 6, 7]);
});
Deno.test("RecentRuns_LeaveOutRunsFromBeforeTheBaselineEnds", () => {
  const pinned = buildBaseline("ci.yml", "r.md", 1, gateDefaults, sampled([80, 80, 80], undefined, 5));
  assertEquals(recentRuns(pinned, Array.from({ length: 9 }, (_, i) => run(i + 1)), trendDefaults).map((r) => r.id), [
    8,
    9,
  ]);
});
Deno.test("IssueAction_CreatesWhenNoneIsOpen_CommentsOnTheOpenOne_AndDoesNothingWithoutARegression", () => {
  const slower = evaluateTrend(baseline(), later(recent(20, 20)), trendDefaults),
    same = evaluateTrend(baseline(), later(recent(20, 0)), trendDefaults);
  assertEquals(issueAction(slower, [{ number: 7, title: "Something else" }]), 0);
  assertEquals(
    issueAction(slower, [{ number: 7, title: "Something else" }, { number: 412, title: issueTitle }, {
      number: 415,
      title: issueTitle,
    }]),
    412,
  );
  assertEquals(issueAction(same, [{ number: 412, title: issueTitle }]), null);
});
Deno.test("Report_NamesTheJobTheShiftTheWindowAndTheRuns", () => {
  const pinned = baseline(),
    report = trendReport(evaluateTrend(pinned, later(recent(20, 20)), trendDefaults), pinned, trendDefaults);
  for (
    const text of [
      "p < 0.002",
      "max(10 s, 5 % of the baseline median)",
      "| publication | Backend | 20 | 30 | 1:20 | 1:39 | +20 s",
      "| **slower** |",
      "- **Backend** (publication) is slower by +20 s (minimum effect 10 s",
      "commits `sha10000` to `sha10190`",
      "Runs: 1000, 1001,",
    ]
  ) assertStringIncludes(report, text);
});
Deno.test("ParseIssues_ReadsNumberAndTitle", () => {
  assertEquals(parseIssues(JSON.stringify([{ number: 412, title: issueTitle }])), [{ number: 412, title: issueTitle }]);
});
Deno.test("TheTrendWorkflow_RunsOnScheduleAndDispatchOnly_NeverForAPullRequest", async () => {
  const workflow = await Deno.readTextFile(new URL("../../../.github/workflows/ci-trend.yml", import.meta.url));
  assertStringIncludes(workflow, "\n  schedule:\n");
  assertStringIncludes(workflow, "\n  workflow_dispatch:\n");
  assert(!workflow.includes("pull_request"));
  assert(!workflow.includes("\n  push:"));
});
Deno.test("TheTrendWorkflow_HasLeastPermissions_AndRunsTheTrendModeWithIssues", async () => {
  const workflow = await Deno.readTextFile(new URL("../../../.github/workflows/ci-trend.yml", import.meta.url));
  assertStringIncludes(workflow, "permissions: {}");
  assertStringIncludes(workflow, "      actions: read\n      contents: read\n      issues: write\n");
  assert(!workflow.includes("write-all"));
  assertStringIncludes(workflow, 'tools/ci-timings/ci-timings.ts --trend --issue --repo "$GITHUB_REPOSITORY"');
  assertStringIncludes(workflow, "shell: bash");
});
Deno.test("RecentRuns_KeepScheduledRunsOnMain_SoTheNightlyE2eWorkflowIsInTheTrend", () => {
  const listed = [
    run(1, "schedule"),
    run(2, "schedule"),
    run(3, "schedule", "failure"),
    run(4, "schedule", "success", "x"),
  ];
  listed.push(run(5, "workflow_dispatch"));
  const pinned = buildBaseline("e2e.yml", "r.md", 1, gateDefaults, []);
  assertEquals(recentRuns(pinned, listed, trendDefaults).map((r) => r.id), [1, 2]);
});
Deno.test("Report_NamesTheWorkflowAndTheBaselineFileItRead", () => {
  const pinned = buildBaseline("e2e.yml", "r.md", 30, gateDefaults, sampled(history(30), undefined, 1)),
    report = trendReport(
      evaluateTrend(pinned, later(recent(20, 0)), trendDefaults),
      pinned,
      trendDefaults,
      ".github/e2e-baseline.json",
    );
  assertStringIncludes(report, "scheduled runs of `e2e.yml` on `main`");
  assertStringIncludes(report, "against `.github/e2e-baseline.json` (r.md)");
});
Deno.test("TheTrendWorkflow_AlsoChecksTheE2eWorkflowAgainstItsOwnBaseline", async () => {
  const workflow = await Deno.readTextFile(new URL("../../../.github/workflows/ci-trend.yml", import.meta.url));
  assertStringIncludes(
    workflow,
    'tools/ci-timings/ci-timings.ts --trend --issue --workflow e2e.yml --out .github/e2e-baseline.json --repo "$GITHUB_REPOSITORY"',
  );
});
