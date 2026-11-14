import { assert, assertAlmostEquals, assertEquals, assertNotEquals, assertRejects, assertThrows } from "@std/assert";
import { normalQuantile } from "../statistics.ts";
import {
  buildBaseline,
  buildPath,
  derive,
  evaluateBaseline,
  gateDefaults,
  isMain,
  isSuccessful,
  pathOf,
  publicationStep,
  sampleBaseline,
  type SampledRun,
  samples,
  threshold,
} from "../baseline.ts";
import { backTestTable, baselineTable, baselineWindow, readBaseline, writeBaseline } from "../baseline-report.ts";
import { type JobTiming, type WorkflowRun } from "../timings.ts";
const t0 = Date.parse("2026-11-06T20:04:12Z");
function run(id: number, event = "push", branch = "main"): WorkflowRun {
  return {
    id,
    status: "completed",
    conclusion: "success",
    createdAt: t0 + id * 60000,
    event,
    headBranch: branch,
    headSha: `c${id}`,
  };
}
function job(name: string, seconds: number, conclusion = "success", publication = false): JobTiming {
  return {
    runId: 1,
    name,
    conclusion,
    startedAt: t0,
    completedAt: t0 + seconds * 1000,
    seconds,
    createdAt: null,
    steps: publication
      ? [{ number: 14, name: publicationStep, startedAt: t0, completedAt: t0, seconds: 0, conclusion: "success" }]
      : [],
  };
}
Deno.test("baseline stable floors, relative margins, spread, nearest rank and rounding noise", () => {
  const stable = derive([50, 50, 50, 50], gateDefaults);
  assertEquals(stable.logMad, 0);
  assertEquals(stable.threshold, 65);
  assertEquals(derive([200, 200, 200], gateDefaults).threshold, 220);
  const spread = derive([200, 50, 100], gateDefaults);
  assertEquals(spread.median, 100);
  assertAlmostEquals(spread.logMedian, Math.log(100), 1e-6);
  assertAlmostEquals(spread.logMad, Math.log(2), 1e-6);
  assertEquals(spread.max, 200);
  const nearest = derive(Array.from({ length: 20 }, (_, i) => i + 61), gateDefaults);
  assertEquals([nearest.count, nearest.median, nearest.p90, nearest.p95], [20, 70, 78, 79]);
  assertThrows(() => derive([], gateDefaults));
  assertEquals(threshold(50, Math.log(50), 0, { ...gateDefaults, floorSeconds: 5.000000000001 }), 55);
});
Deno.test("path derives from successful publication step in Docs site only", () => {
  assertEquals(pathOf([job("Backend", 80), job("Docs site", 100, "success", true)]), "publication");
  assertEquals(pathOf([job("Backend", 80, "success", true)]), "check");
  const skipped = job("Docs site", 80, "success", true);
  skipped.steps[0]!.conclusion = "skipped";
  assertEquals(pathOf([job("Backend", 80), skipped]), "check");
  assertEquals(
    samples(run(7, "pull_request"), [
      job("Backend", 80),
      job("Frontend", 40, "failure"),
      job("CI result", 3),
      job("Cancel superseded runs", 2),
      job("Docs site", 99, "success", true),
    ]),
    [
      { runId: 7, job: "Backend", path: "publication", seconds: 80 },
      { runId: 7, job: "Docs site", path: "publication", seconds: 99 },
    ],
  );
});
Deno.test("main and success filters", () => {
  for (
    const [event, branch, expected] of [
      ["push", "main", true],
      ["workflow_dispatch", "main", true],
      ["schedule", "main", true],
      ["schedule", "feature", false],
      ["pull_request", "main", false],
      ["push", "feature", false],
      ["workflow_dispatch", "feature", false],
    ] as const
  ) assertEquals(isMain(run(1, event, branch)), expected);
  assert(isSuccessful(run(1)));
  assert(!isSuccessful({ ...run(1), conclusion: "failure" }));
  assert(!isSuccessful({ ...run(1), status: "in_progress", conclusion: "" }));
});
function sample(): SampledRun[] {
  return [80, 79, 95, 76, 81].map((seconds, i) => ({
    run: run(100 + i, "workflow_dispatch"),
    samples: [{ runId: 100 + i, job: "Backend", path: "check", seconds }, {
      runId: 100 + i,
      job: "Frontend",
      path: "check",
      seconds: 45 - i,
    }],
  }));
}
Deno.test("build splits paths marks thin paths provisional and derives job count", () => {
  const all: SampledRun[] = [
    ...Array.from(
      { length: 3 },
      (_, i) => ({
        run: run(i + 1, "workflow_dispatch"),
        samples: [{ runId: i + 1, job: "Backend", path: "check", seconds: 81 + i }, {
          runId: i + 1,
          job: "Tooling",
          path: "check",
          seconds: 60,
        }],
      }),
    ),
    {
      run: run(9),
      samples: [{ runId: 9, job: "Backend", path: "publication", seconds: 90 }, {
        runId: 9,
        job: "Docs site",
        path: "publication",
        seconds: 99,
      }],
    },
  ];
  const file = buildBaseline("ci.yml", "r.md", 3, gateDefaults, all);
  assertEquals(file.constants.jobs, 3);
  assertEquals(Object.keys(file.paths), ["check", "publication"]);
  assertEquals(file.paths.check!.status, "pinned");
  assertEquals(file.paths.check!.runs.map((r) => r.id), [1, 2, 3]);
  assertEquals(file.paths.check!.jobs.Backend!.median, 82);
  assertEquals(file.paths.publication!.status, "provisional");
  assertEquals(file.paths.publication!.runs.map((r) => r.id), [9]);
  assertEquals(Object.keys(file.paths.publication!.jobs), ["Backend", "Docs site"]);
  assertEquals(
    buildPath("publication", [run(1)], [{ runId: 1, job: "Backend", path: "check", seconds: 80 }], 30, gateDefaults),
    null,
  );
});
Deno.test("baseline IO roundtrip and deterministic window/constants report", () => {
  const file = buildBaseline("ci.yml", "docs/benchmarks/0014-ci-job-baseline.md", 30, gateDefaults, sample());
  const json = writeBaseline(file);
  assertEquals(json, writeBaseline(file));
  assertEquals(readBaseline(json), file);
  const parsed = JSON.parse(json);
  assertEquals(parsed.schema, 1);
  assertEquals(parsed.constants.jobs, 2);
  assertEquals(parsed.paths.check.window.firstCommit, "c100");
  assert(baselineTable(file).includes("| check | Backend | 5 | 1:20 |"));
  assert(baselineWindow(file).includes("workflow_dispatch"));
});
Deno.test("backtest excludes pinned runs missing paths and jobs; threshold equality passes", () => {
  const file = buildBaseline("ci.yml", "r.md", 1, gateDefaults, [{
    run: run(1),
    samples: [{ runId: 1, job: "Backend", path: "check", seconds: 50 }],
  }]);
  const result = evaluateBaseline(file, [
    { runId: 1, job: "Backend", path: "check", seconds: 999 },
    { runId: 2, job: "Backend", path: "check", seconds: 65 },
    { runId: 3, job: "Backend", path: "check", seconds: 66 },
    { runId: 3, job: "Unknown", path: "check", seconds: 999 },
    { runId: 4, job: "Backend", path: "publication", seconds: 999 },
  ]);
  assertEquals([result.runs, result.failedRuns], [2, 1]);
  assertEquals(result.jobChecks, [{ job: "Backend", path: "check", checked: 2, exceeded: 1 }]);
  assert(backTestTable(result).includes("**1 of 2**"));
  assert(backTestTable(evaluateBaseline(file, [])).includes("No held-out run"));
});
Deno.test("sampler reads only kept completed successes oldest first; rejects truncated windows", async () => {
  const calls: string[][] = [];
  const listed = [run(3, "pull_request"), run(2), { ...run(4), conclusion: "failure" }, run(1, "workflow_dispatch")];
  const result = await sampleBaseline(
    (args) => {
      calls.push([...args]);
      return Promise.resolve(
        args[0] === "run"
          ? JSON.stringify(
            listed.map((r) => ({ databaseId: r.id, ...r, createdAt: new Date(r.createdAt).toISOString() })),
          )
          : '{"jobs":[]}',
      );
    },
    "o/r",
    "ci.yml",
    "RANGE",
    isMain,
  );
  assertEquals(result.map((s) => s.run.id), [1, 2]);
  assertEquals(calls.length, 3);
  assert(calls[1]![1]!.includes("/1/jobs"));
  await assertRejects(
    () =>
      sampleBaseline(
        () =>
          Promise.resolve(
            JSON.stringify(
              Array.from(
                { length: 1000 },
                () => ({
                  databaseId: 1,
                  status: "completed",
                  conclusion: "success",
                  createdAt: new Date(t0).toISOString(),
                  event: "push",
                }),
              ),
            ),
          ),
        "o/r",
        "ci.yml",
        "RANGE",
        () => true,
      ),
    Error,
    "oldest runs would be left out",
  );
});

Deno.test("Z_ForATenthOfAPercentAcrossFiveJobs_IsAbout3Point54", () => {
  assertAlmostEquals(normalQuantile(1 - gateDefaults.alpha / gateDefaults.jobs), 3.540, 1e-3);
});
Deno.test("Threshold_OfASpreadJob_IsTheLogNormalBound", () => {
  const job = derive([200, 50, 100], gateDefaults);
  assertEquals(
    job.threshold,
    Math.ceil(100 * Math.exp(normalQuantile(1 - gateDefaults.alpha / gateDefaults.jobs) * 1.4826 * Math.log(2))),
  );
});
function originalSample() {
  return buildBaseline(
    "ci.yml",
    "docs/benchmarks/0014-ci-job-baseline.md",
    30,
    gateDefaults,
    [80, 79, 95, 76, 81].map((seconds, index) => ({
      run: { ...run(100 + index, "workflow_dispatch"), createdAt: t0 + index * 20 * 60000, headSha: `sha${index}` },
      samples: [{ runId: 100 + index, job: "Backend", path: "check", seconds }, {
        runId: 100 + index,
        job: "Frontend",
        path: "check",
        seconds: 45 - index,
      }],
    })),
  );
}
Deno.test("Write_IsDeterministicAndStatesTheWindowAndConstants", () => {
  const json = writeBaseline(originalSample());
  assertEquals(json, writeBaseline(originalSample()));
  assert(json.endsWith("}\n"));
  for (
    const text of [
      '"from": "2026-11-06T20:04:12Z"',
      '"to": "2026-11-06T21:24:12Z"',
      '"firstCommit": "sha0"',
      '"lastCommit": "sha4"',
      '"z": 3.2905',
      '"floorSeconds": 15',
      "exp(logMedian + z * 1.4826 * logMad)",
      "job's start-to-end seconds",
    ]
  ) assert(json.includes(text));
});
Deno.test("Evaluate_CountsOnlyDurationsAboveTheThreshold_AndSkipsJobsWithoutABaseline", () => {
  const baseline = originalSample(), threshold = baseline.paths.check!.jobs.Backend!.threshold;
  const result = evaluateBaseline(baseline, [
    { runId: 1, job: "Backend", path: "check", seconds: threshold },
    { runId: 2, job: "Backend", path: "check", seconds: threshold + 1 },
    { runId: 2, job: "Frontend", path: "check", seconds: 500 },
    { runId: 3, job: "Backend", path: "publication", seconds: 900 },
    { runId: 3, job: "Tooling", path: "check", seconds: 900 },
  ]);
  assertEquals([result.runs, result.failedRuns], [2, 1]);
  assertEquals(result.jobChecks, [{ job: "Backend", path: "check", checked: 2, exceeded: 1 }, {
    job: "Frontend",
    path: "check",
    checked: 1,
    exceeded: 1,
  }]);
  assertEquals(result.exceedances.map((item) => [item.runId, item.job]), [[2, "Backend"], [2, "Frontend"]]);
});
Deno.test("Evaluate_LeavesOutTheBaselinesOwnRuns", () => {
  const result = evaluateBaseline(originalSample(), [{ runId: 100, job: "Backend", path: "check", seconds: 900 }, {
    runId: 7,
    job: "Backend",
    path: "check",
    seconds: 60,
  }]);
  assertEquals([result.runs, result.failedRuns], [1, 0]);
  assertEquals(result.jobChecks, [{ job: "Backend", path: "check", checked: 1, exceeded: 0 }]);
});
Deno.test("BackTestTable_ReportsTheRateAndItsUpperBound", () => {
  const report = backTestTable(
    evaluateBaseline(originalSample(), [{ runId: 1, job: "Backend", path: "check", seconds: 60 }]),
  );
  assert(report.includes("| check | Backend | 1 | 0 | 0.0 % | 95.0 % |"));
  assert(report.includes("**0 of 1**"));
});
Deno.test("Table_AndWindow_ListEveryPathAndJob", () => {
  const baseline = originalSample();
  assert(baselineTable(baseline).includes("| check | Backend | 5 | 1:20 |"));
  assert(
    baselineWindow(baseline).includes(
      "| check | provisional | 5 | workflow_dispatch | 2026-11-06 20:04Z | 2026-11-06 21:24Z | 1.3 h | 5 |",
    ),
  );
});
Deno.test("Derive_KeepsTheSampleAscending_AndEqualsComparesTheSampleByValue", () => {
  const first = derive([90, 70, 80], gateDefaults);
  assertEquals(first.seconds, [70, 80, 90]);
  assertEquals(first, derive([80, 90, 70], gateDefaults));
  assertNotEquals(first, { ...first, seconds: [70, 80, 91] });
});
Deno.test("Write_ThenRead_KeepsTheSample", () => {
  const file = buildBaseline("ci.yml", "r.md", 1, gateDefaults, [{
    run: { ...run(1), createdAt: t0, headSha: "a" },
    samples: [{ runId: 1, job: "Backend", path: "publication", seconds: 81 }],
  }, {
    run: { ...run(2), createdAt: t0, headSha: "b" },
    samples: [{ runId: 2, job: "Backend", path: "publication", seconds: 79 }],
  }]);
  assertEquals(readBaseline(writeBaseline(file)).paths.publication!.jobs.Backend!.seconds, [79, 81]);
});
Deno.test("Window_FixedSpanUsesCSharpMidpointToEvenFormatting", () => {
  const sampled: SampledRun[] = [{
    run: { ...run(1), createdAt: t0 },
    samples: [{ runId: 1, job: "Backend", path: "check", seconds: 80 }],
  }, {
    run: { ...run(2), createdAt: t0 + 75 * 60000 },
    samples: [{ runId: 2, job: "Backend", path: "check", seconds: 80 }],
  }];
  const window = baselineWindow(buildBaseline("ci.yml", "r.md", 1, gateDefaults, sampled));
  assert(window.includes("| 1.2 h |"));
});
