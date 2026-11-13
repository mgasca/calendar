import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { buildCi, queueSeconds, type Snapshot, writeSnapshot } from "../snapshot.ts";
import { validateSnapshot } from "../snapshot-rules.ts";
import { type BaselineFile, gateDefaults, type SampledRun } from "../../ci-timings/baseline.ts";
import type { JobTiming } from "../../ci-timings/timings.ts";
const noon = Date.parse("2026-11-09T12:00:00Z");
function run(id: number, hoursAgo: number, ...samples: [string, string, number][]): SampledRun {
  return {
    run: {
      id,
      status: "completed",
      conclusion: "success",
      createdAt: noon - hoursAgo * 3600000,
      event: "push",
      headBranch: "main",
      headSha: "abc",
    },
    samples: samples.map(([job, path, seconds]) => ({ runId: id, job, path, seconds })),
  };
}
function sample(job = "Backend", repository = "mgasca/calendar"): Snapshot {
  return {
    version: 3,
    date: "2026-11-09",
    generatedAt: "2026-11-09T12:00:00Z",
    repository,
    ci: {
      workflow: "ci.yml",
      basis: "measured",
      runs: 2,
      window: { from: "2026-11-09T08:00:00Z", to: "2026-11-09T11:00:00Z" },
      trend: null,
      queue: null,
      jobs: [{
        job,
        path: "check",
        count: 2,
        minSeconds: 70,
        medianSeconds: 75,
        p90Seconds: 80,
        maxSeconds: 80,
        baseline: null,
        trend: null,
      }],
    },
  };
}
const pinned: BaselineFile = {
  workflow: "ci.yml",
  record: "docs/benchmarks/0017-ci-baseline-with-changes.md",
  minRuns: 30,
  constants: gateDefaults,
  paths: {
    check: {
      path: "check",
      status: "pinned",
      runs: [{ ...run(900, 120).run, headSha: "base" }],
      jobs: {
        Backend: {
          count: 30,
          median: 80,
          logMedian: 4.38,
          logMad: 0.08,
          p90: 90,
          p95: 92,
          max: 95,
          threshold: 126,
          seconds: Array.from({ length: 30 }, (_, i) => 76 + i % 9),
        },
      },
    },
  },
};
function recent(n: number, seconds: number): SampledRun[] {
  return Array.from(
    { length: n },
    (_, i) => run(i + 1, n - i, ["Backend", "check", seconds + i % 3], ["Docs site", "check", 50]),
  );
}
Deno.test("CI samples group by job and path with stable sorting and nearest rank", () => {
  const ci = buildCi("ci.yml", [
    run(1, 3, ["Frontend", "publication", 60], ["Backend", "publication", 80]),
    run(2, 2, ["Frontend", "publication", 70], ["Backend", "publication", 90], ["Backend", "check", 70]),
    run(3, 1, ["Frontend", "publication", 50], ["Backend", "publication", 100]),
  ]);
  assertEquals(ci.jobs.map((j) => [j.job, j.path, j.count]), [["Backend", "check", 1], ["Backend", "publication", 3], [
    "Frontend",
    "publication",
    3,
  ]]);
  assertEquals([ci.jobs[1]!.minSeconds, ci.jobs[1]!.medianSeconds, ci.jobs[1]!.maxSeconds], [80, 90, 100]);
  assertEquals(buildCi("ci.yml", [run(1, 1, ["Backend", "check", 79.96])]).jobs[0]!.medianSeconds, 80);
});
Deno.test("CI window spans every sampled run, empty sample has null window and no jobs", () => {
  const ci = buildCi("ci.yml", [run(1, 5, ["Backend", "check", 80]), run(2, 1, ["Backend", "check", 82])]);
  assertEquals(ci.runs, 2);
  assertEquals(ci.basis, "measured");
  assertEquals(ci.window, { from: "2026-11-09T07:00:00Z", to: "2026-11-09T11:00:00Z" });
  const empty = buildCi("ci.yml", []);
  assertEquals(empty.runs, 0);
  assertEquals(empty.window, null);
  assertEquals(empty.jobs, []);
});
Deno.test("pinned baseline and exact shared trend distinguish slower unchanged and inconclusive", () => {
  const normal = buildCi("ci.yml", recent(20, 80), pinned);
  assertEquals(normal.jobs[0]!.baseline, { count: 30, medianSeconds: 80, thresholdSeconds: 126 });
  assertEquals(normal.jobs[1]!.baseline, null);
  assertEquals(normal.jobs[1]!.trend, null);
  const slower = buildCi("ci.yml", recent(20, 125), pinned);
  assertEquals(slower.jobs[0]!.trend!.verdict, "slower");
  assert(slower.jobs[0]!.trend!.shiftSeconds > slower.jobs[0]!.trend!.minEffectSeconds);
  assertEquals([slower.trend!.runs, slower.trend!.required], [20, 20]);
  assertEquals(buildCi("ci.yml", recent(20, 79), pinned).jobs[0]!.trend!.verdict, "noShift");
  const thin = buildCi("ci.yml", recent(5, 125), pinned);
  assertEquals(thin.jobs[0]!.trend!.verdict, "inconclusive");
  assertEquals(thin.trend!.runs, 5);
  const noBaseline = buildCi("ci.yml", recent(20, 80));
  assertEquals(noBaseline.trend, null);
  assert(noBaseline.jobs.every((j) => j.baseline === null && j.trend === null));
});
Deno.test("queue starts at first job and rejects jobs that predate run creation", () => {
  const r = run(1, 0).run;
  const job = (offset: number): JobTiming => ({
    runId: 1,
    name: "Job",
    conclusion: "success",
    startedAt: noon + offset * 1000,
    completedAt: noon + (offset + 10) * 1000,
    steps: [],
    createdAt: null,
    seconds: 10,
  });
  assertEquals(queueSeconds(r, [job(12), job(5)]), 5);
  assertEquals(queueSeconds(r, [job(-3)]), null);
  assertEquals(queueSeconds(r, []), null);
  assertEquals(buildCi("ci.yml", recent(3, 80), null, undefined, [4, 6, 20]).queue, {
    runs: 3,
    medianSeconds: 6,
    p90Seconds: 20,
    maxSeconds: 20,
  });
});
Deno.test("written snapshots are stable valid newline-terminated with empty and rich CI sections", () => {
  const json = writeSnapshot(sample());
  assertEquals(validateSnapshot(json), []);
  assertEquals(writeSnapshot(sample()), json);
  assert(json.endsWith("\n"));
  assertEquals(validateSnapshot(writeSnapshot({ ...sample(), ci: buildCi("ci.yml", []) })), []);
  const rich = writeSnapshot({ ...sample(), ci: buildCi("ci.yml", recent(20, 125), pinned, undefined, [3, 4]) });
  assertEquals(validateSnapshot(rich), []);
  assertStringIncludes(rich, '"verdict": "slower"');
});
for (
  const value of [
    "/home/someone/dev/calendar",
    "/tmp/claude-1000/scratch",
    "/Users/someone/work",
    "C:\\Users\\someone",
    "run at /var/log/ci",
  ]
) {
  Deno.test("machine path privacy: " + value, () => {
    assert(
      validateSnapshot(writeSnapshot(sample(value))).some((e) =>
        e.startsWith("$.ci.jobs[0].job") && e.includes("machine path")
      ),
    );
  });
}
for (const value of ["session_1a2b3c4d", "task_ab12cd34", "local_00c4a7b6", "subagent-9f8e7d6c"]) {
  Deno.test("handle privacy: " + value, () => {
    assert(
      validateSnapshot(writeSnapshot(sample(value))).some((e) => e.includes("session or task handle")),
    );
  });
}
Deno.test("UUID email and private property names fail while public job names pass", () => {
  assert(
    validateSnapshot(writeSnapshot(sample("00c4a7b6-5386-4014-b060-b918412cd279"))).some((e) => e.includes("UUID")),
  );
  assert(validateSnapshot(writeSnapshot(sample("someone@example.com"))).some((e) => e.includes("e-mail address")));
  const value = JSON.parse(writeSnapshot(sample()));
  value["/home/someone"] = "x";
  assert(validateSnapshot(JSON.stringify(value)).some((e) => e.includes("(field name)") && e.includes("machine path")));
  for (const name of ["Backend", "Docs site", "Container image", "ADR conventions", "CI result"]) {
    assertEquals(validateSnapshot(writeSnapshot(sample(name))), []);
  }
});
Deno.test("strict root nested schema missing fields versions and invalid files", () => {
  const base = JSON.parse(writeSnapshot(sample()));
  let value = structuredClone(base);
  value.author = "x";
  assert(validateSnapshot(JSON.stringify(value)).includes("$.author: field is not in the schema"));
  value = structuredClone(base);
  value.ci.jobs[0].login = "x";
  assert(validateSnapshot(JSON.stringify(value)).includes("$.ci.jobs[0].login: field is not in the schema"));
  value = structuredClone(base);
  delete value.ci.basis;
  assert(validateSnapshot(JSON.stringify(value)).includes("$.ci.basis: field is missing"));
  value = structuredClone(base);
  value.version = 4;
  assert(validateSnapshot(JSON.stringify(value)).includes("$.version: must be 1 to 3"));
  for (const text of ["", "not json", "[]", "{}"]) assert(validateSnapshot(text).length > 0);
});
Deno.test("bad scalar values and duration ordering fail at exact paths", () => {
  const mutations: [string, unknown, string][] = [
    ["date", "09/11/2026", "$.date"],
    ["generatedAt", "yesterday", "$.generatedAt"],
    ["repository", "not a repository", "$.repository"],
    ["ci.workflow", "../ci.sh", "$.ci.workflow"],
    ["ci.basis", "guessed", "$.ci.basis"],
    ["ci.jobs.0.path", "elsewhere", "$.ci.jobs[0].path"],
    ["ci.jobs.0.count", 0, "$.ci.jobs[0].count"],
  ];
  for (const [path, bad, prefix] of mutations) {
    const value = JSON.parse(writeSnapshot(sample()));
    const parts = path.split(".");
    let owner = value;
    for (const part of parts.slice(0, -1)) owner = owner[part];
    owner[parts.at(-1)!] = bad;
    assert(validateSnapshot(JSON.stringify(value)).some((e) => e.startsWith(prefix)), prefix);
  }
  const outOfOrder = JSON.parse(writeSnapshot(sample()));
  outOfOrder.ci.jobs[0].minSeconds = 99;
  assert(validateSnapshot(JSON.stringify(outOfOrder)).some((e) => e.includes("minSeconds <= medianSeconds")));
  const empty = JSON.parse(writeSnapshot({ ...sample(), ci: buildCi("ci.yml", []) }));
  empty.ci.runs = 3;
  assert(validateSnapshot(JSON.stringify(empty)).includes("$.ci.window: must be set when runs is above 0"));
});
Deno.test("version one still validates, forbids version two fields, version two requires them", () => {
  const v1 = JSON.parse(writeSnapshot(sample()));
  v1.version = 1;
  delete v1.superseded;
  delete v1.ci.trend;
  delete v1.ci.queue;
  for (const job of v1.ci.jobs) {
    delete job.baseline;
    delete job.trend;
  }
  assertEquals(validateSnapshot(JSON.stringify(v1)), []);
  const extra = structuredClone(v1);
  extra.ci.queue = null;
  assert(validateSnapshot(JSON.stringify(extra)).includes("$.ci.queue: field is not in the schema"));
  const v2 = structuredClone(v1);
  v2.version = 2;
  assert(validateSnapshot(JSON.stringify(v2)).includes("$.ci.trend: field is missing"));
});
Deno.test("bad version two fields fail at exact paths", () => {
  const ci = buildCi("ci.yml", recent(20, 125), pinned, undefined, [5, 7, 9]), base = { ...sample(), ci };
  assertEquals(validateSnapshot(writeSnapshot(base)), []);
  for (
    const [mutate, path] of [
      [(v: Snapshot) => {
        v.ci.jobs[0]!.trend!.verdict = "awful";
      }, "$.ci.jobs[0].trend.verdict"],
      [(v: Snapshot) => {
        v.ci.trend!.required = 0;
      }, "$.ci.trend.required"],
      [(v: Snapshot) => {
        v.ci.jobs[0]!.baseline!.thresholdSeconds = -1;
      }, "$.ci.jobs[0].baseline.thresholdSeconds"],
      [(v: Snapshot) => {
        v.ci.queue!.p90Seconds = 1;
      }, "$.ci.queue"],
    ] as const
  ) {
    const value = structuredClone(base);
    mutate(value);
    assert(validateSnapshot(writeSnapshot(value)).some((e) => e.startsWith(path)), path);
  }
});
Deno.test("all docs-site valid fixtures pass the same schema and privacy rules", async () => {
  const dir = new URL("../../../frontend/apps/docs/src/lib/fixtures/dashboard/valid/snapshots/", import.meta.url);
  let files = 0;
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.name.endsWith(".json")) continue;
    files++;
    assertEquals(validateSnapshot(await Deno.readTextFile(new URL(entry.name, dir))), [], entry.name);
  }
  assert(files > 1);
});
Deno.test("scheduled reporting workflow uses pinned Deno frozen permissions and unchanged publication split", async () => {
  const text = await Deno.readTextFile(new URL("../../../.github/workflows/dashboard-snapshot.yml", import.meta.url));
  assertStringIncludes(text, "denoland/setup-deno@");
  assertStringIncludes(text, "deno-version-file: .deno-version");
  assertStringIncludes(text, "--frozen --no-prompt");
  assertStringIncludes(text, "permissions: {}");
  assertStringIncludes(text, "      actions: read\n      contents: read\n");
  assertStringIncludes(text, "      contents: write\n");
  assertStringIncludes(text, "      issues: write\n");
  assertStringIncludes(text, "schedule:");
  assertStringIncludes(text, "workflow_dispatch:");
  assert(!text.includes("setup-dotnet"));
});
Deno.test("privacy scan retains duplicate property occurrences and decoded escape sequences", () => {
  const json = writeSnapshot(sample()).replace(
    '"repository": "mgasca/calendar"',
    '"repository":"/home/hidden", "repository": "mgasca/calendar"',
  );
  assert(validateSnapshot(json).includes("$.repository: looks like a machine path"));
  const escaped = writeSnapshot(sample()).replace('"Backend"', '"\\u002fhome/private"');
  assert(validateSnapshot(escaped).includes("$.ci.jobs[0].job: looks like a machine path"));
  assert(validateSnapshot("[".repeat(65) + "0" + "]".repeat(65)).some((e) => e.includes("maximum JSON depth")));
});
Deno.test("privacy email matching preserves Unicode word characters", () => {
  assert(validateSnapshot(writeSnapshot(sample("josé@exámple.com"))).some((e) => e.includes("e-mail address")));
});

Deno.test("privacy handles long email near matches without losing detection", () => {
  for (const value of ["a".repeat(100_000), "a@" + "b".repeat(100_000), ("a@" + "b".repeat(1000) + "!").repeat(100)]) {
    assert(!validateSnapshot(JSON.stringify({ value })).some((e) => e.includes("e-mail address")));
  }
  assert(
    validateSnapshot(JSON.stringify({ value: "a".repeat(100_000) + "@example.com" })).some((e) =>
      e.includes("e-mail address")
    ),
  );
});
