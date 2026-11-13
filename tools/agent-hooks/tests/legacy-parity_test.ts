import { assertEquals, assertStringIncludes } from "@std/assert";
import { evaluateBash } from "../bash-guard.ts";
import { evaluateContract, evaluateEdit } from "../checks.ts";
import { runHook } from "../hook-runner.ts";
import { describePrLink } from "../pull-request-link-check.ts";
import { parsePr, parsePrText } from "../pull-request-lookup.ts";
import { split, tokenize } from "../shell-command.ts";
import { FakeProbe, type ProbeState } from "./fake-probe.ts";
interface Case {
  kind: string;
  test: string;
  args: {
    command: string;
    cwd: string;
    text: string;
    filePath: string;
    changedFiles: string[];
    times: Record<string, string | null>;
    subcommand: string;
    stdin: string;
    dotnet: string;
    json: string;
  };
  before: ProbeState | null;
  result: unknown;
  after: ProbeState | null;
}
const cases: Case[] = Deno.readTextFileSync(new URL("fixtures/legacy-cases.jsonl", import.meta.url)).trim().split("\n")
  .map((line) => JSON.parse(line));
/** Convert record property names, leaving arbitrary filenames and dictionary keys untouched. */
function resultShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(resultShape);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).filter(([k, v]) =>
      k !== "IsMergedOrClosed" && !(v === null && ["Stdout", "Stderr"].includes(k))
    ).map(([k, v]) => [k[0]!.toLowerCase() + k.slice(1), resultShape(v)]),
  );
}
let replacements = 0;
for (const [i, c] of cases.entries()) {
  if (c.kind === "HookRunner.Run" && ["warm", "post-edit"].includes(c.args.subcommand)) {
    replacements++;
    continue;
  }
  Deno.test(`legacy ${i}: ${c.test} / ${c.kind}`, async () => {
    const probe = new FakeProbe(c.before), a = c.args;
    const home = Deno.env.get("HOME");
    Deno.env.set("HOME", "/fixture-home");
    let actual: unknown;
    try {
      switch (c.kind) {
        case "BashGuard.Evaluate":
          actual = await evaluateBash(a.command, a.cwd, probe);
          break;
        case "ShellCommand.Split":
          actual = split(a.command, a.cwd);
          break;
        case "ShellCommand.Tokenize":
          actual = tokenize(a.text);
          break;
        case "EditGuard.Evaluate":
          actual = evaluateEdit(a.filePath);
          break;
        case "ContractCheck.Evaluate":
          actual = evaluateContract(a.changedFiles, (p) => a.times[p] == null ? null : Date.parse(a.times[p]!));
          break;
        case "HookRunner.Run":
          actual = await runHook(a.subcommand, a.stdin, probe, a.dotnet);
          break;
        case "PullRequestLinkCheck.Describe":
          actual = await describePrLink(a.command, a.cwd, probe);
          break;
        case "PullRequestLookup.Parse":
          actual = parsePr(a.json);
          break;
        case "PullRequestLookup.ParseText":
          actual = parsePrText(a.json);
          break;
        default:
          throw new Error(c.kind);
      }
    } finally {
      if (home === undefined) Deno.env.delete("HOME");
      else Deno.env.set("HOME", home);
    }
    const expected = resultShape(c.result);
    if (c.kind === "HookRunner.Run" && a.stdin === "not json") {
      assertEquals((actual as { exitCode: number }).exitCode, 2);
      assertStringIncludes((actual as { stderr: string }).stderr, "stdin is not the hook JSON");
    } else assertEquals(actual, expected);
    if (c.after) {
      assertEquals(probe.unstagedQueries, c.after.UnstagedQueries.map((q) => [q.Item1, q.Item2]));
      assertEquals(probe.prQueries, c.after.PullRequestQueries.map((q) => [q.Item1, q.Item2]));
      assertEquals(probe.textQueries, c.after.PullRequestTextQueries.map((q) => [q.Item1, q.Item2]));
    }
  });
}
Deno.test("legacy capture accounts for approved warm/post-edit replacements", () => assertEquals(replacements, 2));
