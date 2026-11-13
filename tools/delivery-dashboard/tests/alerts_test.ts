import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { alertActions, checkRetention, evaluateAlerts, flowTitle, limitBytes, qualityTitle } from "../alerts.ts";
function snapshot(oldestWaiting = 3600, leadMedian: number | null = 1200, depth = 2, quality: unknown[] = []): string {
  return JSON.stringify({
    flow: {
      waitingForReview: { count: 1, oldestSeconds: oldestWaiting },
      leadTime: { sample: 40, stat: leadMedian === null ? null : { medianSeconds: leadMedian } },
      stacks: { open: [{ depth, pullRequests: [1, 2] }] },
    },
    quality: { scopes: quality },
  });
}
function scope(scope: string, verdict: string, low: number, rate = 0.4): unknown[] {
  return [{ scope, jobs: [{ job: "Backend", verdict, rate, low, trials: 30 }] }];
}
Deno.test("calm dashboard snapshot breaches no threshold", () => assertEquals(evaluateAlerts(snapshot()), []));
Deno.test("review wait threshold is strict", () => {
  assertEquals(evaluateAlerts(snapshot(14 * 86400)), []);
  assertEquals(evaluateAlerts(snapshot(14 * 86400 + 1)).map((b) => b.kind), ["flow"]);
});
Deno.test("lead time median threshold requires conclusive statistic", () => {
  assertStringIncludes(evaluateAlerts(snapshot(3600, 24 * 3600 + 1))[0]!.text, "lead time");
  assertEquals(evaluateAlerts(snapshot(3600, null)), []);
});
Deno.test("stack deeper than threshold produces flow breach", () =>
  assertStringIncludes(evaluateAlerts(snapshot(3600, 1200, 5))[0]!.text, "5 pull requests"));
Deno.test("main failure rate lower confidence limit above threshold triggers quality breach", () => {
  const b = evaluateAlerts(snapshot(3600, 1200, 2, scope("main", "conclusive", 0.15)));
  assertEquals(b.length, 1);
  assertEquals(b[0]!.kind, "quality");
  assertStringIncludes(b[0]!.text, "`Backend` fails 40 %");
});
Deno.test("possibly acceptable inconclusive or PR failure rates produce no alert", () => {
  for (
    const [name, verdict, low] of [["main", "conclusive", 0.1], ["main", "inconclusive", 0.5], [
      "pullRequest",
      "conclusive",
      0.5,
    ]] as const
  ) assertEquals(evaluateAlerts(snapshot(3600, 1200, 2, scope(name, verdict, low))), []);
});
Deno.test("snapshot without alert sections breaches nothing", () => assertEquals(evaluateAlerts("{}"), []));
const allFlow = [{ kind: "flow", text: "waiting" }, { kind: "flow", text: "lead time" }, {
  kind: "flow",
  text: "stack",
}];
Deno.test("multiple same-kind breaches open one linked issue", () => {
  const actions = alertActions(allFlow, [], "https://example.org/dashboard/flow/");
  assertEquals(actions.length, 1);
  const action = actions[0]!;
  assertEquals(action.issue, 0);
  assertEquals(action.title, flowTitle);
  assertStringIncludes(action.body, "- waiting");
  assertStringIncludes(action.body, "- stack");
  assertStringIncludes(action.body, "https://example.org/dashboard/flow/");
});
Deno.test("existing alert issue with smallest matching number receives comment", () =>
  assertEquals(
    alertActions(allFlow, [{ number: 42, title: "Something else" }, { number: 31, title: flowTitle }, {
      number: 30,
      title: flowTitle,
    }, { number: 12, title: qualityTitle }], "")[0]!.issue,
    30,
  ));
Deno.test("each breach kind produces ordered action while no breaches produce nothing", () => {
  assertEquals(
    alertActions([{ kind: "quality", text: "q" }, { kind: "flow", text: "f" }, { kind: "quality", text: "q2" }], [], "")
      .map((a) => [a.kind, a.issue]),
    [["flow", 0], ["quality", 0]],
  );
  assertEquals(alertActions([], [{ number: 1, title: flowTitle }], ""), []);
});
Deno.test("alert documents single channel and posting workflow", () => {
  const body = alertActions(allFlow, [], "")[0]!.body;
  assertStringIncludes(body, "the only alert");
  assertStringIncludes(body, ".github/workflows/dashboard-snapshot.yml");
});
function tree(files: [string, number][]): string {
  return files.map(([path, size]) =>
    `100644 blob 0123456789abcdef0123456789abcdef01234567 ${String(size).padStart(7, " ")}\t${path}`
  ).join("\n");
}
Deno.test("retention sums snapshot blobs and ignores other paths or garbage", () => {
  const v = checkRetention(
    tree([["snapshots/2026-11-08.json", 300], ["snapshots/2026-11-09.json", 200], ["README.md", 5000]]) +
      "\nnot a tree line\n",
    1000,
  );
  assertEquals([v.files, v.bytes, v.status], [2, 500, "ok"]);
});
Deno.test("incoming snapshot counts before branch limit is passed", () => {
  const t = tree([["snapshots/2026-11-08.json", 990]]);
  assertEquals(checkRetention(t, 1000).status, "warning");
  assertEquals(checkRetention(t, 1000, 20).status, "over");
  assertEquals(checkRetention(t, 1000, 10).status, "warning");
});
Deno.test("eighty percent retention boundary warns and below is okay", () => {
  assertEquals(checkRetention(tree([["snapshots/a.json", 799]]), 1000).status, "ok");
  assertEquals(checkRetention(tree([["snapshots/a.json", 800]]), 1000).status, "warning");
});
Deno.test("retention reads recursive trees API blob sizes only", () => {
  const json =
    '{"sha":"x","truncated":false,"tree":[{"path":"README.md","type":"blob","size":5000},{"path":"snapshots","type":"tree"},{"path":"snapshots/2026-11-08.json","type":"blob","size":900},{"path":"snapshots/2026-11-09.json","type":"blob","size":90}]}';
  const v = checkRetention(json, 1000);
  assertEquals([v.files, v.bytes, v.status], [2, 990, "warning"]);
  assertEquals(checkRetention(json, 1000, 20).status, "over");
});
Deno.test("truncated retention tree fails rather than undercounts", () =>
  assertEquals(
    checkRetention('{"truncated":true,"tree":[{"path":"snapshots/a.json","type":"blob","size":1}]}', 1000).status,
    "over",
  ));
Deno.test("empty retention tree is okay and default limit remains fifty MB", () => {
  assertEquals(checkRetention("", 1000).status, "ok");
  assertEquals(limitBytes, 52428800);
  assert(checkRetention("", 1000).message.includes("0 snapshot files"));
});
