import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  clock,
  firstJobsStarted,
  isBookkeeping,
  jobsTable,
  type JobTiming,
  measurePair,
  pairRuns,
  parseJobs,
  parseRuns,
  stepsTable,
  type StepTiming,
  type SupersededPair,
  supersededTable,
  supersessionSummary,
  type WorkflowRun,
} from "../timings.ts";
import { isTransient } from "../gh.ts";
const at = (time: string) => Date.parse(`2026-11-06T${time}Z`);
function run(id: number, conclusion: string, created: string, branch: string, event = "pull_request"): WorkflowRun {
  return { id, status: "completed", conclusion, createdAt: at(created), event, headBranch: branch, headSha: "" };
}
function step(name: string, conclusion: string, start: string, end: string): StepTiming {
  return {
    name,
    number: 1,
    conclusion,
    startedAt: at(start),
    completedAt: at(end),
    seconds: (at(end) - at(start)) / 1000,
  };
}
function job(name: string, conclusion: string, start: string, end: string, ...steps: StepTiming[]): JobTiming {
  return {
    runId: 1,
    name,
    conclusion,
    startedAt: at(start),
    completedAt: at(end),
    steps,
    seconds: (at(end) - at(start)) / 1000,
    createdAt: null,
  };
}
Deno.test("ParseRuns_ReadsTheRunListFields_HeadBranchAndHeadSha", () => {
  const runs = parseRuns(
    '[{"databaseId":42070425996,"status":"completed","conclusion":"success","createdAt":"2026-11-05T17:01:12Z","event":"push"},{"databaseId":42070425997,"status":"in_progress","conclusion":"","createdAt":"2026-11-05T17:02:12Z","event":"pull_request","headBranch":"docs/story-0033","headSha":"209f497f"}]',
  );
  assertEquals(runs[0], {
    id: 42070425996,
    status: "completed",
    conclusion: "success",
    createdAt: Date.parse("2026-11-05T17:01:12Z"),
    event: "push",
    headBranch: "",
    headSha: "",
  });
  assertEquals(runs[1]!.headBranch, "docs/story-0033");
  assertEquals(runs[1]!.headSha, "209f497f");
  assertEquals(runs[1]!.conclusion, "");
});
Deno.test("ParseJobs_KeepsCompletedJobsAndSteps_AndLeavesOutPendingAndSkippedJobs", () => {
  const jobs = parseJobs(
    7,
    JSON.stringify({
      jobs: [
        {
          name: "Frontend",
          conclusion: "success",
          started_at: "2026-11-05T17:01:12Z",
          completed_at: "2026-11-05T17:05:49Z",
          steps: [{
            number: 1,
            name: "Set up job",
            started_at: "2026-11-05T17:01:12Z",
            completed_at: "2026-11-05T17:01:14Z",
          }, {
            number: 2,
            name: "Run pnpm lint",
            started_at: "2026-11-05T17:01:20Z",
            completed_at: "2026-11-05T17:01:36Z",
            conclusion: "cancelled",
          }, { number: 3, name: "Skipped", conclusion: "skipped", started_at: null, completed_at: null }],
        },
        { name: "Pending", conclusion: null, started_at: "2026-11-05T17:01:12Z", completed_at: null, steps: [] },
        {
          name: "Cancel superseded runs",
          conclusion: "skipped",
          started_at: "2026-11-05T17:01:13Z",
          completed_at: "2026-11-05T17:01:12Z",
          steps: [],
        },
      ],
    }),
  );
  assertEquals(jobs.length, 1);
  assertEquals([jobs[0]!.runId, jobs[0]!.name, jobs[0]!.seconds], [7, "Frontend", 277]);
  assertEquals(jobs[0]!.steps.map((s) => s.name), ["Set up job", "Run pnpm lint"]);
  assertEquals(jobs[0]!.steps[1]!.seconds, 16);
  assertEquals(jobs[0]!.steps[1]!.conclusion, "cancelled");
});
Deno.test("Pair_MatchesEachCancelledPullRequestRunWithTheNextRunOfItsBranch_NewestFirst", () => {
  const first = run(1, "cancelled", "14:26:33", "docs/nav"),
    second = run(2, "cancelled", "14:27:02", "docs/nav"),
    other = run(3, "success", "14:27:30", "fix/pages"),
    third = run(4, "success", "14:28:36", "docs/nav"),
    push = run(5, "cancelled", "14:29:00", "main", "push"),
    last = run(6, "cancelled", "14:30:00", "fix/pages");
  assertEquals(pairRuns([third, push, first, other, last, second]).map((p) => [p.cancelled.id, p.superseding.id]), [[
    2,
    4,
  ], [1, 2]]);
});
Deno.test("Measure_BoundsWhenTheRunnersHeardOfTheCancel", () => {
  const pair = measurePair(
    run(42237120711, "cancelled", "14:47:51", "docs/story-0033"),
    run(42237172093, "success", "14:48:11", "docs/story-0033"),
    [
      job(
        "Tooling",
        "cancelled",
        "14:47:53",
        "14:48:58",
        step("ADRs follow conventions", "success", "14:48:54", "14:48:56"),
      ),
      job(
        "Docs site",
        "cancelled",
        "14:47:53",
        "14:49:11",
        step("Verify docs site at a project subpath", "success", "14:48:52", "14:49:08"),
        step("Decide whether this pull request is docs-only", "cancelled", "14:49:08", "14:49:09"),
        step("Post Run actions/checkout@v7", "success", "14:49:09", "14:49:10"),
      ),
      job("Backend", "cancelled", "14:47:53", "14:49:24", step("Run dotnet test", "cancelled", "14:49:02", "14:49:21")),
      job("Frontend", "success", "14:47:56", "14:48:10"),
      job(
        "CI result",
        "failure",
        "14:49:26",
        "14:49:29",
        step("All jobs succeeded", "failure", "14:49:27", "14:49:28"),
      ),
    ],
    [{ ...job("Backend", "success", "14:49:31", "14:51:00"), createdAt: at("14:49:30") }, {
      ...job("Docs site", "success", "14:49:33", "14:50:40"),
      createdAt: at("14:49:30"),
    }, { ...job("CI result", "success", "14:51:03", "14:51:07"), createdAt: at("14:51:01") }],
  );
  assertEquals(pair, {
    cancelledRunId: 42237120711,
    supersedingRunId: 42237172093,
    supersededAt: at("14:48:11"),
    pushGap: 20,
    wait: 80,
    allStarted: 82,
    cancelNotHeardAt: 57,
    cancelHeardBy: 58,
    cancelledJobsEnd: 73,
    runEnd: 78,
    jobsNotCancelled: "Frontend success, CI result failure",
  });
});
Deno.test("Measure_LeavesTheBoundsEmpty_WhenNoStepShowsThem_AndSkipsEndedRuns", () => {
  const old = run(1, "cancelled", "14:47:51", "b"), next = run(2, "success", "14:48:11", "b");
  const pair = measurePair(old, next, [
    job("Backend", "cancelled", "14:47:53", "14:48:20", step("Run dotnet build", "success", "14:48:00", "14:48:18")),
  ], [])!;
  assertEquals([pair.cancelNotHeardAt, pair.cancelHeardBy, pair.wait, pair.allStarted, pair.cancelledJobsEnd], [
    null,
    null,
    null,
    null,
    9,
  ]);
  assertEquals(
    measurePair(run(1, "cancelled", "14:40:00", "b"), next, [job("Backend", "cancelled", "14:40:02", "14:41:00")], [
      job("Backend", "success", "14:48:13", "14:50:00"),
    ]),
    null,
  );
  assertEquals(firstJobsStarted([job("Backend", "success", "14:49:31", "14:51:00")]), null);
});
Deno.test("IsBookkeeping_RecognisesTheRunnersOwnSteps", () => {
  for (
    const [name, expected] of [["Set up job", true], ["Post Run actions/cache@v6", true], ["Stop containers", true], [
      "Run dotnet test",
      false,
    ], ["Postgres smoke test", false]] as const
  ) assertEquals(isBookkeeping(name), expected);
});
function reportJob(id: number, name: string, seconds: number, steps: [string, number, number][] = []): JobTiming {
  return {
    runId: id,
    name,
    conclusion: "success",
    startedAt: 0,
    completedAt: seconds * 1000,
    seconds,
    createdAt: null,
    steps: steps.map(([name, number, seconds]) => ({
      name,
      number,
      seconds,
      startedAt: 0,
      completedAt: seconds * 1000,
      conclusion: "",
    })),
  };
}
Deno.test("JobsTable_GroupsByName_SlowestMedianFirst", () => {
  assertEquals(
    jobsTable([
      reportJob(1, "Backend", 118),
      reportJob(1, "Frontend", 266),
      reportJob(2, "Frontend", 280),
      reportJob(2, "Backend", 83),
    ]),
    "| Job | n | min | median | p90 | max |\n| --- | --: | --: | --: | --: | --: |\n| Frontend | 2 | 4:26 | 4:26 | 4:40 | 4:40 |\n| Backend | 2 | 1:23 | 1:23 | 1:58 | 1:58 |\n",
  );
});
Deno.test("StepsTable_GroupsStepsOfOneJob_InStepOrder", () => {
  assertEquals(
    stepsTable([
      reportJob(1, "Frontend", 266, [["Run pnpm lint", 2, 16.4], ["Set up job", 1, 2]]),
      reportJob(2, "Frontend", 280, [["Run pnpm lint", 2, 10], ["Set up job", 1, 1]]),
      reportJob(2, "Backend", 83, [["Run pnpm lint", 2, 999]]),
    ], "Frontend"),
    "| Step | n | min s | median s | p90 s | max s | mean s |\n| --- | --: | --: | --: | --: | --: | --: |\n| 1. Set up job | 2 | 1 | 1 | 2 | 2 | 1.5 |\n| 2. Run pnpm lint | 2 | 10 | 10 | 16 | 16 | 13.2 |\n",
  );
});
const pair = (overrides: Partial<SupersededPair> = {}): SupersededPair => ({
  cancelledRunId: 11,
  supersedingRunId: 12,
  supersededAt: 0,
  pushGap: 20.4,
  wait: 80,
  allStarted: 82,
  cancelNotHeardAt: 57,
  cancelHeardBy: 58,
  cancelledJobsEnd: 73,
  runEnd: 78,
  jobsNotCancelled: "CI result failure",
  ...overrides,
});
Deno.test("SupersededTable_ShowsOneRowPerPair_WithADashForAMissingBound", () => {
  assertEquals(
    supersededTable([
      pair(),
      pair({
        cancelledRunId: 21,
        supersedingRunId: 22,
        pushGap: 40,
        wait: 2,
        allStarted: null,
        cancelNotHeardAt: null,
        cancelHeardBy: 46.6,
        cancelledJobsEnd: 50,
        runEnd: 50,
        jobsNotCancelled: "",
      }),
    ]),
    "| Cancelled | Superseding | Push gap s | Wait s | All started s | Cancel heard s | Old jobs end s | Old run ends s | Not cancelled |\n| --- | --- | --: | --: | --: | --: | --: | --: | --- |\n| 11 | 12 | 20 | 80 | 82 | 57..58 | 73 | 78 | CI result failure |\n| 21 | 22 | 40 | 2 | – | –..47 | 50 | 50 | – |\n",
  );
});
Deno.test("SupersessionSummary_CountsEachSegmentOverThePairsThatHaveIt", () => {
  const summary = supersessionSummary(
    [
      pair({ pushGap: 20, jobsNotCancelled: "" }),
      pair({
        cancelledRunId: 21,
        supersedingRunId: 22,
        pushGap: 40,
        wait: 2,
        allStarted: 9,
        cancelNotHeardAt: null,
        cancelHeardBy: 46,
        cancelledJobsEnd: 50,
        runEnd: 50,
        jobsNotCancelled: "",
      }),
    ],
    [2, 3, 2],
    [9, 4],
  );
  for (
    const row of [
      "| Wait: the superseding run's first job starts | 2 | 2 | 2 | 80 | 80 |",
      "| All of the superseding run's first jobs have started | 2 | 9 | 9 | 82 | 82 |",
      "| The old run's runners had not yet heard of the cancel (lower bound) | 1 | 57 | 57 | 57 | 57 |",
      "| The old run's runners had heard of it (upper bound) | 2 | 46 | 46 | 58 | 58 |",
      "| The old run's cancelled jobs end | 2 | 50 | 50 | 73 | 73 |",
      "| The old run ends | 2 | 50 | 50 | 78 | 78 |",
      "| Control: a pull request run that superseded nothing, created → first job | 3 | 2 | 2 | 3 | 3 |",
      "| Control: the same runs, created → all first jobs started | 2 | 4 | 4 | 9 | 9 |",
    ]
  ) assertStringIncludes(summary, row);
  assertStringIncludes(supersessionSummary([], [], []), "| The old run ends | 0 | – | – | – | – |");
});
Deno.test("Clock_RendersMinutesAndSeconds", () => {
  assertEquals([clock(266), clock(59.6), clock(0)], ["4:26", "1:00", "0:00"]);
});
Deno.test("IsTransient_RetriesServerErrorsOnly", () => {
  assertEquals(isTransient("gh: Server Error (HTTP 502)"), true);
  assertEquals(isTransient("gh: Not Found (HTTP 404)"), false);
  assertEquals(isTransient("To get started with GitHub CLI, please run:  gh auth login"), false);
});
Deno.test("StepsTable_FixedMeanUsesCSharpMidpointToEvenFormatting", () => {
  const table = stepsTable([reportJob(1, "Frontend", 10, [["Exact midpoint", 1, 1.25]])], "Frontend");
  assertStringIncludes(table, "| 1. Exact midpoint | 1 | 1 | 1 | 1 | 1 | 1.2 |\n");
});
