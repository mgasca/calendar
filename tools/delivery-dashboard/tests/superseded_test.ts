import { assert, assertEquals } from "@std/assert";
import { buildSuperseded, supersededDone, type SupersededSection, weekStart } from "../superseded.ts";
import {
  type JobTiming,
  measurePair,
  pairRuns,
  type SupersededPair,
  type WorkflowRun,
} from "../../ci-timings/timings.ts";
import { buildCi, writeSnapshot } from "../snapshot.ts";
import { validateSnapshot } from "../snapshot-rules.ts";
const weekOne = Date.parse("2026-11-03T10:00:00Z"), weekTwo = Date.parse("2026-11-10T10:00:00Z");
function pair(at: number, wait: number | null, gap = 60, id = 1): SupersededPair {
  return {
    cancelledRunId: id,
    supersedingRunId: id + 1000,
    supersededAt: at,
    pushGap: gap,
    wait,
    allStarted: wait,
    cancelNotHeardAt: null,
    cancelHeardBy: null,
    cancelledJobsEnd: null,
    runEnd: 30,
    jobsNotCancelled: "",
  };
}
function section(): SupersededSection {
  return buildSuperseded(
    [pair(weekOne, 10), pair(weekOne + 3600000, 20, 60, 2), pair(weekOne + 7200000, 30, 60, 3)],
    1,
    [{ created: weekOne, wait: 4 }],
    30,
  )!;
}
function json(s: SupersededSection | null = section()): string {
  return writeSnapshot({
    version: 3,
    date: "2026-11-09",
    generatedAt: "2026-11-10T10:00:00Z",
    repository: "mgasca/calendar",
    ci: buildCi("ci.yml", []),
    superseded: s,
  });
}
Deno.test("superseded weeks start on Monday UTC", () => {
  for (
    const [at, monday] of [["2026-11-02T00:00:00Z", "2026-11-02"], ["2026-11-08T23:59:59Z", "2026-11-02"], [
      "2026-11-09T00:00:00Z",
      "2026-11-09",
    ], ["2026-11-10T10:00:00Z", "2026-11-09"]]
  ) assertEquals(weekStart(Date.parse(at!)), monday);
});
Deno.test("superseded pair weekly timing aggregates preserve nearest rank and controls", () => {
  const s = buildSuperseded(
    [
      pair(weekOne, 10, 100, 1),
      pair(weekOne + 3600000, 20, 200, 2),
      pair(weekOne + 7200000, 30, 300, 3),
      pair(weekTwo, 50, 400, 4),
    ],
    2,
    [{ created: weekOne, wait: 4 }, { created: weekOne + 10800000, wait: 6 }, { created: weekTwo, wait: 8 }],
    30,
  )!;
  assertEquals([s.sample.pairs, s.sample.ignored, s.sample.controlRuns], [4, 2, 3]);
  assertEquals(s.weeks, [{
    week: "2026-11-02",
    pairs: 3,
    waitRuns: 3,
    waitMedianSeconds: 20,
    waitP90Seconds: 30,
    waitMaxSeconds: 30,
    pushGapMedianSeconds: 200,
    controlRuns: 2,
    controlWaitMedianSeconds: 4,
  }, {
    week: "2026-11-09",
    pairs: 1,
    waitRuns: 1,
    waitMedianSeconds: 50,
    waitP90Seconds: 50,
    waitMaxSeconds: 50,
    pushGapMedianSeconds: 400,
    controlRuns: 1,
    controlWaitMedianSeconds: 8,
  }]);
  assertEquals(s.sample.window, { from: "2026-11-03T10:00:00Z", to: "2026-11-10T10:00:00Z" });
});
Deno.test("control-only superseded week has no pair statistics or sample window", () => {
  const s = buildSuperseded([], 0, [{ created: weekOne, wait: 5 }], 30)!;
  assertEquals(s.weeks, [{
    week: "2026-11-02",
    pairs: 0,
    waitRuns: 0,
    waitMedianSeconds: null,
    waitP90Seconds: null,
    waitMaxSeconds: null,
    pushGapMedianSeconds: null,
    controlRuns: 1,
    controlWaitMedianSeconds: 5,
  }]);
  assertEquals(s.sample.window, null);
});
Deno.test("pairs lacking first job still count without adding wait", () => {
  const s = buildSuperseded([pair(weekOne, null), pair(weekOne, 12, 60, 2)], 0, [], 30)!;
  assertEquals([s.weeks[0]!.pairs, s.weeks[0]!.waitRuns, s.weeks[0]!.waitMedianSeconds], [2, 1, 12]);
});
Deno.test("ignored manual cancels count toward examination bound", () => {
  for (
    const [measured, ignored, done] of [[29, 0, false], [30, 0, true], [5, 54, false], [5, 55, true], [
      0,
      60,
      true,
    ]] as const
  ) assertEquals(supersededDone(measured, ignored, 30), done);
});
Deno.test("nothing sampled produces null superseded section", () => assertEquals(buildSuperseded([], 0, [], 30), null));
function run(id: number, conclusion: string, createdAt: number, headBranch = "feature"): WorkflowRun {
  return { id, status: "completed", conclusion, createdAt, event: "pull_request", headBranch, headSha: "" };
}
function job(runId: number, startedAt: number, completedAt: number, conclusion: string): JobTiming {
  return {
    runId,
    name: "Backend",
    conclusion,
    startedAt,
    completedAt,
    steps: [],
    createdAt: null,
    seconds: (completedAt - startedAt) / 1000,
  };
}
Deno.test("pair matches next same branch run and measures wait while control remains separate", () => {
  const t = Date.parse("2026-11-03T09:00:00Z"),
    cancelled = run(1, "cancelled", t),
    newer = run(2, "success", t + 120000),
    other = run(3, "success", t + 60000, "other-branch");
  assertEquals(pairRuns([cancelled, newer, other]), [{ cancelled, superseding: newer }]);
  const measured = measurePair(cancelled, newer, [job(1, t + 5000, t + 180000, "cancelled")], [
    job(2, t + 134000, t + 480000, "success"),
  ])!;
  assertEquals([measured.wait, measured.pushGap], [14, 120]);
});
Deno.test("manual cancel ending before next push produces no measured pair", () => {
  const t = Date.parse("2026-11-03T09:00:00Z");
  assertEquals(
    measurePair(run(1, "cancelled", t), run(2, "success", t + 600000), [job(1, t + 5000, t + 60000, "cancelled")], [
      job(2, t + 600000, t + 720000, "success"),
    ]),
    null,
  );
});
Deno.test("superseded section and explicit null validate", () => {
  assertEquals(validateSnapshot(json()), []);
  assertEquals(validateSnapshot(json(null)), []);
});
Deno.test("superseded output contains only aggregates and no run IDs or branches", () => {
  const value = json();
  assert(!value.includes("1001"));
  assert(!value.includes('"branch'));
  assert(!value.includes("feature"));
});
Deno.test("version two cannot carry superseded and version three requires it", () => {
  assert(
    validateSnapshot(json().replace('"version": 3', '"version": 2')).includes(
      "$.superseded: field is not in the schema before version 3",
    ),
  );
  const value = json(null).replace(',\n  "superseded": null', "");
  assert(!value.includes("superseded"));
  assert(validateSnapshot(value).includes("$.superseded: field is missing (null when not sampled)"));
});
Deno.test("bad superseded values fail at each original schema path", () => {
  const cases: [(s: SupersededSection) => void, string][] = [[(s) => {
    s.basis.detection = "guessed";
  }, "$.superseded.basis.detection"], [(s) => {
    s.sample.pairs = 4;
  }, "$.superseded.weeks"], [(s) => {
    s.sample.cap = 2;
  }, "$.superseded.sample.pairs"], [(s) => {
    s.weeks[0]!.week = "2026-11-03";
  }, "$.superseded.weeks[0].week"], [(s) => {
    s.weeks[0]!.waitP90Seconds = 5;
  }, "$.superseded.weeks[0]"], [(s) => {
    s.weeks[0]!.waitRuns = 4;
  }, "$.superseded.weeks[0].waitRuns"], [(s) => {
    s.weeks[0]!.controlRuns = 0;
  }, "$.superseded.weeks[0].controlWaitMedianSeconds"]];
  for (const [change, path] of cases) {
    const s = section();
    change(s);
    assert(validateSnapshot(json(s)).some((e) => e.startsWith(path)), path);
  }
});
