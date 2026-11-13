export interface HookResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}
export interface Verdict {
  decision: string;
  reason: string;
}
export interface PullRequest {
  number: number;
  state: string;
}
export interface PullRequestText {
  number: number;
  baseRefName: string;
  body: string;
}
export interface RepoProbe {
  hasUnstagedChanges(cwd: string, paths: string[]): boolean | Promise<boolean>;
  pathExists(cwd: string, path: string): boolean;
  isLinkedWorktree(cwd: string): boolean;
  readFile(cwd: string, path: string): string | null;
  changedFiles(cwd: string): string[] | Promise<string[]>;
  lastWriteTimeUtc(cwd: string, path: string): number | null;
  currentBranch(cwd: string): string | null | Promise<string | null>;
  pullRequestFor(cwd: string, branch: string): PullRequest | null | Promise<PullRequest | null>;
  defaultBranch(cwd: string): string | null | Promise<string | null>;
  pullRequestTextFor(
    cwd: string,
    selector: string | null,
    repo: string | null,
  ): PullRequestText | null | Promise<PullRequestText | null>;
}
export interface HookInput {
  toolName: string | null;
  command: string | null;
  filePath: string | null;
  cwd: string;
  stopHookActive: boolean;
}
export function parseInput(json: string): HookInput {
  const root = JSON.parse(json);
  if (root === null || typeof root !== "object" || Array.isArray(root)) throw new SyntaxError("expected an object");
  const text = (value: unknown) => typeof value === "string" ? value : null;
  return {
    toolName: text(root.tool_name),
    command: text(root.tool_input?.command),
    filePath: text(root.tool_input?.file_path),
    cwd: text(root.cwd) ?? Deno.cwd(),
    stopHookActive: root.stop_hook_active === true,
  };
}
export const pass: HookResult = { exitCode: 0 };
export const preToolUse = (v: Verdict) =>
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: v.decision,
      permissionDecisionReason: v.reason,
    },
  });
export const context = (event: string, text: string) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
export const stopBlock = (reason: string) => JSON.stringify({ decision: "block", reason });
