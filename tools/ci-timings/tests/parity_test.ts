import { assertEquals } from "@std/assert";
import { buildBaseline, evaluateBaseline, gateDefaults, type SampledRun } from "../baseline.ts";
import { backTestTable, baselineTable, baselineWindow, writeBaseline } from "../baseline-report.ts";
import { evaluateTrend, trendDefaults, trendReport } from "../trend.ts";
import {
  jobsTable,
  type JobTiming,
  stepsTable,
  type SupersededPair,
  supersededTable,
  supersessionSummary,
  type WorkflowRun,
} from "../timings.ts";
const t0 = Date.parse("2026-11-06T20:04:12Z");
const run = (id: number): WorkflowRun => ({
  id,
  status: "completed",
  conclusion: "success",
  createdAt: t0 + id * 60000,
  event: "push",
  headBranch: "main",
  headSha: `sha${String(id).padStart(4, "0")}0000`,
});
function sampled(count: number, offset: number, multiplier: number, shift = 0): SampledRun[] {
  return Array.from(
    { length: count },
    (_, i) => ({
      run: run(i + offset),
      samples: [{
        runId: i + offset,
        job: "Backend",
        path: "publication",
        seconds: 80 + (i * multiplier) % 11 - 5 + shift,
      }],
    }),
  );
}
const baseline = buildBaseline(
  "ci.yml",
  "docs/benchmarks/0014-ci-job-baseline.md",
  30,
  gateDefaults,
  sampled(30, 1, 7),
);
const reportJob = (id: number, name: string, seconds: number, steps: [string, number, number][] = []): JobTiming => ({
  runId: id,
  name,
  conclusion: "success",
  startedAt: t0,
  completedAt: t0 + seconds * 1000,
  seconds,
  createdAt: null,
  steps: steps.map(([name, number, seconds]) => ({
    name,
    number,
    seconds,
    startedAt: t0,
    completedAt: t0 + seconds * 1000,
    conclusion: "",
  })),
});
const jobs = [
  reportJob(1, "Backend", 118),
  reportJob(1, "Frontend", 266, [["Run pnpm lint", 2, 16.4], ["Set up job", 1, 2]]),
  reportJob(2, "Frontend", 280, [["Run pnpm lint", 2, 10], ["Set up job", 1, 1]]),
  reportJob(2, "Backend", 83),
];
const pairs: SupersededPair[] = [{
  cancelledRunId: 11,
  supersedingRunId: 12,
  supersededAt: t0,
  pushGap: 20.4,
  wait: 80,
  allStarted: 82,
  cancelNotHeardAt: 57,
  cancelHeardBy: 58,
  cancelledJobsEnd: 73,
  runEnd: 78,
  jobsNotCancelled: "CI result failure",
}, {
  cancelledRunId: 21,
  supersedingRunId: 22,
  supersededAt: t0,
  pushGap: 40,
  wait: 2,
  allStarted: null,
  cancelNotHeardAt: null,
  cancelHeardBy: 46.6,
  cancelledJobsEnd: 50,
  runEnd: 50,
  jobsNotCancelled: "",
}];
// Frozen outputs captured by running the original C# classes, not by blessing replacement output.
// See fixtures/README.md for the exact old revision and generation evidence.
const expected: Record<string, string> = JSON.parse(
  await Deno.readTextFile(new URL("fixtures/csharp-reports.json", import.meta.url)),
);
Deno.test("CSharpParity_BaselineJsonAndEveryReportAreByteIdentical", () => {
  const actual = {
    baseline: writeBaseline(baseline),
    baselineTable: baselineTable(baseline),
    baselineWindow: baselineWindow(baseline),
    backTest: backTestTable(
      evaluateBaseline(baseline, [{ runId: 1001, job: "Backend", path: "publication", seconds: 200 }, {
        runId: 1002,
        job: "Backend",
        path: "publication",
        seconds: 70,
      }]),
    ),
    trend: trendReport(evaluateTrend(baseline, sampled(20, 1000, 3, 20), trendDefaults), baseline, trendDefaults),
    jobs: jobsTable(jobs),
    steps: stepsTable(jobs, "Frontend"),
    superseded: supersededTable(pairs),
    supersession: supersessionSummary(pairs, [2, 3, 2], [9, 4]),
  };
  assertEquals(actual, expected);
});
