import { bodyFile, privateDetails } from "./bash-guard.ts";
import type { RepoProbe } from "./protocol.ts";
import { type Segment, split } from "./shell-command.ts";
const rule =
  "Reminder, not a block (AGENTS.md, Stories and issues: the PR that completes an issue carries `Closes #N`)";
const optionsWithValue = [
  "-B",
  "--base",
  "-b",
  "--body",
  "-F",
  "--body-file",
  "-t",
  "--title",
  "-H",
  "--head",
  "-R",
  "--repo",
  "-T",
  "--template",
  "-a",
  "--assignee",
  "-l",
  "--label",
  "-m",
  "--milestone",
  "-p",
  "--project",
  "-r",
  "--reviewer",
  "--recover",
  "--add-assignee",
  "--add-label",
  "--add-project",
  "--add-reviewer",
  "--remove-assignee",
  "--remove-label",
  "--remove-project",
  "--remove-reviewer",
];
const canonical = (flag: string) =>
  ({ "-B": "--base", "-b": "--body", "-F": "--body-file", "-R": "--repo" })[flag as "-B"] ?? flag;
function numbers(regex: RegExp, body: string): string[] {
  return [
    ...new Set(
      [...body.matchAll(regex)].flatMap((m) => [...m[0].matchAll(/(?:#|\/issues\/)(\d+)/g)].map((n) => "#" + n[1])),
    ),
  ];
}
const closesPattern =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:[\w.-]+\/[\w.-]+#\d+|#\d+|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+)/gi;
const refsPattern = /\brefs?:?\s+(?:[\w.-]+\/[\w.-]+)?#\d+(?:\s*(?:,|and)\s*(?:[\w.-]+\/[\w.-]+)?#\d+)*/gi;
/** Neither `Closes #N` nor `Refs #N`: the issue numbers the body only mentions, which link nothing. */
function unlinked(body: string): string[] | null {
  const closes = numbers(closesPattern, body);
  if (closes.length || numbers(refsPattern, body).length) return null;
  return numbers(/(?<![\w/&])#\d+\b/g, body);
}
// ADR-0065: a native stack's layers each land on main as their own squash commit; none is ever retargeted.
const stackLayer =
  " In a native stack every layer lands on main as its own squash commit (ADR-0065), so the layer that completes the issue carries `Closes #N` from the start.";
function missing(body: string, subject: string, base: string | null): string | null {
  const mentioned = unlinked(body);
  if (mentioned === null) return null;
  const mentions = mentioned.length ? ` (it mentions ${mentioned.join(", ")}, which links nothing)` : "";
  return `${rule}: ${subject} and its body has neither \`Closes #N\` nor \`Refs #N\`${mentions}. If it completes an issue, add \`Closes #N\`; if it delivers part of one, add \`Refs #N\`; otherwise the merge leaves the issue open.${
    base === "main" ? "" : stackLayer
  }`;
}
async function describe(s: Segment, probe: RepoProbe): Promise<string | null> {
  const ts = s.tokens, options = new Map<string, string>(), positionals: string[] = [];
  for (let i = 3; i < ts.length;) {
    const t = ts[i]!, eq = t.indexOf("=");
    if (t.startsWith("--") && eq > 2) {
      options.set(canonical(t.slice(0, eq)), t.slice(eq + 1));
      i++;
    } else if (optionsWithValue.includes(t) && i + 1 < ts.length) {
      options.set(canonical(t), ts[i + 1]!);
      i += 2;
    } else {
      if (!t.startsWith("-")) positionals.push(t);
      i++;
    }
  }
  const file = options.get("--body-file");
  let body = options.get("--body") ?? (file !== undefined ? bodyFile(s, file, probe) : null);
  const target = options.get("--base");
  if (ts[2]! === "create") {
    if (body === null) return null;
    const base = target ?? await probe.defaultBranch(s.cwd) ?? "main";
    return missing(body, `this PR targets ${base}`, base);
  }
  const hasNewBody = options.has("--body") || options.has("--body-file");
  if ((target === undefined && !hasNewBody) || (hasNewBody && body === null)) return null;
  const current = () => probe.pullRequestTextFor(s.cwd, positionals[0] ?? null, options.get("--repo") ?? null);
  if (target !== undefined) {
    body ??= (await current())?.body ?? null;
    return body === null ? null : missing(body, `this PR is being retargeted to ${target}`, target);
  }
  const pr = await current();
  return missing(body!, pr ? `PR #${pr.number} targets ${pr.baseRefName}` : "this PR", pr?.baseRefName ?? null);
}
export async function describePrLink(command: string, cwd: string, probe: RepoProbe): Promise<string | null> {
  for (const s of split(command, cwd)) {
    if (
      s.tokens.length < 3 || s.tokens[0]! !== "gh" || s.tokens[1]! !== "pr" ||
      !["create", "edit"].includes(s.tokens[2]!)
    ) continue;
    const note = await describe(s, probe);
    if (note !== null) return note;
  }
  return null;
}
/** The most PRs one `gh stack` command is checked for; the reads run in parallel within the hook's time limit. */
export const maxStackPrs = 20;
const stackOptionsWithValue = ["--base", "--remote"];
/** The PR selectors a successful `gh stack submit` or `gh stack link` published, or null for another command. */
async function stackSelectors(s: Segment, probe: RepoProbe): Promise<string[] | null> {
  const ts = s.tokens;
  if (ts.length < 3 || ts[0]! !== "gh" || ts[1]! !== "stack" || !["submit", "link"].includes(ts[2]!)) return null;
  if (ts[2]! === "submit") return await probe.stackBranches(s.cwd) ?? [];
  const selectors: string[] = [];
  for (let i = 3; i < ts.length; i++) {
    if (stackOptionsWithValue.includes(ts[i]!)) i++;
    else if (!ts[i]!.startsWith("-")) selectors.push(ts[i]!);
  }
  return selectors;
}
/**
 * PostToolUse after a successful `gh stack submit` or `gh stack link`: these commands open and edit PRs without
 * `gh pr create`, so the bodies are read back and checked once they are already public (story 0068).
 */
export async function describeStackPrs(command: string, cwd: string, probe: RepoProbe): Promise<string | null> {
  const selectors = new Set<string>();
  let name: string | null = null;
  for (const s of split(command, cwd)) {
    const found = await stackSelectors(s, probe);
    if (found === null) continue;
    name ??= `gh stack ${s.tokens[2]!}`;
    for (const f of found) if (selectors.size < maxStackPrs) selectors.add(`${s.cwd}\0${f}`);
  }
  if (name === null) return null;
  const prs = await Promise.all(
    [...selectors].map((key) => {
      const [at, selector] = key.split("\0") as [string, string];
      return probe.pullRequestTextFor(at, selector, null);
    }),
  );
  const notes: string[] = [], seen = new Set<number>();
  for (const pr of prs) {
    if (pr === null || seen.has(pr.number)) continue;
    seen.add(pr.number);
    const problems: string[] = [];
    if (unlinked(pr.body) !== null) problems.push("neither `Closes #N` nor `Refs #N`");
    const hits = [...new Set(pr.body.match(privateDetails) ?? [])];
    if (hits.length) problems.push(`private details: ${hits.join(", ")}`);
    if (problems.length) notes.push(`PR #${pr.number} (base ${pr.baseRefName}) has ${problems.join(", and ")}`);
  }
  return notes.length
    ? `${rule}: \`${name}\` published PR bodies that need an edit. ${
      notes.join("; ")
    }. The bodies are already public, so edit each one in place with \`gh pr edit <n> --body-file <file>\`: \`Closes #N\` on the layer that completes an issue, \`Refs #N\` on the others, and repository-relative paths and public links instead of private details (AGENTS.md: public GitHub posts).${stackLayer}`
    : null;
}
