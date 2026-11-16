import { assert, assertEquals } from "@std/assert";
import { buildE2e, collectE2e, type E2eSection, type ListedRun, parseListedRuns } from "../e2e.ts";
import { type Snapshot, writeSnapshot } from "../snapshot.ts";
import { validateSnapshot } from "../snapshot-rules.ts";

const night = (day: number) => Date.parse(`2026-11-${String(day).padStart(2, "0")}T03:17:00Z`);
function listed(id: number, day: number, overrides: Partial<ListedRun> = {}): ListedRun {
  return {
    id,
    status: "completed",
    conclusion: "success",
    event: "schedule",
    headBranch: "main",
    createdAt: night(day),
    startedAt: night(day) + 5000,
    updatedAt: night(day) + 5000 + 1200500,
    ...overrides,
  };
}
function snapshot(e2e: E2eSection | null | undefined, version = 4): Snapshot {
  return {
    version,
    date: "2026-11-09",
    generatedAt: "2026-11-09T12:00:00Z",
    repository: "mgasca/calendar",
    ci: { workflow: "ci.yml", basis: "measured", runs: 0, window: null, trend: null, queue: null, jobs: [] },
    superseded: null,
    e2e,
  };
}
const section = () => buildE2e([listed(43583755717, 8, { conclusion: "failure" }), listed(43583755800, 9)]);
const json = (e2e: E2eSection | null = section(), version = 4) => writeSnapshot(snapshot(e2e, version));

Deno.test("E2E section lists completed main runs newest first with measured run times", () => {
  const s = buildE2e([
    listed(1, 7),
    listed(3, 9),
    listed(2, 8, { conclusion: "failure", event: "workflow_dispatch" }),
    listed(4, 9, { status: "in_progress", conclusion: "" }),
    listed(5, 9, { headBranch: "feature" }),
    listed(6, 9, { event: "push" }),
    listed(7, 6, { startedAt: null }),
    listed(3, 9),
  ]);
  assertEquals(s.runs.map((r) => r.id), [3, 2, 1, 7]);
  assertEquals(s.runs[1], {
    id: 2,
    event: "workflow_dispatch",
    createdAt: "2026-11-08T03:17:00Z",
    conclusion: "failure",
    runSeconds: 1200.5,
  });
  assertEquals(s.runs[3]!.runSeconds, null);
  assertEquals(s.sample, {
    runs: 4,
    cap: 30,
    window: { from: "2026-11-06T03:17:00Z", to: "2026-11-09T03:17:00Z" },
  });
  assertEquals(s.basis, "measured");
});

Deno.test("E2E section keeps at most the cap and is empty, with no window, when nothing completed", () => {
  const many = Array.from({ length: 35 }, (_, i) => listed(i + 1, 1, { createdAt: night(1) + i * 1000 }));
  const capped = buildE2e(many);
  assertEquals(capped.runs.length, 30);
  assertEquals(capped.runs[0]!.id, 35);
  assertEquals(validateSnapshot(json(capped)), []);
  const empty = buildE2e([listed(1, 9, { status: "queued", conclusion: "" })]);
  assertEquals(empty.sample, { runs: 0, cap: 30, window: null });
  assertEquals(validateSnapshot(json(empty)), []);
});

Deno.test("E2E collector makes one run list call for e2e.yml on main", async () => {
  const calls: string[][] = [];
  const s = await collectE2e("o/r", undefined, undefined, (args) => {
    calls.push([...args]);
    return Promise.resolve(JSON.stringify([{
      databaseId: 9,
      status: "completed",
      conclusion: "timed_out",
      createdAt: "2026-11-09T03:17:00Z",
      startedAt: "2026-11-09T03:17:02Z",
      updatedAt: "2026-11-09T04:02:02Z",
      event: "schedule",
      headBranch: "main",
    }]));
  });
  assertEquals(calls.length, 1);
  const call = calls[0]!;
  assertEquals(call.slice(0, 2), ["run", "list"]);
  assertEquals(call[call.indexOf("--workflow") + 1], "e2e.yml");
  assertEquals(call[call.indexOf("--branch") + 1], "main");
  assertEquals(call[call.indexOf("--repo") + 1], "o/r");
  assert(call[call.indexOf("--json") + 1]!.includes("startedAt"));
  assertEquals(s.runs, [{
    id: 9,
    event: "schedule",
    createdAt: "2026-11-09T03:17:00Z",
    conclusion: "timed_out",
    runSeconds: 2700,
  }]);
});

Deno.test("listed runs parse missing start and update times as unknown", () => {
  const [run] = parseListedRuns(
    '[{"databaseId":1,"status":"completed","conclusion":"success","createdAt":"2026-11-09T03:17:00Z","event":"schedule","headBranch":"main"}]',
  );
  assertEquals(run!.startedAt, null);
  assertEquals(run!.updatedAt, null);
});

Deno.test("E2E section and explicit null validate in version 4", () => {
  assertEquals(validateSnapshot(json()), []);
  assertEquals(validateSnapshot(json(null)), []);
});

Deno.test("versions 1 to 3 cannot carry the E2E section and version 4 requires it", () => {
  // The writer leaves the field out below version 4, so add it by hand.
  const v3 = { ...JSON.parse(json()), version: 3 };
  assert(
    validateSnapshot(JSON.stringify(v3)).includes("$.e2e: field is not in the schema before version 4"),
  );
  assert(!json(section(), 3).includes('"e2e"'));
  const missing = writeSnapshot(snapshot(undefined, 4)).replace(',\n  "e2e": null', "");
  assert(!missing.includes("e2e"));
  assert(validateSnapshot(missing).includes("$.e2e: field is missing (null when not sampled)"));
  // A version 3 snapshot as the tool wrote it before this change still passes.
  assertEquals(validateSnapshot(writeSnapshot(snapshot(undefined, 3))), []);
});

Deno.test("bad E2E values fail at their schema paths", () => {
  const mutations: [(s: E2eSection) => void, string][] = [
    [(s) => (s.workflow = "../e2e.sh"), "$.e2e.workflow"],
    [(s) => (s.basis = "guessed"), "$.e2e.basis"],
    [(s) => (s.runs[0]!.conclusion = "exploded"), "$.e2e.runs[0].conclusion"],
    [(s) => (s.runs[0]!.event = "pull_request"), "$.e2e.runs[0].event"],
    [(s) => (s.runs[0]!.id = 0), "$.e2e.runs[0].id"],
    [(s) => (s.runs[1]!.id = s.runs[0]!.id), "$.e2e.runs[1].id: each run must be listed once"],
    [(s) => s.runs.reverse(), "$.e2e.runs[1].createdAt: runs must be listed newest first"],
    [(s) => (s.runs[0]!.runSeconds = -1), "$.e2e.runs[0].runSeconds"],
    [(s) => (s.runs[0]!.createdAt = "last night"), "$.e2e.runs[0].createdAt"],
    [(s) => Object.assign(s.runs[0]!, { url: "x" }), "$.e2e.runs[0].url: field is not in the schema"],
    [(s) => (s.sample.runs = 3), "$.e2e.runs: lists 2 runs, but sample.runs is 3"],
    [(s) => (s.sample.cap = 1), "$.e2e.sample.runs: cannot exceed sample.cap (1)"],
    [(s) => (s.sample.window = null), "$.e2e.sample.window: must be set when runs is above 0"],
    [(s) => (s.sample.window!.to = "2026-11-10T00:00:00Z"), "$.e2e.sample.window: must run from"],
    [(s) => Object.assign(s, { runs: {} }), "$.e2e.runs: must be an array"],
    [(s) => {
      s.runs = [];
      s.sample.runs = 0;
    }, "$.e2e.sample.window: must be null when runs is 0"],
  ];
  for (const [mutate, expected] of mutations) {
    const s = section();
    mutate(s);
    const errors = validateSnapshot(json(s));
    assert(errors.some((e) => e.startsWith(expected)), `${expected}: ${errors.join("; ")}`);
  }
});

Deno.test("the privacy rules cover the E2E section", () => {
  const s = section();
  s.workflow = "someone@example.com";
  assert(validateSnapshot(json(s)).some((e) => e.includes("e-mail address")));
  const t = section();
  t.runs[0]!.event = "/home/someone";
  assert(validateSnapshot(json(t)).includes("$.e2e.runs[0].event: looks like a machine path"));
});
