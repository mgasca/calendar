// Runs the real .claude/workflows/narrative-panel.js with stubbed Workflow hooks, so its validation,
// rebuttal routing and result shapes are checked without model calls (story 0063, #708).
import { assert, assertEquals, assertExists } from "@std/assert";
import { fromFileUrl } from "@std/path";

const SCRIPT = fromFileUrl(new URL("../../../.claude/workflows/narrative-panel.js", import.meta.url));
const FIXTURE = "tools/narrative-panel/tests/fixtures/school-library";
const PARTS = ["01-setup.md", "02-confrontation.md", "03-resolution.md"].map((p) => `${FIXTURE}/${p}`);

type Opts = { agentType?: string; label?: string; phase?: string; schema?: Record<string, unknown> };
type Call = { prompt: string; opts: Opts };
type Answer = (call: Call) => unknown;
// deno-lint-ignore no-explicit-any
type Result = any;

// A stand-in for the Workflow tool: the script body becomes an async function of its hooks.
async function run(args: unknown, answer: Answer): Promise<{ result: Result; calls: Call[]; logs: string[] }> {
  const source = (await Deno.readTextFile(SCRIPT)).replace(/^export const meta/m, "const meta");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const body = new AsyncFunction("args", "agent", "parallel", "pipeline", "phase", "log", source);
  const calls: Call[] = [];
  const logs: string[] = [];
  const agent = (prompt: string, opts: Opts) => {
    const call = { prompt, opts };
    calls.push(call);
    return Promise.resolve(answer(call));
  };
  const fail = () => {
    throw new Error("the panel should not need parallel() or pipeline()");
  };
  const result = await body(args, agent, fail, fail, () => {}, (m: string) => logs.push(m));
  return { result, calls, logs };
}

const expertsOf = (label: string | undefined) => label?.split(":")[1] ?? "";
const marker = (id: string) => `MARK-${id}-MARK`;
const questions = (id: string) => ({
  questions: [{ question: `q from ${id}`, gap: `gap-${id}`, why: "w", options: ["a", "b"], priority: "high" }],
  summary: marker(id),
});

// A panel of four: two characteristic experts, end user and business. The map relates availability
// to cost (conflict) and to end-user (synergy), cost to business (synergy); availability/business is
// neutral and every other pair is unlisted.
const PANEL = {
  phase: "questions",
  parts: PARTS,
  experts: [
    {
      id: "availability",
      role: "characteristic",
      name: "Availability expert",
      characteristic: "availability",
      requirement: "desk loans",
      target: "99.5 %",
    },
    {
      id: "cost",
      role: "characteristic",
      name: "Cost expert",
      characteristic: "cost",
      requirement: "budget",
      target: "£6,000 a year",
    },
    { id: "end-user", role: "end-user", name: "End-User expert" },
    { id: "business", role: "business", name: "Business expert" },
  ],
  map: [
    { a: "availability", b: "cost", relation: "conflict", reason: "redundancy costs money" },
    { a: "end-user", b: "availability", relation: "synergy", reason: "pupils notice an outage at the desk" },
    { a: "cost", b: "business", relation: "synergy", reason: "both guard the budget" },
    { a: "availability", b: "business", relation: "neutral", reason: "no shared lever" },
  ],
};

const RELATED: Record<string, string[]> = {
  availability: ["cost", "end-user"],
  cost: ["availability", "business"],
  "end-user": ["availability"],
  business: ["cost"],
};

const standardAnswer: Answer = ({ opts }) => {
  const id = expertsOf(opts.label);
  if (opts.phase === "Panel") return questions(id);
  return { responses: [], changed: true, revised: { ...questions(id), summary: `revised ${id}` } };
};

Deno.test("each rebuttal receives only the verdicts of the experts the map relates it to", async () => {
  const { result, calls } = await run(PANEL, standardAnswer);
  const ids = PANEL.experts.map((e) => e.id);
  for (const id of ids) {
    const rebuttal = calls.find((c) => c.opts.label === `rebuttal:${id}`);
    assertExists(rebuttal, `${id} has related experts, so it gets a rebuttal`);
    for (const other of ids.filter((o) => o !== id)) {
      assertEquals(
        rebuttal.prompt.includes(marker(other)),
        RELATED[id]!.includes(other),
        `${id}'s rebuttal ${RELATED[id]!.includes(other) ? "must" : "must not"} carry ${other}'s verdict`,
      );
    }
  }
  assertEquals(
    result.routing.map((r: Result) => [r.id, r.receivedFrom.map((f: Result) => f.id).sort()]),
    ids.map((id) => [id, [...RELATED[id]!].sort()]),
  );
  assertEquals(result.agents, 8);
});

Deno.test("an expert with only neutral or unlisted pairs gets no rebuttal and keeps its first answer", async () => {
  const panel = { ...PANEL, map: PANEL.map.filter((p) => p.b !== "business") };
  const { result, calls, logs } = await run(panel, standardAnswer);
  assertEquals(calls.some((c) => c.opts.label === "rebuttal:business"), false);
  const business = result.results.find((r: Result) => r.id === "business");
  assertEquals(business.rebuttal, null);
  assertEquals(business.final, business.initial);
  assert(logs.some((l) => l.includes("treated as neutral") && l.includes("cost/business")));
});

Deno.test("relations and reasons reach the rebuttal; revised answers become final", async () => {
  const { result, calls } = await run(PANEL, standardAnswer);
  const prompt = calls.find((c) => c.opts.label === "rebuttal:availability")!.prompt;
  assert(prompt.includes("Expert cost (conflict: redundancy costs money)"));
  assert(prompt.includes("Expert end-user (synergy: pupils notice an outage at the desk)"));
  const availability = result.results.find((r: Result) => r.id === "availability");
  assertEquals(availability.initial.summary, marker("availability"));
  assertEquals(availability.final.summary, "revised availability");
  assertEquals(availability.rebuttal.changed, true);
});

Deno.test("an expert that returns nothing is sent to nobody and is reported", async () => {
  const answer: Answer = (
    call,
  ) => (expertsOf(call.opts.label) === "cost" && call.opts.phase === "Panel" ? null : standardAnswer(call));
  const { result, calls, logs } = await run(PANEL, answer);
  assertEquals(calls.some((c) => c.opts.label === "rebuttal:cost"), false);
  // business's only related expert is cost, so business has nobody to rebut.
  assertEquals(calls.some((c) => c.opts.label === "rebuttal:business"), false);
  assertEquals(calls.find((c) => c.opts.label === "rebuttal:availability")!.prompt.includes(marker("cost")), false);
  assertEquals(result.results.find((r: Result) => r.id === "cost").status, "returned nothing");
  assert(logs.some((l) => l.includes("cost returned nothing")));
});

Deno.test("every agent is the read-only narrative-expert, with the phase's schema and only the given parts", async () => {
  const { calls } = await run(PANEL, standardAnswer);
  for (const c of calls) {
    assertEquals(c.opts.agentType, "narrative-expert");
    assertExists(c.opts.schema);
    for (const p of PARTS) assert(c.prompt.includes(`- ${p}`));
  }
  const first = calls.filter((c) => c.opts.phase === "Panel");
  assertEquals(first.length, 4);
  assert(first.every((c) => !c.prompt.includes("MARK-")), "round 1 sees no other expert's verdict");
  assert(
    calls.find((c) => c.opts.label === "questions:availability")!.prompt.includes(
      "references/experts/characteristic.md",
    ),
  );
  assert(calls.find((c) => c.opts.label === "questions:end-user")!.prompt.includes("references/experts/end-user.md"));
});

Deno.test("rebuttals re-read only the parts a peer cites; round 1 reads them all", async () => {
  const { calls } = await run(PANEL, standardAnswer);
  const reread = "Re-read a part only when a peer's point cites it";
  const rebuttals = calls.filter((c) => c.opts.phase === "Rebuttal");
  assertEquals(rebuttals.length, 4);
  for (const c of rebuttals) assert(c.prompt.includes(reread), `${c.opts.label} limits its part reads`);
  for (const c of calls.filter((x) => x.opts.phase === "Panel")) {
    assertEquals(c.prompt.includes(reread), false, `${c.opts.label} reads every part`);
  }
});

Deno.test("the alternatives phase lists the alternatives and uses the verdict schema", async () => {
  const args = {
    ...PANEL,
    phase: "alternatives",
    alternatives: [{ id: "A1", title: "Hosted" }, { id: "A2", title: "Own app" }],
  };
  const { calls } = await run(
    args,
    () => ({ verdicts: [], summary: "s", responses: [], changed: false, revised: { verdicts: [], summary: "s" } }),
  );
  const c = calls.find((x) => x.opts.label === "alternatives:cost")!;
  assert(c.prompt.includes("- A1: Hosted") && c.prompt.includes("- A2: Own app"));
  assertExists((c.opts.schema!.properties as Record<string, unknown>).verdicts);
  assert(c.prompt.includes("from 0 (does not meet) to 3 (fully meets) in half steps"));
  // deno-lint-ignore no-explicit-any
  const rating = (c.opts.schema as any).properties.verdicts.items.properties.rating;
  assertEquals([rating.type, rating.minimum, rating.maximum, rating.multipleOf], ["number", 0, 3, 0.5]);
});

Deno.test("invalid args return reasons and start no agent", async () => {
  const cases: [string, unknown][] = [
    ["unknown phase", { ...PANEL, phase: "vote" }],
    ["no parts", { ...PANEL, parts: [] }],
    ["absolute part", { ...PANEL, parts: ["/etc/passwd"] }],
    ["no business expert", { ...PANEL, experts: PANEL.experts.filter((e) => e.role !== "business") }],
    ["six characteristics", {
      ...PANEL,
      experts: [
        ...PANEL.experts,
        ...[1, 2, 3, 4].map((n) => ({ id: `c${n}`, role: "characteristic", characteristic: `c${n}` })),
      ],
    }],
    ["duplicate id", { ...PANEL, experts: [...PANEL.experts, PANEL.experts[0]] }],
    ["unknown map expert", { ...PANEL, map: [{ a: "availability", b: "security", relation: "synergy" }] }],
    ["self pair", { ...PANEL, map: [{ a: "cost", b: "cost", relation: "conflict" }] }],
    ["pair twice", { ...PANEL, map: [...PANEL.map, { a: "cost", b: "availability", relation: "synergy" }] }],
    ["alternatives missing", { ...PANEL, phase: "alternatives" }],
  ];
  for (const [name, args] of cases) {
    const { result, calls } = await run(args, standardAnswer);
    assert(Array.isArray(result.invalid) && result.invalid.length > 0, `${name}: expected invalid`);
    assertEquals(calls.length, 0, `${name}: no agent`);
  }
});
