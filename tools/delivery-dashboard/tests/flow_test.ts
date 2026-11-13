import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildFlow,
  closedIssues,
  type FlowSection,
  type MergedPr,
  type OpenPr,
  parseFlow,
  stacks,
  stateQuery,
  taskList,
} from "../flow.ts";
import { buildCi, writeSnapshot } from "../snapshot.ts";
import { validateSnapshot } from "../snapshot-rules.ts";
const now = Date.parse("2026-11-09T12:00:00Z"), day = 86400000, start = now - 30 * day;
function merged(
  number: number,
  openedDaysAgo: number,
  mergedDaysAgo: number,
  baseRef = "main",
  closes: { number: number; createdAt: number }[] = [],
): MergedPr {
  return { number, createdAt: now - openedDaysAgo * day, mergedAt: now - mergedDaysAgo * day, baseRef, closes };
}
function open(
  number: number,
  daysAgo: number,
  headRef: string,
  baseRef = "main",
  isDraft = false,
  reviews = 0,
): OpenPr {
  return { number, createdAt: now - daysAgo * day, isDraft, reviews, baseRef, headRef };
}
const build = (open: OpenPr[], merged: MergedPr[], full = false) =>
  buildFlow(now, start, full, "main", open, merged, []);
function section(): FlowSection {
  return buildFlow(
    now,
    start,
    false,
    "main",
    [open(20, 3, "feat/a"), open(21, 2, "feat/b", "feat/a", false, 1)],
    Array.from(
      { length: 6 },
      (_, i) => merged(i + 1, 9 - i, 8 - i, "main", [{ number: 101 + i, createdAt: now - 12 * day }]),
    ),
    [{ number: 595, items: [{ issue: 596, closed: true }, { issue: 597, closed: false }] }],
  );
}
const json = (flow: FlowSection | undefined = section()) =>
  writeSnapshot({
    version: 3,
    date: "2026-11-09",
    generatedAt: "2026-11-09T12:00:00Z",
    repository: "mgasca/calendar",
    ci: buildCi("ci.yml", []),
    flow,
    superseded: null,
  });
Deno.test("flow lead time includes opening to main merge while stack merges count apart", () => {
  const s = build([], [
    merged(1, 22, 20),
    merged(2, 21, 18),
    merged(3, 21.5, 21, "feat/b"),
    merged(4, 10, 9),
    merged(5, 8, 6),
    merged(6, 5, 4),
  ]);
  assertEquals(s.leadTime.sample, 5);
  assertEquals(s.stacks.mergedIntoBase, 1);
  assertEquals(s.leadTime.stat!.maxSeconds, 3 * 86400);
  assertEquals(s.leadTime.stat!.medianSeconds, 2 * 86400);
});
Deno.test("flow thin samples keep count with null distribution", () => {
  const s = build([], [merged(1, 3, 2), merged(2, 3, 1)]);
  assertEquals(s.leadTime.sample, 2);
  assertEquals(s.leadTime.stat, null);
});
Deno.test("flow excludes merges outside window and shrinks full page to oldest seen merge", () => {
  const history = [merged(1, 40, 35), ...Array.from({ length: 6 }, (_, i) => merged(i + 2, 10, 7 + i))];
  const s = build([], history);
  assertEquals(s.leadTime.sample, 6);
  assertEquals(s.window.from, new Date(start).toISOString().replace(".000Z", "Z"));
  assertEquals(
    build([], history.filter((p) => p.number !== 1), true).window.from,
    new Date(now - 12 * day).toISOString().replace(".000Z", "Z"),
  );
});
Deno.test("issue closed by multiple PRs counts once through last main merge", () => {
  const issue = { number: 50, createdAt: now - 20 * day };
  const history = [
    merged(1, 19, 15, "main", [issue]),
    merged(2, 14, 10, "main", [issue]),
    merged(3, 13, 12, "feat/x", [issue]),
    merged(4, 9, 8, "main", [{ number: 51, createdAt: now - 9 * day }]),
    merged(5, 7, 6, "main", [{ number: 52, createdAt: now - 8 * day }]),
    merged(6, 5, 4, "main", [{ number: 53, createdAt: now - 7 * day }]),
    merged(7, 5, 3, "main", [{ number: 54, createdAt: now - 6 * day }]),
  ];
  const s = build([], history);
  assertEquals(s.issueToMerge.sample, 5);
  assertEquals(s.issueToMerge.stat!.maxSeconds, 10 * 86400);
});
Deno.test("review wait counts open ready unreviewed PRs only", () => {
  const s = build(
    [open(1, 4, "a"), open(2, 2, "b", "main", true), open(3, 6, "c", "main", false, 1), open(4, 1, "d")],
    [],
  );
  assertEquals([
    s.openPullRequests.count,
    s.openPullRequests.drafts,
    s.waitingForReview.count,
    s.waitingForReview.oldestSeconds,
    s.openPullRequests.age,
  ], [4, 1, 2, 4 * 86400, null]);
});
Deno.test("no open PR has null oldest waiting age", () =>
  assertEquals(build([], []).waitingForReview.oldestSeconds, null));
Deno.test("open PR chains form one stack with longest depth", () => {
  const s = build([
    open(10, 5, "feat/a"),
    open(11, 4, "feat/b", "feat/a"),
    open(12, 3, "feat/c", "feat/b"),
    open(13, 3, "feat/d", "feat/a"),
    open(20, 2, "feat/solo"),
    open(30, 2, "x/one"),
    open(31, 1, "x/two", "x/one"),
  ], []);
  assertEquals(s.stacks.open, [{ depth: 3, pullRequests: [10, 11, 12, 13] }, { depth: 2, pullRequests: [30, 31] }]);
});
Deno.test("cyclic PR branch references do not loop", () =>
  assertEquals(stacks([open(1, 1, "a", "b"), open(2, 1, "b", "a")]), []));
Deno.test("epic task list reads first issue per line once and checkbox state", () => {
  assertEquals(
    taskList(
      [
        "## Slices",
        "- [ ] **0. Decision**",
        "- [x] #596 **1. Snapshot**",
        "- [ ] #597 **2. Page** and #598",
        "  - [ ] #599 nested",
        "* [X] #596 again",
        "- [ ] text only",
      ].join("\n"),
    ),
    [{ issue: 596, ticked: true }, { issue: 597, ticked: false }, { issue: 599, ticked: false }],
  );
});
Deno.test("epic progress counts closed task-list issues", () => {
  assertEquals(
    buildFlow(now, start, false, "main", [], [], [{
      number: 595,
      items: [{ issue: 596, closed: true }, { issue: 597, closed: false }, { issue: 598, closed: false }],
    }]).epics,
    [{ issue: 595, total: 3, done: 1 }],
  );
});
const answer = {
  data: {
    repository: {
      defaultBranchRef: { name: "main" },
      open: {
        nodes: [{
          number: 7,
          createdAt: "2026-11-08T10:00:00Z",
          isDraft: false,
          baseRefName: "main",
          headRefName: "feat/x",
          reviews: { totalCount: 0 },
        }],
      },
      merged: {
        nodes: [{
          number: 5,
          createdAt: "2026-11-01T10:00:00Z",
          mergedAt: "2026-11-02T10:00:00Z",
          baseRefName: "main",
          closingIssuesReferences: { nodes: [{ number: 3, createdAt: "2026-10-30T10:00:00Z" }] },
        }, {
          number: 6,
          createdAt: "2026-11-03T10:00:00Z",
          mergedAt: "2026-11-04T10:00:00Z",
          baseRefName: "main",
          closingIssuesReferences: { nodes: [] },
        }, {
          number: 8,
          createdAt: "2026-11-03T10:00:00Z",
          mergedAt: null,
          baseRefName: "main",
          closingIssuesReferences: { nodes: [] },
        }],
      },
      epics: { nodes: [{ number: 1, body: "- [ ] #3 one\n- [ ] #4 two" }] },
    },
  },
};
Deno.test("flow parser reads open merges newest first epics and drops unmerged", () => {
  const s = parseFlow(JSON.stringify(answer));
  assertEquals(s.defaultBranch, "main");
  assertEquals(s.open, [{
    number: 7,
    createdAt: Date.parse("2026-11-08T10:00:00Z"),
    isDraft: false,
    reviews: 0,
    baseRef: "main",
    headRef: "feat/x",
  }]);
  assertEquals(s.merged.map((p) => p.number), [6, 5]);
  assertEquals(s.merged[1]!.closes[0]!.number, 3);
  assertEquals(s.epics[0]!.number, 1);
});
Deno.test("flow issue state query aliases unique issues and parser returns closed ones", () => {
  assertStringIncludes(stateQuery([4, 3, 3]), "i3: issue(number: 3)");
  assertEquals(stateQuery([4, 3, 3]).split("issue(number").length, 3);
  assertEquals(
    closedIssues('{"data":{"repository":{"i3":{"state":"CLOSED"},"i4":{"state":"OPEN"},"i9":null}}}'),
    new Set([3]),
  );
});
Deno.test("flow section validates and unknown replacement or absence follows schema", () => {
  assertEquals(validateSnapshot(json()), []);
  assert(validateSnapshot(json().replace('"flow"', '"other"')).includes("$.other: field is not in the schema"));
  assertEquals(
    validateSnapshot(
      writeSnapshot({
        version: 3,
        date: "2026-11-09",
        generatedAt: "2026-11-09T12:00:00Z",
        repository: "mgasca/calendar",
        ci: buildCi("ci.yml", []),
        superseded: null,
      }),
    ),
    [],
  );
});
Deno.test("bad flow values fail at exact schema paths", () => {
  const cases: [(s: FlowSection) => void, string][] = [[(s) => {
    Object.assign(s, { login: "x" });
  }, "$.flow.login: field is not in the schema"], [(s) => {
    s.openPullRequests.drafts = 9;
  }, "$.flow.openPullRequests.drafts: must not exceed count"], [(s) => {
    s.epics[0]!.done = 5;
  }, "$.flow.epics[0].done: must not exceed total"], [(s) => {
    s.basis = "guessed";
  }, "$.flow.basis"]];
  for (const [change, path] of cases) {
    const s = section();
    change(s);
    assert(validateSnapshot(json(s)).some((e) => e.startsWith(path)), path);
  }
});
Deno.test("flow thin distribution forbidden and full sample distribution required", () => {
  const thin = section();
  thin.leadTime = { sample: 2, stat: { count: 2, medianSeconds: 1, p90Seconds: 1, maxSeconds: 1 } };
  assert(validateSnapshot(json(thin)).some((e) => e.includes("$.flow.leadTime.stat") && e.includes("inconclusive")));
  const missing = section();
  missing.leadTime = { sample: 9, stat: null };
  assert(validateSnapshot(json(missing)).some((e) => e.includes("$.flow.leadTime.stat: must be set")));
});
Deno.test("flow privacy scan covers section field names", () => {
  assert(
    validateSnapshot(json().replace('"epics"', '"/home/someone"')).some((e) =>
      e.includes("$.flow") && e.includes("machine path")
    ),
  );
});
