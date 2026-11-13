import { dirname, resolve } from "node:path";
import { runCommand } from "./external-command.ts";
import { findPr, findPrText } from "./pull-request-lookup.ts";
import type { RepoProbe } from "./protocol.ts";
export const maxTextFileBytes = 1 << 20;
const lines = (s: string) => s.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.length > 0);
async function git(cwd: string, args: string[]) {
  return await runCommand("git", args, cwd, 5000) ?? { exitCode: 127, stdout: "" };
}
export class GitProbe implements RepoProbe {
  async hasUnstagedChanges(cwd: string, paths: string[]) {
    return (await git(cwd, ["diff", "--quiet", "--", ...paths])).exitCode === 1;
  }
  pathExists(cwd: string, path: string) {
    try {
      Deno.statSync(resolve(cwd, path));
      return true;
    } catch {
      return false;
    }
  }
  isLinkedWorktree(cwd: string) {
    let dir = resolve(cwd);
    while (true) {
      try {
        const info = Deno.statSync(resolve(dir, ".git"));
        if (info.isFile) return true;
        if (info.isDirectory) return false;
      } catch { /* continue to parent */ }
      const parent = dirname(dir);
      if (parent === dir) return false;
      dir = parent;
    }
  }
  readFile(cwd: string, path: string): string | null {
    try {
      const full = resolve(cwd, path), stat = Deno.statSync(full);
      if (stat.isDirectory) return null;
      if (!stat.isFile || stat.size === 0 || stat.size > maxTextFileBytes) return "";
      using file = Deno.openSync(full, { read: true });
      const bytes = new Uint8Array(maxTextFileBytes + 1);
      let length = 0;
      while (length < bytes.length) {
        const n = file.readSync(bytes.subarray(length));
        if (n === null) break;
        length += n;
      }
      if (length > maxTextFileBytes || bytes.subarray(0, length).includes(0)) return "";
      return new TextDecoder().decode(bytes.subarray(0, length)).replace(/^\uFEFF/, "");
    } catch {
      return null;
    }
  }
  async changedFiles(cwd: string) {
    const files = new Set<string>();
    for (const base of ["origin/main", "main"]) {
      const mergeBase = await git(cwd, ["merge-base", "HEAD", base]);
      if (mergeBase.exitCode === 0 && mergeBase.stdout.trim()) {
        const tip = new Set(lines((await git(cwd, ["diff", "--name-only", base])).stdout));
        for (const file of lines((await git(cwd, ["diff", "--name-only", mergeBase.stdout.trim()])).stdout)) {
          if (tip.has(file)) files.add(file);
        }
        break;
      }
    }
    for (let line of lines((await git(cwd, ["status", "--porcelain", "--untracked-files=all"])).stdout)) {
      if (line.length > 3) line = line.slice(3);
      if (line.includes(" -> ")) line = line.slice(line.indexOf(" -> ") + 4);
      files.add(line);
    }
    return [...files].sort();
  }
  lastWriteTimeUtc(cwd: string, path: string) {
    try {
      const s = Deno.statSync(resolve(cwd, path));
      return s.isFile ? s.mtime?.getTime() ?? null : null;
    } catch {
      return null;
    }
  }
  async currentBranch(cwd: string) {
    const r = await git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    return r.exitCode === 0 ? r.stdout.trim() || null : null;
  }
  async defaultBranch(cwd: string) {
    const r = await git(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]),
      head = r.exitCode === 0 ? r.stdout.trim() : "",
      slash = head.indexOf("/");
    return slash > 0 && slash < head.length - 1 ? head.slice(slash + 1) : null;
  }
  pullRequestFor(cwd: string, branch: string) {
    return findPr(cwd, branch);
  }
  pullRequestTextFor(cwd: string, selector: string | null, repo: string | null) {
    return findPrText(cwd, selector, repo);
  }
}
