// Story 0068: the PR link reminder for native stacks (ADR-0065), and the post-bash check of the PR bodies that
// `gh stack submit` and `gh stack link` publish without going through `gh pr create`.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { runHook } from "../hook-runner.ts";
import { describePrLink, describeStackPrs, maxStackPrs } from "../pull-request-link-check.ts";
import { parseStackBranches } from "../pull-request-lookup.ts";
import { FakeProbe, type ProbeState } from "./fake-probe.ts";

interface Row {
  args: { command: string; cwd: string; subcommand: string; stdin: string };
  before: ProbeState | null;
}
const rows: Row[] = Deno.readTextFileSync(new URL("fixtures/legacy-cases.jsonl", import.meta.url)).trim().split("\n")
  .map((line) => JSON.parse(line));
/** The legacy row's input, replayed with its recorded probe state; the result is the new one. */
async function replay(i: number) {
  const row = rows[i]!, probe = new FakeProbe(row.before);
  return { note: await describePrLink(row.args.command, row.args.cwd, probe), probe, command: row.args.command };
}
const stackSentence = "In a native stack every layer lands on main as its own squash commit (ADR-0065)";

Deno.test("A PR on a stack branch gets the reminder on create and on a body edit (legacy 240, 268, 278)", async () => {
  for (
    const [i, subject] of [[240, "this PR targets docs/story-0027"], [268, "retargeted to docs/story-0027"], [
      278,
      "PR #41 targets docs/story-0027",
    ]] as const
  ) {
    const { note, command } = await replay(i);
    assert(note !== null, command);
    assertStringIncludes(note, subject);
    assertStringIncludes(note, "neither `Closes #N` nor `Refs #N`");
    assertStringIncludes(note, stackSentence);
  }
});

Deno.test("A repository whose default branch is not main still gets the reminder (legacy 244)", async () => {
  const { note } = await replay(244);
  assertStringIncludes(note ?? "", "this PR targets develop");
});

Deno.test("A retarget without a new body reads the current body on any base (legacy 269)", async () => {
  const { note, probe } = await replay(269);
  assertEquals(note, null);
  assertEquals(probe.textQueries, [["358", null]]);
  const p = new FakeProbe();
  p.texts["358"] = { number: 358, baseRefName: "main", body: "Summary" };
  assertStringIncludes(
    await describePrLink("gh pr edit 358 --base docs/story-0027", "/repo", p) ?? "",
    "retargeted to docs/story-0027",
  );
});

Deno.test("Refs alone is never reminded, retargeted or not (legacy 271, 273)", async () => {
  for (const i of [271, 273]) assertEquals((await replay(i)).note, null);
  const p = new FakeProbe();
  assertEquals(await describePrLink("gh pr create --base docs/story-0068 --title t --body 'Refs #894'", "/r", p), null);
});

Deno.test("A PR to main keeps the ordinary message, without the stack sentence", async () => {
  const note = await describePrLink("gh pr create --base main --title t --body 'Summary'", "/r", new FakeProbe());
  assertStringIncludes(note ?? "", "this PR targets main");
  assert(!note!.includes(stackSentence));
});

Deno.test("No hook message says a stacked PR gets its Closes when it is retargeted", () => {
  const source = Deno.readTextFileSync(new URL("../pull-request-link-check.ts", import.meta.url));
  assert(!source.includes("when it is retargeted to main"));
});

Deno.test("The usage line lists post-bash (legacy 218)", async () => {
  const result = await runHook("dance", "{}", new FakeProbe(), "2.9.8");
  assertEquals(result.exitCode, 2);
  assertEquals(
    result.stderr,
    "agent-hooks: unknown subcommand 'dance'. Usage: agent-hooks <pre-bash|post-bash|pre-edit|post-edit|stop|warm>",
  );
});

function stackProbe() {
  const p = new FakeProbe();
  p.stack = ["docs/story-0068", "agent-hooks/stack"];
  p.texts["docs/story-0068"] = { number: 101, baseRefName: "main", body: "Card.\n\nRefs #894" };
  p.texts["agent-hooks/stack"] = { number: 102, baseRefName: "docs/story-0068", body: "Generated from commits" };
  return p;
}
const post = (command: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ cwd: "/repo", tool_name: "Bash", tool_input: { command }, ...extra });

Deno.test("After gh stack submit, the layer without links is named and told to edit in place", async () => {
  const p = stackProbe();
  const result = await runHook("post-bash", post("gh stack submit --auto"), p, "2.9.8");
  assertEquals(result.exitCode, 0);
  const output = JSON.parse(result.stdout!).hookSpecificOutput;
  assertEquals(output.hookEventName, "PostToolUse");
  assertEquals(output.permissionDecision, undefined);
  const note: string = output.additionalContext;
  assertStringIncludes(note, "`gh stack submit` published PR bodies that need an edit");
  assertStringIncludes(note, "PR #102 (base docs/story-0068) has neither `Closes #N` nor `Refs #N`");
  assert(!note.includes("PR #101"));
  assertStringIncludes(note, "gh pr edit <n> --body-file <file>");
  assertEquals(p.stackQueries, ["/repo"]);
  assertEquals(p.textQueries, [["docs/story-0068", null], ["agent-hooks/stack", null]]);
});

Deno.test("After gh stack link, a body with a private path is named with the detail", async () => {
  const p = new FakeProbe();
  p.texts["101"] = { number: 101, baseRefName: "main", body: "Refs #894" };
  p.texts["102"] = { number: 102, baseRefName: "x", body: "Closes #894\n\nRan in /home/someone/dev/calendar" };
  const note = await describeStackPrs("gh stack link --base main 101 --remote origin 102", "/repo", p);
  assertStringIncludes(note ?? "", "`gh stack link` published");
  assertStringIncludes(note!, "PR #102 (base x) has private details: /home/someone/dev/calendar");
  assert(!note!.includes("PR #101"));
  assertEquals(p.textQueries, [["101", null], ["102", null]]);
  assertEquals(p.stackQueries, []);
});

Deno.test("Both problems on one PR are listed together, and a PR named twice is checked once", async () => {
  const p = new FakeProbe();
  p.texts["7"] = { number: 7, baseRefName: "main", body: "See /tmp/x" };
  p.texts["b"] = { number: 7, baseRefName: "main", body: "See /tmp/x" };
  const note = await describeStackPrs("gh stack link 7 b", "/repo", p) ?? "";
  assertStringIncludes(note, "PR #7 (base main) has neither `Closes #N` nor `Refs #N`, and private details: /tmp/x");
  assertEquals(note.split("PR #7").length, 2);
});

Deno.test("Linked bodies, an unreadable stack or unreadable PRs produce no message", async () => {
  const linked = stackProbe();
  linked.texts["agent-hooks/stack"]!.body = "Closes #894";
  assertEquals(await describeStackPrs("gh stack submit", "/repo", linked), null);
  const noStack = new FakeProbe();
  assertEquals(await runHook("post-bash", post("gh stack submit"), noStack, "2.9.8"), { exitCode: 0 });
  assertEquals(noStack.textQueries, []);
  const noPrs = stackProbe();
  noPrs.texts = {};
  assertEquals(await describeStackPrs("gh stack submit", "/repo", noPrs), null);
});

Deno.test("An interrupted command, or one that is not gh stack submit or link, makes no GitHub call", async () => {
  for (
    const command of ["gh pr list", "git status", "gh stack push", "gh stack view --json", "echo gh stack submit"]
  ) {
    const p = stackProbe();
    assertEquals(await runHook("post-bash", post(command), p, "2.9.8"), { exitCode: 0 }, command);
    assertEquals([p.stackQueries, p.textQueries], [[], []], command);
  }
  const p = stackProbe();
  assertEquals(
    await runHook("post-bash", post("gh stack submit", { tool_response: { interrupted: true } }), p, "2.9.8"),
    { exitCode: 0 },
  );
  assertEquals(p.stackQueries, []);
  assertEquals(await runHook("post-bash", "{}", p, "2.9.8"), { exitCode: 0 });
});

Deno.test("A submit inside a compound command reads the stack where it ran, up to the limit", async () => {
  const p = stackProbe();
  await describeStackPrs("git push && cd sub && gh stack submit --auto", "/repo", p);
  assertEquals(p.stackQueries, ["/repo/sub"]);
  const many = new FakeProbe();
  const args = Array.from({ length: maxStackPrs + 5 }, (_, i) => String(i + 1));
  await describeStackPrs(`gh stack link ${args.join(" ")}`, "/repo", many);
  assertEquals(many.textQueries.length, maxStackPrs);
});

Deno.test("Stack view JSON yields the open branches bottom to top", () => {
  assertEquals(
    parseStackBranches(JSON.stringify({
      trunk: "main",
      branches: [{ name: "a", isMerged: true }, { name: "b", isMerged: false }, { name: "c" }, { nope: 1 }, null],
    })),
    ["b", "c"],
  );
  for (const json of ["not json", "[]", "{}", '{"branches":{}}', '{"branches":[{"name":"a","isMerged":true}]}']) {
    assertEquals(parseStackBranches(json), null, json);
  }
});

Deno.test("post-bash is registered after Bash gh commands with the shared Deno command", () => {
  const settings = JSON.parse(Deno.readTextFileSync(new URL("../../../.claude/settings.json", import.meta.url)));
  const bash = settings.hooks.PostToolUse.find((e: { matcher: string }) => e.matcher === "Bash").hooks;
  assert(
    bash.some((h: { if: string; command: string }) => h.if === "Bash(gh *)" && h.command.endsWith(" post-bash")),
  );
});
