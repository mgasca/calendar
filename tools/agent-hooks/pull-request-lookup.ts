import { runCommand } from "./external-command.ts";
import type { PullRequest, PullRequestText } from "./protocol.ts";
export const lookupTimeout = 10000, informTimeout = 3000;
const environment = { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" };
function object(json: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(json);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
const int32 = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= -2147483648 && n <= 2147483647;
export function parsePr(json: string): PullRequest | null {
  const r = object(json);
  return r && int32(r.number) && typeof r.state === "string" && ["OPEN", "MERGED", "CLOSED"].includes(r.state)
    ? { number: r.number, state: r.state }
    : null;
}
export function parsePrText(json: string): PullRequestText | null {
  const r = object(json);
  return r && int32(r.number) && typeof r.baseRefName === "string" && typeof r.body === "string"
    ? { number: r.number, baseRefName: r.baseRefName, body: r.body }
    : null;
}
export async function findPr(
  cwd: string,
  branch: string,
  gh = "gh",
  timeout = lookupTimeout,
): Promise<PullRequest | null> {
  const result = await runCommand(gh, ["pr", "view", branch, "--json", "number,state"], cwd, timeout, environment);
  return result?.exitCode === 0 ? parsePr(result.stdout) : null;
}
export async function findPrText(
  cwd: string,
  selector: string | null,
  repo: string | null,
  gh = "gh",
  timeout = informTimeout,
): Promise<PullRequestText | null> {
  const args = [
    "pr",
    "view",
    ...(selector !== null ? [selector] : []),
    ...(repo !== null ? ["--repo", repo] : []),
    "--json",
    "number,baseRefName,body",
  ];
  const result = await runCommand(gh, args, cwd, timeout, environment);
  return result?.exitCode === 0 ? parsePrText(result.stdout) : null;
}
