import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { buildAgents, type IssueInput, parseAgentIssues, parseCountComment } from "../agents.ts";
import { buildCi, writeSnapshot } from "../snapshot.ts";
import { validateSnapshot } from "../snapshot-rules.ts";
const noon = Date.parse("2026-11-09T12:00:00Z");
function issue(
  number: number,
  comments: string[],
  pullRequests: { number: number; reviews: number }[] = [],
  total = comments.length,
  hoursAgo = 0,
): IssueInput {
  return { number, updatedAt: noon - hoursAgo * 3600000, commentTotal: total, commentBodies: comments, pullRequests };
}
function section() {
  return buildAgents([
    issue(5, ["Tasks started: 2. Subagents started: 1.", "ok"], [{ number: 50, reviews: 3 }]),
    issue(4, ["no counts here"], [], 1, 1),
  ]);
}
function json(agents = section()) {
  return writeSnapshot({
    version: 3,
    date: "2026-11-09",
    generatedAt: "2026-11-09T12:00:00Z",
    repository: "mgasca/calendar",
    ci: buildCi("ci.yml", []),
    agents,
    superseded: null,
  });
}
Deno.test("count comment reads all supported line and keyword forms", () => {
  for (
    const [body, tasks, subagents] of [
      ["Tasks started: 2. Subagents started: 3.", 2, 3],
      ["Tasks started: 0. Subagents started: 0.", 0, 0],
      ["Design is posted.\n\nTasks started: 1. Subagents started: 4.\n\n🤖 Generated with Claude Code", 1, 4],
      ["tasks started: 5", 5, 0],
      ["SUBAGENTS STARTED = 7", 0, 7],
      ["Task started: 1, Subagent started: 1", 1, 1],
      ["Tasks started: 1\nSubagents started: 2", 1, 2],
    ] as const
  ) assertEquals(parseCountComment(body), { kind: "valid", tasks, subagents });
});
Deno.test("non-count and quoted comments do not count", () => {
  for (
    const body of [
      "",
      "Looks good to me.",
      "Several tasks started later, and subagents started too.",
      "> Tasks started: 2. Subagents started: 3.\n\nQuoted in a reply, not a count.",
    ]
  ) assertEquals(parseCountComment(body), { kind: "none", tasks: 0, subagents: 0 });
});
Deno.test("unusable count numbers mark whole comment malformed contributing nothing", () => {
  for (
    const body of [
      "Tasks started: many. Subagents started: 1.",
      "Tasks started: -3.",
      "Tasks started: .",
      "Tasks started:",
      "Tasks started: 1e3",
      "Tasks started: 1001. Subagents started: 0.",
      "Subagents started: 99999999999999",
      "Tasks started: 2. Subagents started: lots.",
    ]
  ) assertEquals(parseCountComment(body), { kind: "malformed", tasks: 0, subagents: 0 });
});
Deno.test("issues without counts retain null cost proxies", () => {
  const s = buildAgents([issue(7, ["Please look.", "Done."], [{ number: 70, reviews: 2 }])]);
  assertEquals(s.issues, [{
    issue: 7,
    countComments: 0,
    malformed: 0,
    tasks: null,
    subagents: null,
    comments: 2,
    reviews: 2,
    pullRequests: 1,
  }]);
  assertEquals(s.activity.withCounts, 0);
  assertEquals(s.counts, { countComments: 0, malformed: 0, tasks: 0, subagents: 0 });
});
Deno.test("count comments sum per issue and malformed comments do not contribute counts", () => {
  const s = buildAgents([
    issue(5, [
      "Plan.\n\nTasks started: 1. Subagents started: 2.",
      "Tasks started: 3. Subagents started: 0.",
      "Tasks started: many.",
      "Review?",
    ]),
  ]);
  assertEquals(s.issues, [{
    issue: 5,
    countComments: 2,
    malformed: 1,
    tasks: 4,
    subagents: 2,
    comments: 4,
    reviews: 0,
    pullRequests: 0,
  }]);
  assertEquals(s.counts, { countComments: 2, malformed: 1, tasks: 4, subagents: 2 });
  assertEquals(s.activity.withCounts, 1);
});
Deno.test("malformed-only issue has no cost proxies", () => {
  const row = buildAgents([issue(5, ["Tasks started: x."])]).issues[0]!;
  assertEquals([row.malformed, row.countComments, row.tasks, row.subagents], [1, 0, null, null]);
});
Deno.test("duplicate pull request mentions count once together with reviews", () => {
  const row = buildAgents([
    issue(7, [], [{ number: 70, reviews: 3 }, { number: 70, reviews: 3 }, { number: 71, reviews: 1 }]),
  ]).issues[0]!;
  assertEquals([row.pullRequests, row.reviews], [2, 4]);
});
Deno.test("comment total preserves counts beyond first hundred read", () =>
  assertEquals(buildAgents([issue(7, ["a"], [], 140)]).issues[0]!.comments, 140));
Deno.test("issue with no activity is scanned but not listed", () => {
  const s = buildAgents([issue(1, []), issue(2, ["x"])]);
  assertEquals(s.sample.scanned, 2);
  assertEquals(s.issues.map((i) => i.issue), [2]);
});
Deno.test("agent rows sorted descending number and sample spans updates", () => {
  const s = buildAgents([issue(3, ["a"], [], 1, 9), issue(9, ["a"], [], 1, 1), issue(5, ["a"], [], 1, 4)]);
  assertEquals(s.issues.map((i) => i.issue), [9, 5, 3]);
  assertEquals(s.sample.window, { from: "2026-11-09T03:00:00Z", to: "2026-11-09T11:00:00Z" });
  assertEquals(s.activity, { issues: 3, withCounts: 0, comments: 3, reviews: 0, pullRequests: 0 });
});
Deno.test("agent activity measured while self-reported counts inferred", () => {
  const s = buildAgents([]);
  assertEquals(s.basis, { activity: "measured", counts: "inferred" });
  assertEquals(s.sample, { scanned: 0, window: null });
});
Deno.test("agent GraphQL parser reads issues comments same-repo mentions", () => {
  const json =
    '{"data":{"repository":{"issues":{"nodes":[{"number":599,"updatedAt":"2026-11-09T10:00:00Z","comments":{"totalCount":2,"nodes":[{"body":"Tasks started: 1. Subagents started: 0."},{"body":"hi"}]},"timelineItems":{"nodes":[{"source":{"number":607,"reviews":{"totalCount":2},"repository":{"nameWithOwner":"mgasca/calendar"}}},{"source":{"number":12,"reviews":{"totalCount":9},"repository":{"nameWithOwner":"someone/else"}}},{"source":{}},{}]}}]}}}}';
  const row = parseAgentIssues(json, "mgasca/calendar")[0]!;
  assertEquals(row.number, 599);
  assertEquals(row.commentTotal, 2);
  assertEquals(row.commentBodies.length, 2);
  assertEquals(row.pullRequests, [{ number: 607, reviews: 2 }]);
});
Deno.test("agent parser tolerates missing and incomplete fields", () => {
  const json =
    '{"data":{"repository":{"issues":{"nodes":[{"number":1,"updatedAt":"2026-11-09T10:00:00Z"},{"updatedAt":"2026-11-09T10:00:00Z"},{"number":3},{"number":4,"updatedAt":"2026-11-09T10:00:00Z","comments":{"nodes":[{"body":null},{}]},"timelineItems":null}]}}}}';
  assertEquals(parseAgentIssues(json, "mgasca/calendar").map((i) => i.number), [1, 4]);
  for (const missing of ["{}", '{"data":null}', '{"data":{"repository":{"issues":{"nodes":5}}}}']) {
    assertEquals(parseAgentIssues(missing, "mgasca/calendar"), []);
  }
});
Deno.test("agent section generated snapshots remain valid and stable", () => {
  assertEquals(validateSnapshot(json()), []);
  assertEquals(json(), json());
  assertEquals(validateSnapshot(json(buildAgents([]))), []);
  assertStringIncludes(json(), '"tasks": null,\n        "subagents": null');
});
Deno.test("comment bodies never reach public agent snapshot", () => {
  const value = json(
    buildAgents([
      issue(8, [
        "Tasks started: 1. Subagents started: 1. See /home/someone/dev and ask someone@example.com",
        "session_1a2b3c4d",
      ]),
    ]),
  );
  assert(!value.includes("someone"));
  assert(!value.includes("session_"));
  assertEquals(validateSnapshot(value), []);
});
Deno.test("private or unknown agent fields fail", () => {
  const s = section();
  Object.assign(s.issues[0]!, { author: "x" });
  assert(validateSnapshot(json(s)).includes("$.agents.issues[0].author: field is not in the schema"));
  Object.assign(s.issues[0]!, { "/home/someone": 1 });
  assert(validateSnapshot(json(s)).some((e) => e.includes("machine path")));
});
Deno.test("agent totals must equal row sums", () => {
  const s = section();
  s.activity.comments = 9;
  assert(validateSnapshot(json(s)).some((e) => e.startsWith("$.agents.activity.comments")));
});
Deno.test("tasks require a valid count comment", () => {
  const s = section();
  s.issues[1]!.tasks = 4;
  assert(validateSnapshot(json(s)).some((e) => e.includes("must be null without a count comment")));
});
Deno.test("duplicate or inactive agent issue rows fail", () => {
  const duplicate = section();
  duplicate.issues[1]!.issue = 5;
  assert(validateSnapshot(json(duplicate)).some((e) => e.includes("must be listed once")));
  const empty = section();
  empty.issues[1]!.comments = 0;
  assert(validateSnapshot(json(empty)).some((e) => e.includes("no comment and no pull request")));
});
Deno.test("agent rows cannot outnumber scanned issues and basis must be known", () => {
  const s = section();
  s.sample.scanned = 1;
  assert(validateSnapshot(json(s)).some((e) => e.includes("sample.scanned")));
  s.basis.counts = "exact";
  assert(validateSnapshot(json(s)).some((e) => e.startsWith("$.agents.basis.counts")));
});
