import { evaluateBash } from "./bash-guard.ts";
import { describeFormat, evaluateContract, evaluateEdit } from "./checks.ts";
import { describePrLink } from "./pull-request-link-check.ts";
import { context, type HookResult, parseInput, pass, preToolUse, type RepoProbe, stopBlock } from "./protocol.ts";
export const subcommands = ["pre-bash", "pre-edit", "post-edit", "stop", "warm"];
export async function runHook(
  subcommand: string,
  stdin: string,
  probe: RepoProbe,
  version: string,
): Promise<HookResult> {
  if (!subcommands.includes(subcommand)) {
    return {
      exitCode: 2,
      stderr: `agent-hooks: unknown subcommand '${subcommand}'. Usage: agent-hooks <${subcommands.join("|")}>`,
    };
  }
  let input;
  try {
    input = parseInput(stdin);
  } catch (e) {
    return {
      exitCode: 2,
      stderr: `agent-hooks ${subcommand}: stdin is not the hook JSON (${e instanceof Error ? e.message : String(e)})`,
    };
  }
  if (subcommand === "pre-bash") {
    if (input.command === null) {
      return { exitCode: 0, stderr: "agent-hooks pre-bash: no tool_input.command; letting it through" };
    }
    const verdict = await evaluateBash(input.command, input.cwd, probe);
    if (verdict) return { exitCode: 0, stdout: preToolUse(verdict) };
    const note = await describePrLink(input.command, input.cwd, probe);
    return note === null ? pass : { exitCode: 0, stdout: context("PreToolUse", note) };
  }
  if (subcommand === "pre-edit") {
    if (input.filePath === null) {
      return { exitCode: 0, stderr: "agent-hooks pre-edit: no tool_input.file_path; letting it through" };
    }
    const verdict = evaluateEdit(input.filePath);
    return verdict === null ? pass : { exitCode: 0, stdout: preToolUse(verdict) };
  }
  if (subcommand === "post-edit") {
    const note = input.filePath === null ? null : describeFormat(input.filePath);
    return note === null ? pass : { exitCode: 0, stdout: context("PostToolUse", note) };
  }
  if (subcommand === "stop") {
    if (input.stopHookActive) return pass;
    const reason = evaluateContract(await probe.changedFiles(input.cwd), (p) => probe.lastWriteTimeUtc(input.cwd, p));
    return reason === null ? pass : { exitCode: 0, stdout: stopBlock(reason) };
  }
  return { exitCode: 0, stdout: context("SessionStart", `agent-hooks active (tools/agent-hooks, Deno ${version}).`) };
}
