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
/** HTML comments are not rendered and link nothing, like the PR template's `Closes #123` example. */
const visible = (body: string) => body.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
/** Neither `Closes #N` nor `Refs #N`: the issue numbers the body only mentions, which link nothing. */
function unlinked(markdown: string): string[] | null {
  const body = visible(markdown);
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
/** A PR body or base that a command is about to write, whether through `gh pr` or the REST API. */
interface PrWrite {
  create: boolean;
  selector: string | null;
  repo: string | null;
  body: string | null;
  hasNewBody: boolean;
  target: string | undefined;
}
function cliWrite(s: Segment, probe: RepoProbe): PrWrite {
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
  return {
    create: ts[2]! === "create",
    selector: positionals[0] ?? null,
    repo: options.get("--repo") ?? null,
    body: options.get("--body") ?? (file !== undefined ? bodyFile(s, file, probe) : null),
    hasNewBody: options.has("--body") || options.has("--body-file"),
    target: options.get("--base"),
  };
}
const apiOptionsWithValue = [
  "-f",
  "--raw-field",
  "-F",
  "--field",
  "-X",
  "--method",
  "-H",
  "--header",
  "-q",
  "--jq",
  "-t",
  "--template",
  "--input",
  "--hostname",
  "-p",
  "--preview",
  "--cache",
];
const pullsEndpoint = /^repos\/([^/]+)\/([^/]+)\/pulls(?:\/(\d+))?$/;
/**
 * `gh api` writing a PR body: a PATCH to `repos/<owner>/<repo>/pulls/<n>` or a POST to `repos/<owner>/<repo>/pulls`,
 * the fallback for a `gh pr edit` that fails on an old gh (story 0070). Fields are `-f`/`--raw-field` (literal) and
 * `-F`/`--field` (`@file` reads the file, `@-` stdin); a `--input` JSON request is not read.
 */
function apiWrite(s: Segment, probe: RepoProbe): PrWrite | null {
  const ts = s.tokens, fields: [typed: boolean, field: string][] = [], positionals: string[] = [];
  let method: string | null = null, input = false;
  for (let i = 2; i < ts.length;) {
    const t = ts[i]!;
    let flag = t, value: string | null = null, words = 1;
    if (t.startsWith("--") && t.includes("=")) {
      flag = t.slice(0, t.indexOf("="));
      value = t.slice(t.indexOf("=") + 1);
    } else if (/^-[fFX]./.test(t)) {
      flag = t.slice(0, 2);
      value = t.slice(2);
    } else if (apiOptionsWithValue.includes(t) && i + 1 < ts.length) {
      value = ts[i + 1]!;
      words = 2;
    }
    if (value !== null && ["-f", "--raw-field"].includes(flag)) fields.push([false, value]);
    else if (value !== null && ["-F", "--field"].includes(flag)) fields.push([true, value]);
    else if (value !== null && ["-X", "--method"].includes(flag)) method = value.toUpperCase();
    else if (flag === "--input") input = true;
    else if (!t.startsWith("-")) positionals.push(t);
    i += words;
  }
  const endpoint = (positionals[0] ?? "").replace(/^\//, "").replace(/\?.*$/, "");
  const match = endpoint.match(pullsEndpoint);
  if (match === null) return null;
  const [, owner, name, number] = match as unknown as [string, string, string, string | undefined];
  method ??= fields.length || input ? "POST" : "GET";
  if (method !== (number === undefined ? "POST" : "PATCH")) return null;
  const last = (key: string) => fields.findLast(([, f]) => f.startsWith(key + "="));
  const body = last("body"), base = last("base");
  let text: string | null = null;
  if (body !== undefined) {
    const value = body[1].slice(5);
    text = body[0] && value.startsWith("@") ? bodyFile(s, value.slice(1), probe) : value;
  }
  return {
    create: number === undefined,
    selector: number ?? null,
    repo: owner.includes("{") || name.includes("{") ? null : `${owner}/${name}`,
    body: text,
    hasNewBody: body !== undefined,
    target: base?.[1].slice(5),
  };
}
async function describe(s: Segment, w: PrWrite, probe: RepoProbe): Promise<string | null> {
  let body = w.body;
  const target = w.target;
  if (w.create) {
    if (body === null) return null;
    const base = target ?? await probe.defaultBranch(s.cwd) ?? "main";
    return missing(body, `this PR targets ${base}`, base);
  }
  if ((target === undefined && !w.hasNewBody) || (w.hasNewBody && body === null)) return null;
  const current = () => probe.pullRequestTextFor(s.cwd, w.selector, w.repo);
  if (target !== undefined) {
    body ??= (await current())?.body ?? null;
    return body === null ? null : missing(body, `this PR is being retargeted to ${target}`, target);
  }
  const pr = await current();
  return missing(body!, pr ? `PR #${pr.number} targets ${pr.baseRefName}` : "this PR", pr?.baseRefName ?? null);
}
export async function describePrLink(command: string, cwd: string, probe: RepoProbe): Promise<string | null> {
  for (const s of split(command, cwd)) {
    const ts = s.tokens;
    if (ts.length < 3 || ts[0]! !== "gh") continue;
    const write = ts[1]! === "pr" && ["create", "edit"].includes(ts[2]!)
      ? cliWrite(s, probe)
      : ts[1]! === "api"
      ? apiWrite(s, probe)
      : null;
    if (write === null) continue;
    const note = await describe(s, write, probe);
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
    }. The bodies are already public, so edit each one in place with \`gh pr edit <n> --body-file <file>\` (on a gh older than 2.82.1, where it fails on the removed Projects (classic) fields, \`gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -F body=@<file>\`, which these hooks check the same way): \`Closes #N\` on the layer that completes an issue, \`Refs #N\` on the others, and repository-relative paths and public links instead of private details (AGENTS.md: public GitHub posts).${stackLayer}`
    : null;
}
