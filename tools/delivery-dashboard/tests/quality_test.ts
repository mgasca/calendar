import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  type AttemptJob,
  buildQuality,
  classifyQuality,
  collectQuality,
  judgeRate,
  parseQualityJobs,
  parseQualityRuns,
  type QualityInput,
  type QualitySection,
  reusableJobs,
} from "../quality.ts";
import { validateQuality } from "../quality-rules.ts";
import { type WorkflowRun } from "../../ci-timings/timings.ts";
const noon = Date.parse("2026-11-09T12:00:00Z"), rule = { confidence: 0.95, minTrials: 20 };
function run(id: number, conclusion = "success", event = "pull_request", branch = "feature", minutes = 0): WorkflowRun {
  return {
    id,
    status: "completed",
    conclusion,
    createdAt: noon + minutes * 60000,
    event,
    headBranch: branch,
    headSha: "abc",
  };
}
function input(run: WorkflowRun, attempt = 1, jobs: AttemptJob[] = []): QualityInput {
  return { run: { run, attempt }, jobs };
}
function job(
  name: string,
  conclusion = "success",
  attempt = 1,
  steps: { name: string; conclusion: string }[] = [],
): AttemptJob {
  return { name, conclusion, attempt, steps };
}
function main(id: number, conclusion = "success", minutes = 0, jobs: AttemptJob[] = []): QualityInput {
  return input(run(id, conclusion, "push", "main", minutes), 1, jobs);
}
function errors(quality: unknown): string[] {
  const result: string[] = [];
  validateQuality({ quality }, result);
  return result;
}
function section(): QualitySection {
  return buildQuality("ci.yml", [
    main(7, "failure", 0, [
      ...Array.from({ length: 25 }, () => job("Backend")),
      job("Frontend", "failure", 1, [{ name: "Test and lint tooling", conclusion: "failure" }]),
    ]),
  ]);
}
Deno.test("quality classifies each conclusion and latest attempt", () => {
  for (
    const [conclusion, attempt, expected] of [
      ["success", 1, "passed"],
      ["success", 2, "passedAfterRerun"],
      ["failure", 1, "failed"],
      ["failure", 3, "failed"],
      ["timed_out", 1, "failed"],
      ["startup_failure", 1, "failed"],
      ["cancelled", 1, "cancelled"],
      ["skipped", 1, "other"],
      ["neutral", 1, "other"],
    ] as const
  ) assertEquals(classifyQuality(run(1, conclusion), attempt, new Set()), expected);
});
Deno.test("a replaced cancelled PR run is superseded rather than failed", () => {
  const scope = buildQuality("ci.yml", [
    input(run(1, "cancelled")),
    input(run(2, "success", "pull_request", "feature", 5)),
  ]).scopes[1]!;
  assertEquals([scope.runs.superseded, scope.runs.cancelled, scope.runs.failed, scope.runs.passed], [1, 0, 0, 1]);
});
Deno.test("cancelled PR run without newer run of same branch remains cancelled", () => {
  const scope = buildQuality("ci.yml", [
    input(run(1, "cancelled", "pull_request", "a")),
    input(run(2, "success", "pull_request", "b", 5)),
  ]).scopes[1]!;
  assertEquals([scope.runs.cancelled, scope.runs.superseded], [1, 0]);
});
Deno.test("cancelled push to main remains cancelled despite a later main run", () => {
  const scope = buildQuality("ci.yml", [main(1, "cancelled"), main(2, "success", 5)]).scopes[0]!;
  assertEquals([scope.runs.cancelled, scope.runs.superseded], [1, 0]);
});
Deno.test("reruns are counted and rerun passes are not clean passes", () => {
  const scope = buildQuality("ci.yml", [
    main(1),
    input(run(2, "success", "push", "main", 1), 2),
    input(run(3, "failure", "push", "main", 2), 3),
  ]).scopes[0]!;
  assertEquals(scope.runs, {
    total: 3,
    passed: 1,
    passedAfterRerun: 1,
    failed: 1,
    cancelled: 0,
    superseded: 0,
    other: 0,
    reruns: 2,
  });
  assertEquals(scope.rerunRunIds, [3, 2]);
  assertEquals(scope.failedRunIds, [3]);
});
Deno.test("unscoped and incomplete runs do not contribute", () => {
  const s = buildQuality("ci.yml", [
    input(run(1, "failure", "workflow_dispatch", "main")),
    input({ ...run(2, "", "push", "main"), status: "in_progress" }),
    input(run(3, "failure", "push", "feature")),
  ]);
  assertEquals(s.sample, { runs: 0, ignoredRuns: 2, window: null });
});
Deno.test("quality sample window spans counted runs", () => {
  assertEquals(
    buildQuality("ci.yml", [input(run(1, "success", "pull_request", "feature", -30)), main(2, "success", 10)]).sample
      .window,
    { from: "2026-11-09T11:30:00Z", to: "2026-11-09T12:10:00Z" },
  );
});
Deno.test("quality lists only newest fifty failed run IDs", () => {
  const scope = buildQuality("ci.yml", Array.from({ length: 60 }, (_, i) => main(i + 1, "failure", i + 1))).scopes[0]!;
  assertEquals(scope.runs.failed, 60);
  assertEquals(scope.failedRunIds.length, 50);
  assertEquals(scope.failedRunIds[0], 60);
  assertEquals(scope.failedRunIds.at(-1), 11);
});
Deno.test("quality always includes both scopes main first", () =>
  assertEquals(buildQuality("ci.yml", []).scopes.map((s) => s.scope), ["main", "pullRequest"]));
Deno.test("fewer trials are inconclusive without rate or interval", () => {
  assertEquals(judgeRate("Backend", false, 0, 19, rule), {
    job: "Backend",
    required: false,
    trials: 19,
    failures: 0,
    verdict: "inconclusive",
    rate: null,
    low: null,
    high: null,
  });
  const all = judgeRate("Backend", false, 3, 3, rule);
  assertEquals(all.verdict, "inconclusive");
  assertEquals(all.rate, null);
  assertEquals(all.low, null);
  assertEquals(all.high, null);
  assertEquals(all.failures, 3);
});
Deno.test("enough trials produce exact two-sided Clopper Pearson limits", () => {
  const none = judgeRate("Backend", false, 0, 20, rule), every = judgeRate("Backend", false, 20, 20, rule);
  assertEquals([none.verdict, none.rate, none.low, none.high], ["conclusive", 0, 0, 0.1684]);
  assertEquals([every.rate, every.low, every.high], [1, 0.8316, 1]);
});
Deno.test("quality confidence interval matches known values", () => {
  const half = judgeRate("a", false, 5, 10, { confidence: 0.95, minTrials: 10 }),
    one = judgeRate("a", false, 1, 10, { confidence: 0.95, minTrials: 10 });
  assertEquals([half.rate, half.low, half.high], [0.5, 0.1871, 0.8129]);
  assertEquals([one.rate, one.low, one.high], [0.1, 0.0025, 0.445]);
});
Deno.test("cancelled or skipped jobs are not trials and failed first rerun attempts count", () => {
  const backend = buildQuality("ci.yml", [
    main(1, "success", 0, [
      job("Backend"),
      job("Backend", "cancelled"),
      job("Backend", "skipped"),
      job("Backend", "failure", 1),
      job("Backend", "success", 2),
      job("Backend", "timed_out"),
    ]),
  ]).scopes[0]!.jobs[0]!;
  assertEquals([backend.trials, backend.failures], [4, 2]);
});
Deno.test("cancelled runs contribute no job trial even when CI result failed", () => {
  const scope = buildQuality("ci.yml", [
    main(1, "cancelled", 0, [job("CI result", "failure"), job("Backend", "cancelled")]),
    main(2, "success", 1, [job("CI result"), job("Backend")]),
  ]).scopes[0]!;
  const result = scope.jobs.find((j) => j.job === "CI result")!;
  assertEquals([result.failures, result.trials, scope.runs.cancelled], [0, 1, 1]);
});
Deno.test("quality job rows are sorted and required check flagged", () => {
  const rows =
    buildQuality("ci.yml", [main(1, "failure", 0, [job("Tooling"), job("CI result", "failure"), job("Backend")])])
      .scopes[0]!.jobs;
  assertEquals(rows.map((j) => j.job), ["Backend", "CI result", "Tooling"]);
  assertEquals(rows.find((j) => j.required)!.job, "CI result");
});
Deno.test("guard failures group by UTC creation day and tooling step", () => {
  const step = (conclusion: string) => ({ name: "Test and lint tooling", conclusion });
  const inputs = [
    main(1, "failure", 0, [job("Tooling", "failure", 1, [step("failure")])]),
    main(2, "success", 5, [job("Tooling", "success", 1, [step("success")])]),
    main(3, "success", 1440, [
      job("Tooling", "success", 1, [step("success"), { name: "Other", conclusion: "failure" }]),
    ]),
    main(4, "success", 1445, [job("Tooling", "success", 1, [step("skipped")])]),
  ];
  assertEquals(buildQuality("ci.yml", inputs).scopes[0]!.guardDays, [{ date: "2026-11-09", trials: 2, failures: 1 }, {
    date: "2026-11-10",
    trials: 1,
    failures: 0,
  }]);
});
Deno.test("REST quality runs read attempts and skip incomplete records", () => {
  const runs = parseQualityRuns(
    '{"total_count":3,"workflow_runs":[{"id":11,"status":"completed","conclusion":"success","created_at":"2026-11-09T10:00:00Z","event":"push","head_branch":"main","head_sha":"a","run_attempt":2},{"status":"completed","created_at":"2026-11-09T10:00:00Z"},{"id":12,"status":"completed","conclusion":null,"created_at":"2026-11-09T10:01:00Z","event":"pull_request"}]}',
  );
  assertEquals(runs.map((r) => [r.run.id, r.attempt, r.run.conclusion]), [[11, 2, "success"], [12, 1, ""]]);
});
Deno.test("REST quality jobs retain all attempts and steps", () => {
  const jobs = parseQualityJobs(
    '{"jobs":[{"name":"Tooling","conclusion":"failure","run_attempt":1,"steps":[{"name":"Test and lint tooling","conclusion":"failure"}]},{"name":"Tooling","conclusion":"success","run_attempt":2,"steps":[]},{"conclusion":"success"}]}',
  );
  assertEquals(jobs.map((j) => [j.name, j.conclusion, j.attempt]), [["Tooling", "failure", 1], [
    "Tooling",
    "success",
    2,
  ]]);
  assertEquals(jobs[0]!.steps[0]!.conclusion, "failure");
});
Deno.test("quality REST responses missing list return no entries", () => {
  for (const json of ["{}", '{"workflow_runs":5}']) {
    assertEquals(parseQualityRuns(json), []);
    assertEquals(parseQualityJobs(json), []);
  }
});
Deno.test("quality schema validates generated stable and empty sections; optional absence remains valid", () => {
  assertEquals(errors(section()), []);
  assertEquals(JSON.stringify(section()), JSON.stringify(section()));
  assertEquals(errors(buildQuality("ci.yml", [])), []);
  const result: string[] = [];
  validateQuality({}, result);
  assertEquals(result, []);
});
Deno.test("inconclusive quality row serializes null rate directly after verdict", () => {
  assertStringIncludes(JSON.stringify(section().scopes[0]!.jobs[1]), '"verdict":"inconclusive","rate":null');
});
Deno.test("unknown quality fields fail at their schema path", () => {
  const s = section();
  Object.assign(s.scopes[0]!, { actor: "x" });
  assert(errors(s).includes("$.quality.scopes[0].actor: field is not in the schema"));
});
Deno.test("bad quality values fail at exact paths", () => {
  const cases: [(s: QualitySection) => void, string][] = [
    [(s) => {
      s.scopes[0]!.listQuery = "actor:someone";
    }, "$.quality.scopes[0].listQuery"],
    [(s) => {
      s.rule.minTrials = 30;
    }, "$.quality.scopes[0].jobs[0].verdict"],
    [(s) => {
      s.scopes[0]!.runs.total = 9;
    }, "$.quality.scopes[0].runs.total"],
    [(s) => {
      Object.assign(s.scopes[0]!.jobs[0]!, { required: "no" });
    }, "$.quality.scopes[0].jobs[0].required"],
    [(s) => {
      s.basis.guards = "guessed";
    }, "$.quality.basis.guards"],
    [(s) => {
      s.scopes[0]!.failedRunIds[0] = 0;
    }, "$.quality.scopes[0].failedRunIds[0]"],
  ];
  for (const [mutate, path] of cases) {
    const s = section();
    mutate(s);
    assert(errors(s).some((error) => error.startsWith(path)), path);
  }
});
Deno.test("inconclusive quality rates are forbidden", () => {
  const s = section();
  s.scopes[0]!.jobs[1]!.rate = 0;
  assert(errors(s).some((error) => error.includes("inconclusive row must carry no rate")));
});
Deno.test("conclusive quality intervals must contain rate", () => {
  const s = section();
  s.scopes[0]!.jobs[0]!.high = -0.5;
  assert(errors(s).some((error) => error.includes("low <= rate <= high")));
});
Deno.test("quality window required when counted runs exist", () => {
  const s = buildQuality("ci.yml", []);
  s.sample.runs = 5;
  assert(errors(s).length > 0);
});
Deno.test("untrusted pull request job names absent from main are dropped", () => {
  for (const name of ["/home/someone/dev", "someone@example.com", "session_1a2b3c4d", "CI result"]) {
    const s = buildQuality("ci.yml", [
      main(1, "success", 1, [job("Backend")]),
      input(run(2), 1, [job("Backend"), job(name)]),
    ]);
    assertEquals(s.scopes[1]!.jobs.map((j) => j.job), ["Backend"]);
    assertEquals(errors(s), []);
  }
});
Deno.test("pull request jobs also present on main retain required flag", () => {
  const s = buildQuality("ci.yml", [
    main(1, "success", 1, [job("Backend"), job("CI result")]),
    input(run(2), 1, [job("Backend"), job("CI result")]),
  ]);
  assertEquals(s.scopes[1]!.jobs.map((j) => j.job), ["Backend", "CI result"]);
  assertEquals(s.scopes[1]!.jobs.find((j) => j.required)!.job, "CI result");
});
Deno.test("CI section job responses are reusable only for never rerun runs", () => {
  const known = new Map([[1, '{"jobs":[]}'], [2, '{"jobs":[]}']]);
  assertEquals(reusableJobs({ run: run(1), attempt: 1 }, known), '{"jobs":[]}');
  assertEquals(reusableJobs({ run: run(2), attempt: 2 }, known), null);
  assertEquals(reusableJobs({ run: run(3), attempt: 1 }, known), null);
  assertEquals(reusableJobs({ run: run(1), attempt: 1 }, null), null);
});
Deno.test("quality collector pages completed runs and reuses only all-attempt-complete jobs", async () => {
  const calls: string[][] = [];
  const rows = Array.from(
    { length: 101 },
    (_, i) => ({
      id: i + 1,
      created_at: "2026-11-09T12:00:00Z",
      status: "completed",
      conclusion: "success",
      event: "push",
      head_branch: "main",
      run_attempt: i === 0 ? 2 : 1,
    }),
  );
  const inputs = await collectQuality(
    "o/r",
    "ci.yml",
    101,
    new Map([[2, '{"jobs":[{"name":"Backend","conclusion":"success"}]}']]),
    (args) => {
      calls.push([...args]);
      const endpoint = args[1]!;
      if (endpoint.includes("workflows")) {
        return Promise.resolve(
          JSON.stringify({ workflow_runs: endpoint.endsWith("page=1") ? rows.slice(0, 100) : rows.slice(100) }),
        );
      }
      return Promise.resolve('{"jobs":[]}');
    },
  );
  assertEquals(inputs.length, 101);
  assertEquals(calls.length, 102);
  assert(calls.some((args) => args[1]!.includes("/runs/1/jobs?filter=all")));
  assert(!calls.some((args) => args[1]!.includes("/runs/2/jobs")));
  assertEquals(inputs[1]!.jobs[0]!.name, "Backend");
});
Deno.test("quality deterministic output matches retained C# oracle for ninety mixed runs and all attempts", async () => {
  const expected = JSON.parse(await Deno.readTextFile(new URL("fixtures/quality-parity.json", import.meta.url)));
  const conclusions = ["success", "failure", "cancelled", "timed_out", "startup_failure", "neutral", "skipped"];
  const inputs = Array.from({ length: 90 }, (_, index) => {
    const conclusion = conclusions[index % 7]!,
      event = index % 3 === 0 ? "push" : "pull_request",
      branch = index % 3 === 0 ? "main" : `feature-${index % 4}`,
      attempt = index % 3 + 1;
    const jobs: AttemptJob[] = [];
    for (const name of ["Backend", "Tooling", "CI result"]) {
      for (let a = 1; a <= attempt; a++) {
        const verdict = a < attempt ? "failure" : conclusion;
        jobs.push(job(name, verdict, a, [{ name: "Test and lint tooling", conclusion: verdict }]));
      }
    }
    if (event === "pull_request") jobs.push(job("Untrusted"));
    return input(run(index + 1, conclusion, event, branch, index), attempt, jobs);
  });
  assertEquals(buildQuality("ci.yml", inputs), expected);
});
Deno.test("private quality job text fails root privacy validation at exact schema path", async () => {
  const { validateSnapshot } = await import("../snapshot-rules.ts"),
    { buildCi, writeSnapshot } = await import("../snapshot.ts");
  for (
    const [text, reason] of [["/home/someone/dev", "machine path"], ["session_1a2b3c4d", "session or task handle"], [
      "someone@example.com",
      "e-mail address",
    ]]
  ) {
    const quality = section();
    quality.scopes[0]!.jobs[1]!.job = text!;
    const json = writeSnapshot({
      version: 3,
      date: "2026-11-09",
      generatedAt: "2026-11-09T12:00:00Z",
      repository: "mgasca/calendar",
      ci: buildCi("ci.yml", []),
      quality,
      superseded: null,
    });
    assert(
      validateSnapshot(json).some((error) =>
        error.startsWith("$.quality.scopes[0].jobs[1].job") && error.includes(reason!)
      ),
      reason,
    );
  }
});
