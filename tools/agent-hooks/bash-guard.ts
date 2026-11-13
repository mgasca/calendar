import { resolve } from "node:path";
import { BodySources, redirectedFrom } from "./body-sources.ts";
import { type Segment, split } from "./shell-command.ts";
import type { RepoProbe, Verdict } from "./protocol.ts";
const privateDetails =
  /\/home\/[^\s"']*|\/tmp\/[^\s"']*|\/mnt\/c\/[^\s"']*|\/Users\/[^\s"']*|\b[A-Za-z]:\\[^\s"']*|\.claude\/worktrees\/[^\s"']*|\b(?:session|task|agent)[_-][0-9a-f]{8,}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const hasFlag = (arg: string, flag: string) => arg.length > 1 && arg[0] === "-" && arg[1] !== "-" && arg.includes(flag);
const pathArgs = (args: string[]) => args.filter((a) => !a.startsWith("-"));
interface GitCall {
  subcommand: string;
  args: string[];
  cwd: string;
}
function parseGit(s: Segment): GitCall | null {
  let cwd = s.cwd, i = 1;
  while (i < s.tokens.length && s.tokens[i]!.startsWith("-")) {
    if (s.tokens[i]! === "-C" && i + 1 < s.tokens.length) cwd = resolve(cwd, s.tokens[i + 1]!);
    i += ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"].includes(s.tokens[i]!) ? 2 : 1;
  }
  return i < s.tokens.length ? { subcommand: s.tokens[i]!, args: s.tokens.slice(i + 1), cwd } : null;
}
async function git(s: Segment, probe: RepoProbe, switched: Map<string, string | null>): Promise<Verdict | null> {
  const call = parseGit(s);
  if (!call) return null;
  const { args, subcommand, cwd } = call;
  if (["switch", "checkout"].includes(subcommand) && !args.includes("--")) {
    const create = args.findIndex((a) =>
      ["-c", "-C", "--create", "--force-create", "-b", "-B", "--orphan"].includes(a)
    );
    if (create >= 0 && create + 1 < args.length) switched.set(cwd, args[create + 1]!);
    else if (args.some((a) => ["--detach", "-d", "-"].includes(a))) switched.set(cwd, null);
    else {
      const target = pathArgs(args)[0];
      if (target !== undefined && (subcommand === "switch" || !probe.pathExists(cwd, target))) {
        switched.set(cwd, target);
      }
    }
  }
  if (subcommand === "push") return push(call, probe, switched);
  let paths: string[] = [];
  if (s.tokens[1]! === "restore") {
    const staged = args.some((a) => a === "--staged" || hasFlag(a, "S"));
    const worktree = args.some((a) => a === "--worktree" || hasFlag(a, "W"));
    if (staged && !worktree) return null;
    paths = pathArgs(args);
  } else if (s.tokens[1]! === "checkout") {
    const separator = args.indexOf("--");
    paths = separator >= 0
      ? args.slice(separator + 1)
      : pathArgs(args).filter((p) => p === "." || probe.pathExists(s.cwd, p));
    if (separator < 0 && args.some((a) => ["-b", "-B", "--orphan", "--detach"].includes(a))) return null;
  }
  return paths.length && await probe.hasUnstagedChanges(s.cwd, paths)
    ? {
      decision: "deny",
      reason: `Unstaged changes in ${
        paths.join(", ")
      } would be discarded. Save the patch (git diff > file) or make a WIP commit first, then restore the saved version explicitly (AGENTS.md: preserve the fix when proving a regression test).`,
    }
    : null;
}
async function push(call: GitCall, probe: RepoProbe, switched: Map<string, string | null>): Promise<Verdict | null> {
  const positionals: string[] = [];
  let tags = false;
  for (let i = 0; i < call.args.length;) {
    const arg = call.args[i]!;
    if (arg === "--") {
      positionals.push(...call.args.slice(i + 1));
      break;
    }
    if (
      ["--all", "--branches", "--mirror", "--delete", "--dry-run"].includes(arg) || hasFlag(arg, "d") ||
      hasFlag(arg, "n")
    ) return null;
    tags ||= arg === "--tags";
    if (!arg.startsWith("-")) positionals.push(arg);
    i += ["--repo", "-o", "--push-option", "--receive-pack", "--exec"].includes(arg) ? 2 : 1;
  }
  if (tags && positionals.length < 2) return null;
  let current: string | null | undefined;
  const getCurrent = async () =>
    current === undefined
      ? (current = switched.has(call.cwd) ? switched.get(call.cwd) ?? null : await probe.currentBranch(call.cwd))
      : current;
  const remoteBranch = (refspec: string) => {
    const spec = refspec.replace(/^\++/, ""),
      colon = spec.indexOf(":"),
      target = colon >= 0 ? spec.slice(colon + 1) : spec;
    if (colon === 0 || !target.length || target.includes("*")) return null;
    if (["HEAD", "@"].includes(target)) return getCurrent();
    if (target.startsWith("refs/heads/")) return target.slice("refs/heads/".length);
    return target.startsWith("refs/") ? null : target;
  };
  const branches = positionals.length < 2
    ? [await getCurrent()]
    : await Promise.all(positionals.slice(1).map(remoteBranch));
  for (const branch of branches) {
    if (branch === null || /^\d*$/.test(branch)) continue;
    const pr = await probe.pullRequestFor(call.cwd, branch);
    if (pr && ["MERGED", "CLOSED"].includes(pr.state)) {
      return {
        decision: "deny",
        reason:
          `this branch's PR is merged/closed: start a new branch from origin/main (branch '${branch}' has PR #${pr.number} ${pr.state.toLowerCase()}; a push adds nothing to it and recreates the deleted remote branch. AGENTS.md: verify delivery across a merge).`,
      };
    }
  }
  return null;
}
const sourceWord = (ts: string[], i: number) =>
  i < ts.length && (ts[i]! === "-" || !ts[i]!.startsWith("-")) ? ts[i]! : null;
function fieldFile(field: string): string | null {
  const eq = field.indexOf("=");
  return eq >= 0 && field[eq + 1] === "@" ? field.slice(eq + 2) : null;
}
export function bodyFile(s: Segment, path: string, probe: RepoProbe) {
  return path === "-" ? s.stdin : probe.readFile(s.cwd, path);
}
function ghPost(s: Segment, sources: BodySources): Verdict | null {
  const ts = s.tokens;
  if (ts.length < 3) return null;
  const api = ts[1]! === "api";
  const isPost = api
    ? ts.slice(2).some((w) =>
      w.startsWith("-f") || w.startsWith("-F") ||
      ["--field", "--raw-field", "--input"].some((o) => w === o || w.startsWith(o + "="))
    )
    : ["issue", "pr"].includes(ts[1]!) && ["create", "comment", "edit", "review"].includes(ts[2]!);
  if (!isPost) return null;
  let text = "";
  for (let i = 1; i < ts.length;) {
    const w = ts[i]!, next = sourceWord(ts, i + 1);
    let source: string | null = null, words = 1, redirect = false;
    if (w === "<" && i + 1 < ts.length) {
      source = ts[i + 1]!;
      words = 2;
      redirect = true;
    } else if (redirectedFrom([w]) !== null) {
      source = redirectedFrom([w]);
      redirect = true;
    } else if (!api) {
      if (["--body-file", "-F"].includes(w) && next !== null) {
        source = next;
        words = 2;
      } else if (w.startsWith("--body-file=")) source = w.slice(12);
    } else {
      if (w === "--input" && next !== null) {
        source = next;
        words = 2;
      } else if (["-F", "--field"].includes(w) && next !== null && fieldFile(next) !== null) {
        source = fieldFile(next);
        words = 2;
      } else if (w.startsWith("--input=")) source = w.slice(8);
      else if (w.startsWith("--field=")) source = fieldFile(w.slice(8));
      else if (w.startsWith("-F") && w.length > 2) source = fieldFile(w.slice(2));
    }
    const body = source === null ? null : sources.read(s, source, redirect);
    if (!body || body.keepWords) text += ts.slice(i, i + words).join("\n") + "\n";
    if (body) text += body.text + "\n";
    i += words;
  }
  const hits = [...new Set(text.match(privateDetails) ?? [])];
  return hits.length
    ? {
      decision: "deny",
      reason: `The post would publish private details: ${
        hits.join(", ")
      }. Use repository-relative paths and public issue/PR links, and leave session, task and subagent handles out (AGENTS.md: public GitHub posts).`,
    }
    : null;
}
export async function evaluateBash(command: string, cwd: string, probe: RepoProbe): Promise<Verdict | null> {
  const switched = new Map<string, string | null>(), sources = new BodySources(probe);
  for (const s of split(command, cwd)) {
    let verdict: Verdict | null = null;
    if (s.tokens[0]! === "git") verdict = await git(s, probe, switched);
    else if (s.tokens[0]! === "gh") verdict = ghPost(s, sources);
    else {
      const touches = s.tokens[0]! === "just"
        ? /(?:^| )db(?: |::)(?:(?:do|run) (?:\S+ )*)?(?:up|down|reset|migrate|psql)(?: |$)/.test(
          s.tokens.slice(1).join(" "),
        )
        : s.tokens[0]! === "docker" && s.tokens[1]! === "compose";
      if (touches && probe.isLinkedWorktree(s.cwd)) {
        verdict = {
          decision: "ask",
          reason:
            "This runs from a linked worktree against the shared Compose project (name calendar, volume calendar-pgdata, port 5432), which other checkouts and the human's own database use. For an isolated stack follow the run-calendar skill (throwaway PostgreSQL on 55432); clean up only resources this task started.",
        };
      }
    }
    if (verdict) return verdict;
    sources.observe(s);
  }
  return null;
}
