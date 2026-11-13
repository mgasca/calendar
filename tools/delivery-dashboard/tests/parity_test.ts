import { assertEquals } from "@std/assert";
import { buildCi, writeSnapshot } from "../snapshot.ts";
import { buildAgents } from "../agents.ts";
import { buildFlow } from "../flow.ts";
import { buildSuperseded } from "../superseded.ts";
import { validateSnapshot } from "../snapshot-rules.ts";
import type { SupersededPair, WorkflowRun } from "../../ci-timings/timings.ts";
Deno.test("snapshot bytes match retained original C# CI flow agents superseded output", async () => {
  const noon = Date.parse("2026-11-09T12:00:00Z"), hour = 3600000, day = 24 * hour;
  const run = (id: number, hours: number): WorkflowRun => ({
    id,
    status: "completed",
    conclusion: "success",
    createdAt: noon - hours * hour,
    event: "push",
    headBranch: "main",
    headSha: "abc",
  });
  const runs = [{
    run: run(1, 5),
    samples: [{ runId: 1, job: "Backend", path: "check", seconds: 79.95 }, {
      runId: 1,
      job: "Docs site",
      path: "publication",
      seconds: 123.45,
    }],
  }, {
    run: run(2, 1),
    samples: [{ runId: 2, job: "Backend", path: "check", seconds: 83.25 }, {
      runId: 2,
      job: "Docs site",
      path: "publication",
      seconds: 120.01,
    }],
  }];
  const open = Array.from({ length: 5 }, (_, index) => {
    const i = index + 1;
    return {
      number: i,
      createdAt: noon - i * hour,
      isDraft: i === 2,
      reviews: i === 1 ? 1 : 0,
      baseRef: i === 1 ? "main" : `branch-${i - 1}`,
      headRef: `branch-${i}`,
    };
  });
  const merged = Array.from({ length: 6 }, (_, index) => {
    const i = index + 10;
    return {
      number: i,
      createdAt: noon - i * day,
      mergedAt: noon - i * hour,
      baseRef: i === 15 ? "base" : "main",
      closes: [{ number: 100 + i, createdAt: noon - (i + 2) * day }, { number: 500, createdAt: noon - 20 * day }],
    };
  });
  const flow = buildFlow(noon, noon - 30 * day, false, "main", open, merged, [{
    number: 22,
    items: [{ issue: 1, closed: true }, { issue: 2, closed: false }],
  }]);
  const agents = buildAgents([
    {
      number: 10,
      updatedAt: noon - 2 * hour,
      commentTotal: 4,
      commentBodies: [
        "Tasks started: 2. Subagents started: 3.",
        "task started=1",
        "> Tasks started: 20.",
        "Subagents started: nope",
      ],
      pullRequests: [{ number: 40, reviews: 2 }, { number: 40, reviews: 9 }],
    },
    { number: 11, updatedAt: noon, commentTotal: 1, commentBodies: ["No counts"], pullRequests: [] },
    { number: 12, updatedAt: noon, commentTotal: 0, commentBodies: [], pullRequests: [] },
  ]);
  const pair = (
    cancelledRunId: number,
    supersedingRunId: number,
    supersededAt: number,
    pushGap: number,
    wait: number | null,
    runEnd: number,
  ): SupersededPair => ({
    cancelledRunId,
    supersedingRunId,
    supersededAt,
    pushGap,
    wait,
    allStarted: null,
    cancelNotHeardAt: null,
    cancelHeardBy: null,
    cancelledJobsEnd: null,
    runEnd,
    jobsNotCancelled: "",
  });
  const superseded = buildSuperseded([pair(1, 2, noon, 100, 12.25, 100), pair(3, 4, noon - 7 * day, 80, null, 80)], 1, [
    { created: noon, wait: 3.25 },
    { created: noon - 7 * day, wait: 4.75 },
  ], 30);
  const actual = writeSnapshot({
    version: 3,
    date: "2026-11-09",
    generatedAt: "2026-11-09T12:00:00Z",
    repository: "mgasca/calendar",
    ci: buildCi("ci.yml", runs, null, undefined, [1.25, 2.75]),
    flow,
    agents,
    superseded,
  });
  const expected = await Deno.readTextFile(new URL("fixtures/snapshot-parity.json", import.meta.url));
  assertEquals(actual, expected);
  assertEquals(validateSnapshot(actual), []);
});
Deno.test("snapshot string escaping matches original Utf8JsonWriter default encoder", () => {
  const job = 'Build "docs" & + <é> \' ` \\ \n \t 😀\u007f\u0080\u2028';
  const ci = buildCi("ci.yml", [{
    run: {
      id: 1,
      status: "completed",
      conclusion: "success",
      createdAt: 0,
      event: "push",
      headBranch: "main",
      headSha: "",
    },
    samples: [{ runId: 1, job, path: "check", seconds: 1 }],
  }]);
  const json = writeSnapshot({
    version: 3,
    date: "1970-01-01",
    generatedAt: "1970-01-01T00:00:00Z",
    repository: "o/r",
    ci,
  });
  const token = json.match(/"job": ("(?:\\.|[^"\\])*")/)!;
  assertEquals(
    token[1],
    '"Build \\u0022docs\\u0022 \\u0026 \\u002B \\u003C\\u00E9\\u003E \\u0027 \\u0060 \\\\ \\n \\t \\uD83D\\uDE00\\u007F\\u0080\\u2028"',
  );
});
