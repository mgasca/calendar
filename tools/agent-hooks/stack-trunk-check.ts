import type { RepoProbe } from "./protocol.ts";
import { split } from "./shell-command.ts";
/** The lowest open layer of a local gh-stack stack and the trunk it is stacked on. */
export interface StackBottom {
  branch: string;
  trunk: string;
}
const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
/**
 * Reads gh-stack's local stack file (`<git common dir>/gh-stack`) and returns the lowest layer without a merged PR
 * of the stack that contains `current`, or null when there is no such stack or the file is not one gh-stack wrote.
 */
export function parseStackBottom(json: string, current: string): StackBottom | null {
  let root;
  try {
    root = record(JSON.parse(json));
  } catch {
    return null;
  }
  const stacks = root?.stacks;
  if (!Array.isArray(stacks)) return null;
  for (const s of stacks.map(record)) {
    const trunk = record(s?.trunk)?.branch, branches = s?.branches;
    if (typeof trunk !== "string" || !trunk || !Array.isArray(branches)) continue;
    const layers = branches.map(record).filter((b) => typeof b?.branch === "string") as Record<string, unknown>[];
    if (!layers.some((b) => b.branch === current)) continue;
    const open = layers.find((b) => record(b.pullRequest)?.merged !== true);
    return open ? { branch: open.branch as string, trunk } : null;
  }
  return null;
}
/**
 * PreToolUse before `gh stack submit`: when the stack's lowest open layer does not contain `origin/<trunk>` as last
 * fetched, GitHub may rebase and force-push every layer once it creates or updates the stack (story 0071, #992).
 * Reads only local git state; makes no network call.
 */
export async function describeStackTrunk(command: string, cwd: string, probe: RepoProbe): Promise<string | null> {
  for (const s of split(command, cwd)) {
    const ts = s.tokens;
    if (ts.length < 3 || ts[0]! !== "gh" || ts[1]! !== "stack" || ts[2]! !== "submit") continue;
    const current = await probe.currentBranch(s.cwd);
    const file = current === null ? null : await probe.stackFile(s.cwd);
    const bottom = file === null || current === null ? null : parseStackBottom(file, current);
    if (bottom === null) return null;
    const remoteTrunk = `origin/${bottom.trunk}`;
    if (await probe.isAncestor(s.cwd, `refs/remotes/${remoteTrunk}`, bottom.branch) !== false) return null;
    return `Note, not a block (ADR-0065, story 0071): the stack's lowest open layer \`${bottom.branch}\` does not contain \`${remoteTrunk}\` as last fetched. When \`gh stack submit\` creates or updates the stack, GitHub may rebase every layer onto ${bottom.trunk} and force-push it, without changing your local branches. To avoid that, first update the stack yourself under the ADR-0065 exception: \`git fetch\` shows no one else pushed to its branches, then \`gh stack rebase\` and \`gh stack push\`, and comment the old and new head on each PR that already exists. If you submit as is, wait about a minute, \`git fetch\`, compare each layer's remote head with its local head, and for each layer that moved, comment its PR's old and new heads and move the local branch to the remote head.`;
  }
  return null;
}
