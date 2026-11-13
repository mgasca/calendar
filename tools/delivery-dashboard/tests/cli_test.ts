import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { main } from "../delivery-dashboard.ts";
import { validateSnapshot } from "../snapshot-rules.ts";
const deno = Deno.execPath(),
  entry = new URL("../delivery-dashboard.ts", import.meta.url),
  config = new URL("../../deno.json", import.meta.url);
async function invoke(args: string[], stdin = "") {
  const child = new Deno.Command(deno, {
    args: [
      "run",
      "--config",
      config.pathname,
      "--frozen",
      "--no-prompt",
      "--allow-read",
      "--allow-env",
      "--allow-run",
      "--allow-write",
      entry.pathname,
      ...args,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(stdin));
  await writer.close();
  const result = await child.output();
  return {
    code: result.code,
    out: new TextDecoder().decode(result.stdout),
    err: new TextDecoder().decode(result.stderr),
  };
}
Deno.test("dashboard CLI preserves usage errors and exit code two", async () => {
  for (
    const args of [
      [],
      ["other"],
      ["check"],
      ["alerts"],
      ["snapshot", "--runs", "bad"],
      ["snapshot", "--date", "2026-02-30"],
      ["snapshot", "--unknown"],
      ["retention", "--add", "bad"],
    ]
  ) {
    const result = await invoke(args);
    assertEquals(result.code, 2);
    assertStringIncludes(result.err, "usage: delivery-dashboard snapshot");
  }
});
Deno.test("dashboard retention CLI handles stdin and warning or failure exits", async () => {
  const value = "100644 blob sha 850\tsnapshots/day.json\n";
  const warning = await invoke(["retention", "--limit-mb", "1", "--add", "838861"], value);
  assertEquals(warning.code, 0);
  assertStringIncludes(warning.out, "::warning::");
  const over = await invoke(["retention", "--limit-mb", "0"], value);
  assertEquals(over.code, 1);
  assertStringIncludes(over.out, "Over the limit");
});
Deno.test("snapshot collector preserves job reuse, stable timestamps and validates before writing", async () => {
  const dir = await Deno.makeTempDir(), out = dir + "/snapshot.json", calls: string[][] = [];
  const oldNow = Date.now, oldLog = console.log, lines: string[] = [];
  Date.now = () => Date.parse("2026-11-09T12:00:00.999Z");
  console.log = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  function fixture(args: readonly string[]): string {
    calls.push([...args]);
    if (args[0] === "run") {
      return args.includes("--event") && args[args.indexOf("--event") + 1] === "pull_request" ? "[]" : JSON.stringify([{
        databaseId: 1,
        status: "completed",
        conclusion: "success",
        createdAt: "2026-11-09T11:00:00Z",
        event: "push",
        headBranch: "main",
        headSha: "abc",
      }]);
    }
    if (args[1]?.includes("/actions/workflows/")) {
      return '{"workflow_runs":[{"id":1,"status":"completed","conclusion":"success","created_at":"2026-11-09T11:00:00Z","event":"push","head_branch":"main","head_sha":"abc","run_attempt":1}]}';
    }
    if (args[1]?.includes("/jobs")) {
      return JSON.stringify({
        jobs: [{
          name: "Backend",
          conclusion: "success",
          run_attempt: 1,
          started_at: "2026-11-09T11:00:04Z",
          completed_at: "2026-11-09T11:01:24Z",
          steps: [],
        }],
      });
    }
    const query = args.find((a) => a.startsWith("query=")) ?? "";
    if (query.includes("defaultBranchRef")) {
      return '{"data":{"repository":{"defaultBranchRef":{"name":"main"},"open":{"nodes":[]},"merged":{"nodes":[]},"epics":{"nodes":[]}}}}';
    }
    if (query.includes("issues(first: $count")) return '{"data":{"repository":{"issues":{"nodes":[]}}}}';
    throw new Error("unexpected fixture request: " + args.join(" "));
  }
  try {
    assertEquals(
      await main([
        "snapshot",
        "--repo",
        "o/r",
        "--runs",
        "1",
        "--quality-runs",
        "1",
        "--baseline",
        dir + "/absent",
        "--out",
        out,
      ], (args) => Promise.resolve(fixture(args))),
      0,
    );
    const json = await Deno.readTextFile(out);
    assertEquals(validateSnapshot(json), []);
    const parsed = JSON.parse(json);
    assertEquals(parsed.generatedAt, "2026-11-09T12:00:00Z");
    assertEquals(parsed.date, "2026-11-09");
    assertEquals(parsed.ci.jobs[0].medianSeconds, 80);
    assertEquals(parsed.ci.queue.medianSeconds, 4);
    assertEquals(parsed.quality.scopes[0].jobs[0].trials, 1);
    assertEquals(calls.filter((c) => c[1]?.includes("/jobs")).length, 1);
    assert(lines.some((l) => l.includes("1 runs of ci.yml, 1 job and path rows")));
    const checked = await invoke(["check", out]);
    assertEquals(checked.code, 0);
    assertStringIncludes(checked.out, "OK   " + out);
    const alerts = await invoke(["alerts", "--snapshot", out]);
    assertEquals(alerts.code, 0);
    assertEquals(alerts.out, "No threshold is breached.\n");
  } finally {
    Date.now = oldNow;
    console.log = oldLog;
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("check CLI reports schema failure and alerts refuses an invalid snapshot", async () => {
  const file = await Deno.makeTempFile();
  try {
    await Deno.writeTextFile(file, "{}");
    const check = await invoke(["check", file]);
    assertEquals(check.code, 1);
    assertStringIncludes(check.out, "FAIL " + file);
    const alert = await invoke(["alerts", "--snapshot", file]);
    assertEquals(alert.code, 1);
    assertStringIncludes(alert.err, "no alert is evaluated");
  } finally {
    await Deno.remove(file);
  }
});
