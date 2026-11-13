import { bodyFile } from "./bash-guard.ts";
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
function missing(body: string, subject: string, retarget: boolean): string | null {
  const closes = numbers(
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:[\w.-]+\/[\w.-]+#\d+|#\d+|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+)/gi,
    body,
  );
  const refs = numbers(/\brefs?:?\s+(?:[\w.-]+\/[\w.-]+)?#\d+(?:\s*(?:,|and)\s*(?:[\w.-]+\/[\w.-]+)?#\d+)*/gi, body);
  if (closes.length || (refs.length && !retarget)) return null;
  if (refs.length) {
    return `${rule}: ${subject} and its body has \`Refs ${
      refs.join(", ")
    }\` but no \`Closes #N\`. A stacked PR gets its \`Closes\` when it is retargeted to main: if this PR completes an issue, add \`Closes #N\` to the body now, or the merge leaves it open.`;
  }
  const mentioned = numbers(/(?<![\w/&])#\d+\b/g, body).filter((n) => !closes.includes(n));
  const mentions = mentioned.length ? ` (it mentions ${mentioned.join(", ")}, which links nothing)` : "";
  return `${rule}: ${subject} and its body has neither \`Closes #N\` nor \`Refs #N\`${mentions}. If it completes an issue, add \`Closes #N\`; if it delivers part of one, add \`Refs #N\`; otherwise the merge leaves the issue open.`;
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
    return (target ?? await probe.defaultBranch(s.cwd) ?? "main") === "main"
      ? missing(body, "this PR targets main", false)
      : null;
  }
  const hasNewBody = options.has("--body") || options.has("--body-file");
  if (
    (target !== undefined && target !== "main") || (target === undefined && !hasNewBody) ||
    (hasNewBody && body === null)
  ) return null;
  const current = () => probe.pullRequestTextFor(s.cwd, positionals[0] ?? null, options.get("--repo") ?? null);
  if (target === "main") {
    body ??= (await current())?.body ?? null;
    return body === null ? null : missing(body, "this PR is being retargeted to main", true);
  }
  const pr = await current();
  return body !== null && pr?.baseRefName === "main" ? missing(body, `PR #${pr.number} targets main`, false) : null;
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
