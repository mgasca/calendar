import { resolve } from "node:path";
import type { PullRequest, PullRequestText, RepoProbe } from "../protocol.ts";
export interface ProbeState {
  Dirty: string[];
  Existing: string[];
  Files: Record<string, string>;
  Changed: string[];
  WriteTimes: Record<string, string>;
  LinkedWorktree: boolean;
  Branches: Record<string, string>;
  PullRequests: Record<string, { Number: number; State: string }>;
  Default: string | null;
  PullRequestTexts: Record<string, { Number: number; BaseRefName: string; Body: string }>;
  UnstagedQueries: { Item1: string; Item2: string[] }[];
  PullRequestQueries: { Item1: string; Item2: string }[];
  PullRequestTextQueries: { Item1: string | null; Item2: string | null }[];
}
export class FakeProbe implements RepoProbe {
  dirty = new Set<string>();
  existing = new Set<string>();
  files: Record<string, string> = {};
  changed: string[] = [];
  writeTimes: Record<string, number> = {};
  linked = false;
  branches: Record<string, string> = {};
  prs: Record<string, PullRequest> = {};
  default: string | null = "main";
  texts: Record<string, PullRequestText> = {};
  unstagedQueries: [string, string[]][] = [];
  prQueries: [string, string][] = [];
  textQueries: [string | null, string | null][] = [];
  constructor(s?: ProbeState | null) {
    if (!s) return;
    this.dirty = new Set(s.Dirty);
    this.existing = new Set(s.Existing);
    this.files = { ...s.Files };
    this.changed = [...s.Changed];
    this.writeTimes = Object.fromEntries(Object.entries(s.WriteTimes).map(([k, v]) => [k, Date.parse(v)]));
    this.linked = s.LinkedWorktree;
    this.branches = { ...s.Branches };
    this.default = s.Default;
    this.prs = Object.fromEntries(
      Object.entries(s.PullRequests).map(([k, p]) => [k, { number: p.Number, state: p.State }]),
    );
    this.texts = Object.fromEntries(
      Object.entries(s.PullRequestTexts).map((
        [k, p],
      ) => [k, { number: p.Number, baseRefName: p.BaseRefName, body: p.Body }]),
    );
    this.unstagedQueries = s.UnstagedQueries.map((q) => [q.Item1, q.Item2]);
    this.prQueries = s.PullRequestQueries.map((q) => [q.Item1, q.Item2]);
    this.textQueries = s.PullRequestTextQueries.map((q) => [q.Item1, q.Item2]);
  }
  hasUnstagedChanges(cwd: string, paths: string[]) {
    this.unstagedQueries.push([cwd, paths]);
    return paths.some((p) => {
      const full = resolve(cwd, p);
      return [...this.dirty].some((d) => d === full || d.startsWith(full + "/"));
    });
  }
  pathExists(_cwd: string, path: string) {
    return this.existing.has(path);
  }
  isLinkedWorktree(_cwd: string) {
    return this.linked;
  }
  readFile(_cwd: string, path: string) {
    return this.files[path] ?? null;
  }
  changedFiles(_cwd: string) {
    return this.changed;
  }
  lastWriteTimeUtc(_cwd: string, path: string) {
    return this.writeTimes[path] ?? null;
  }
  currentBranch(cwd: string) {
    return this.branches[cwd] ?? null;
  }
  pullRequestFor(cwd: string, branch: string) {
    this.prQueries.push([cwd, branch]);
    return this.prs[branch] ?? null;
  }
  defaultBranch(_cwd: string) {
    return this.default;
  }
  pullRequestTextFor(_cwd: string, selector: string | null, repo: string | null) {
    this.textQueries.push([selector, repo]);
    return this.texts[selector ?? ""] ?? null;
  }
}
