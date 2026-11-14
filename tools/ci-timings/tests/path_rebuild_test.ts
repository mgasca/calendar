import { assert, assertEquals, assertThrows } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { buildBaseline, gateDefaults, rebuildPath, type SampledRun } from "../baseline.ts";
import { readBaseline, writeBaseline } from "../baseline-report.ts";
import { parseOptions } from "../ci-timings.ts";
import { type WorkflowRun } from "../timings.ts";
const t0 = Date.parse("2026-11-06T20:04:12Z");
function run(id: number, event = "push"): WorkflowRun {
  return {
    id,
    status: "completed",
    conclusion: "success",
    createdAt: t0 + id * 60000,
    event,
    headBranch: "main",
    headSha: `c${id}`,
  };
}
function sampled(ids: readonly number[], path: string, jobs: Record<string, number>, event = "push"): SampledRun[] {
  return ids.map((id) => ({
    run: run(id, event),
    samples: Object.entries(jobs).map(([job, seconds]) => ({ runId: id, job, path, seconds: seconds + (id % 3) })),
  }));
}
// The earlier file: both paths from one window, four jobs, so J = 4 at the default alpha.
const earlier = buildBaseline("ci.yml", "docs/benchmarks/0017-old.md", 3, gateDefaults, [
  ...sampled([1, 2, 3], "check", { Changes: 5, Frontend: 50, Tooling: 80 }, "workflow_dispatch"),
  ...sampled([4, 5, 6], "publication", { Changes: 4, "Docs site": 97, Frontend: 52, Tooling: 79 }),
]);
// The new window: publication runs with Backend added, and a check run that must be ignored.
const window = [
  ...sampled([10, 11, 12], "publication", { Backend: 120, Changes: 5, "Docs site": 98, Frontend: 70, Tooling: 93 }),
  ...sampled([13], "check", { Backend: 999, Frontend: 999 }, "workflow_dispatch"),
];

Deno.test("Rebuild_OfOnePath_KeepsTheOtherPathByteForByte", () => {
  const rebuilt = rebuildPath(earlier, "publication", "docs/benchmarks/0099-new.md", 3, window);
  assertEquals(rebuilt.paths.check, earlier.paths.check);
  const before = JSON.parse(writeBaseline(earlier)), after = JSON.parse(writeBaseline(rebuilt));
  assertEquals(JSON.stringify(after.paths.check), JSON.stringify(before.paths.check));
  assertEquals(rebuilt.paths.publication!.runs.map((r) => r.id), [10, 11, 12]);
  assertEquals(Object.keys(rebuilt.paths.publication!.jobs), [
    "Backend",
    "Changes",
    "Docs site",
    "Frontend",
    "Tooling",
  ]);
  assertEquals(rebuilt.paths.publication!.status, "pinned");
  assertEquals(rebuilt.record, "docs/benchmarks/0099-new.md");
});

Deno.test("Rebuild_CountsJOverTheResultingFile_AndKeepsTheFilesOtherConstants", () => {
  const tuned = {
    ...earlier,
    constants: { ...earlier.constants, alpha: 0.002, floorSeconds: 20, relativeMargin: 0.2 },
  };
  const rebuilt = rebuildPath(tuned, "publication", "r.md", 3, window);
  // Backend, Changes, Docs site, Frontend, Tooling: the check path's jobs are a subset.
  assertEquals(rebuilt.constants, { alpha: 0.002, jobs: 5, floorSeconds: 20, relativeMargin: 0.2 });
  const extra = rebuildPath(
    {
      ...earlier,
      paths: { ...earlier.paths, check: { ...earlier.paths.check!, jobs: { ...earlier.paths.check!.jobs } } },
    },
    "publication",
    "r.md",
    3,
    sampled([10, 11, 12], "publication", { Backend: 120 }),
  );
  // Backend from the window, Changes, Frontend and Tooling from the kept check path.
  assertEquals(extra.constants.jobs, 4);
});

Deno.test("Rebuild_RecordsWhereTheKeptPathCameFrom_AndRoundTrips", () => {
  const rebuilt = rebuildPath(earlier, "publication", "r.md", 3, window);
  assertEquals(rebuilt.carried, { check: { record: "docs/benchmarks/0017-old.md", constants: earlier.constants } });
  const json = writeBaseline(rebuilt);
  assertEquals(readBaseline(json), rebuilt);
  assertEquals(writeBaseline(readBaseline(json)), json);
  const parsed = JSON.parse(json);
  assertEquals(Object.keys(parsed), [
    "schema",
    "workflow",
    "record",
    "method",
    "minRuns",
    "constants",
    "carried",
    "paths",
  ]);
  assertEquals(parsed.carried.check.constants, { ...parsed.constants, jobs: 4, z: 3.4808 });
  assertEquals(parsed.constants.jobs, 5);
});

Deno.test("Rebuild_KeepsTheFirstProvenanceOnASecondCarry_AndDropsItWhenThePathIsRebuilt", () => {
  const once = rebuildPath(earlier, "publication", "r1.md", 3, window);
  const twice = rebuildPath(once, "publication", "r2.md", 3, window);
  assertEquals(twice.carried!.check!.record, "docs/benchmarks/0017-old.md");
  assertEquals(twice.paths.check, earlier.paths.check);
  const back = rebuildPath(twice, "check", "r3.md", 1, sampled([20], "check", { Backend: 130 }, "workflow_dispatch"));
  assertEquals(back.carried, { publication: { record: "r2.md", constants: twice.constants } });
  assertEquals(back.paths.publication, twice.paths.publication);
});

Deno.test("FullRebuild_WritesNoCarriedField", () => {
  const file = buildBaseline("ci.yml", "r.md", 3, gateDefaults, window);
  assertEquals(file.carried, undefined);
  assert(!writeBaseline(file).includes("carried"));
  assertEquals(readBaseline(writeBaseline(file)).carried, undefined);
});

Deno.test("Rebuild_RejectsAnUnknownPath_AndAWindowWithoutRunsOnThePath", () => {
  assertThrows(() => rebuildPath(earlier, "docs", "r.md", 3, window), Error, "unknown path docs");
  assertThrows(
    () => rebuildPath(earlier, "publication", "r.md", 3, sampled([13], "check", { Backend: 1 })),
    Error,
    "no successful run on the publication path",
  );
});

Deno.test("CheckedInBaseline_SurvivesARebuildOfThePublicationPath", async () => {
  const root = fromFileUrl(new URL("../../../", import.meta.url));
  const current = readBaseline(await Deno.readTextFile(join(root, ".github/ci-baseline.json")));
  const rebuilt = rebuildPath(current, "publication", "r.md", 3, window);
  for (const name of Object.keys(current.paths).filter((name) => name !== "publication")) {
    assertEquals(
      JSON.stringify(JSON.parse(writeBaseline(rebuilt)).paths[name]),
      JSON.stringify(JSON.parse(writeBaseline(current)).paths[name]),
    );
  }
});

Deno.test("CLI_ParsesPath_AndMarksTunedConstants", () => {
  assertEquals(parseOptions(["--baseline", "--path", "publication"]).options!.path, "publication");
  assertEquals(parseOptions(["--path"]).error, "--path");
  assertEquals(parseOptions([]).options!.tunedConstants, false);
  for (const flag of ["--alpha", "--floor", "--margin"]) {
    assertEquals(parseOptions([flag, "1"]).options!.tunedConstants, true);
  }
});

async function cli(args: readonly string[], responses: Record<string, string>, directory: string) {
  const gh = join(directory, "gh"), responsesPath = join(directory, "responses.json");
  await Deno.copyFile(new URL("fixtures/mock-gh.ts", import.meta.url), gh);
  await Deno.chmod(gh, 0o755);
  await Deno.writeTextFile(responsesPath, JSON.stringify(responses));
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--no-prompt",
      "--config",
      fromFileUrl(new URL("../../deno.json", import.meta.url)),
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env",
      fromFileUrl(new URL("../ci-timings.ts", import.meta.url)),
      ...args,
    ],
    env: {
      PATH: directory + ":" + dirname(Deno.execPath()) + ":" + (Deno.env.get("PATH") ?? ""),
      CI_TIMINGS_RESPONSES: responsesPath,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: result.code,
    out: new TextDecoder().decode(result.stdout),
    err: new TextDecoder().decode(result.stderr),
  };
}
const iso = (at: number) => new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");
function jobsResponse(id: number, publication: boolean): string {
  const job = (name: string, seconds: number) => ({
    name,
    conclusion: "success",
    started_at: iso(t0 + id * 60000),
    completed_at: iso(t0 + id * 60000 + seconds * 1000),
    steps: name === "Docs site" && publication
      ? [{
        number: 14,
        name: "Build and verify publication artifact",
        started_at: iso(t0),
        completed_at: iso(t0),
        conclusion: "success",
      }]
      : [],
  });
  return JSON.stringify({ jobs: [job("Backend", 120 + id), job("Docs site", 98)] });
}

Deno.test("CLI_RebuildsOnlyThePublicationPath_InTheFileItWrites", async () => {
  const directory = await Deno.makeTempDir({ prefix: "ci-timings-path-" });
  try {
    const out = join(directory, "baseline.json");
    await Deno.writeTextFile(out, writeBaseline(earlier));
    const ids = [10, 11, 12];
    const responses: Record<string, string> = {
      runs: JSON.stringify(
        [...ids, 13].map((id) => ({
          databaseId: id,
          status: "completed",
          conclusion: "success",
          createdAt: iso(t0 + id * 60000),
          event: id === 13 ? "workflow_dispatch" : "push",
          headBranch: "main",
          headSha: `c${id}`,
        })),
      ),
    };
    for (const id of ids) responses[String(id)] = jobsResponse(id, true);
    responses["13"] = jobsResponse(13, false);
    const result = await cli(
      [
        "--baseline",
        "--created",
        "RANGE",
        "--path",
        "publication",
        "--min-runs",
        "3",
        "--record",
        "new.md",
        "--out",
        out,
      ],
      responses,
      directory,
    );
    assertEquals(result.err, "");
    assertEquals(result.code, 0);
    assert(
      result.out.includes("only the publication path was rebuilt, and check is kept from docs/benchmarks/0017-old.md"),
    );
    const written = readBaseline(await Deno.readTextFile(out));
    assertEquals(written.paths.check, earlier.paths.check);
    assertEquals(written.paths.publication!.runs.map((r) => r.id), ids);
    assertEquals(Object.keys(written.paths.publication!.jobs), ["Backend", "Docs site"]);
    assertEquals(written.record, "new.md");
    assertEquals(written.carried!.check!.record, "docs/benchmarks/0017-old.md");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CLI_RefusesAPathRebuildWithoutAFile_WithAnUnknownPath_OrWithTunedConstants", async () => {
  const directory = await Deno.makeTempDir({ prefix: "ci-timings-path-" });
  try {
    const missing = join(directory, "missing.json"), present = join(directory, "baseline.json");
    await Deno.writeTextFile(present, writeBaseline(earlier));
    const base = ["--baseline", "--created", "RANGE"];
    const cases: [string[], string][] = [
      [[...base, "--path", "publication", "--out", missing], "--path needs the existing baseline"],
      [[...base, "--path", "docs", "--out", present], "--path must be check or publication, not docs"],
      [[...base, "--path", "publication", "--alpha", "0.01", "--out", present], "--path keeps the constants"],
      [[...base, "--path", "publication", "--workflow", "other.yml", "--out", present], "is the baseline of ci.yml"],
    ];
    for (const [args, message] of cases) {
      const result = await cli(args, { runs: "[]" }, directory);
      assertEquals(result.code, 2);
      assert(result.err.includes(message), result.err);
    }
    assertEquals(await Deno.readTextFile(present), writeBaseline(earlier));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
