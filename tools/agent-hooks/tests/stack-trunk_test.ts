// Story 0071 (#992): GitHub may rebase and force-push every layer of a stack when `gh stack submit` creates or
// updates it, so a note before the command says when the lowest open layer is behind `origin/<trunk>`.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "node:path";
import { runCommand } from "../external-command.ts";
import { GitProbe } from "../git-probe.ts";
import { runHook } from "../hook-runner.ts";
import { describeStackTrunk, parseStackBottom } from "../stack-trunk-check.ts";
import { FakeProbe } from "./fake-probe.ts";

const layer = (branch: string, merged = false, number = 0) => ({
  branch,
  head: "1".repeat(40),
  ...(number ? { pullRequest: { number, ...(merged ? { merged: true } : {}) } } : {}),
});
const stackFile = (...stacks: { trunk: string; branches: ReturnType<typeof layer>[] }[]) =>
  JSON.stringify({
    schemaVersion: 1,
    repository: "github.com:o/r",
    stacks: stacks.map((s) => ({ trunk: { branch: s.trunk, head: "0".repeat(40) }, branches: s.branches })),
  });
function probe(behind: boolean | null = true) {
  const p = new FakeProbe();
  p.branches["/repo"] = "tools/layer";
  p.stackFileText = stackFile(
    { trunk: "main", branches: [layer("other/one", false, 5)] },
    { trunk: "main", branches: [layer("docs/card", false, 101), layer("tools/layer")] },
  );
  if (behind !== null) p.ancestry["refs/remotes/origin/main docs/card"] = !behind;
  return p;
}
const pre = (command: string) => JSON.stringify({ cwd: "/repo", tool_name: "Bash", tool_input: { command } });

Deno.test("A stack whose lowest open layer is behind origin/main gets one inform note before submit", async () => {
  const p = probe();
  const result = await runHook("pre-bash", pre("gh stack submit --auto"), p, "2.9.8");
  assertEquals(result.exitCode, 0);
  const output = JSON.parse(result.stdout!).hookSpecificOutput;
  assertEquals(output.hookEventName, "PreToolUse");
  assertEquals(output.permissionDecision, undefined);
  const note: string = output.additionalContext;
  assertStringIncludes(note, "`docs/card` does not contain `origin/main` as last fetched");
  assertStringIncludes(note, "GitHub may rebase every layer onto main and force-push it");
  assertStringIncludes(note, "`gh stack rebase` and `gh stack push`");
  assertStringIncludes(note, "comment the old and new head on each PR");
  assertStringIncludes(note, "compare each layer's remote head with its local head");
  assertEquals(p.ancestryQueries, [["refs/remotes/origin/main", "docs/card"]]);
});

Deno.test("A stack already on origin/main, or with unknown ancestry, gets no note", async () => {
  for (const behind of [false, null]) {
    assertEquals(await runHook("pre-bash", pre("gh stack submit"), probe(behind), "2.9.8"), { exitCode: 0 });
  }
});

Deno.test("Merged lower layers are skipped: the note names the lowest open layer", async () => {
  const p = probe();
  p.stackFileText = stackFile({
    trunk: "main",
    branches: [layer("docs/card", true, 101), layer("tools/mid", false, 102), layer("tools/layer")],
  });
  p.ancestry["refs/remotes/origin/main tools/mid"] = false;
  assertStringIncludes(await describeStackTrunk("gh stack submit", "/repo", p) ?? "", "`tools/mid` does not contain");
  assertEquals(p.ancestryQueries, [["refs/remotes/origin/main", "tools/mid"]]);
});

Deno.test("No stack, an unreadable stack file, or a branch in no stack gives no note and no git query", async () => {
  const cases: [string | null, string | null][] = [
    [null, "tools/layer"],
    ["not json", "tools/layer"],
    ['{"stacks": "x"}', "tools/layer"],
    [stackFile({ trunk: "main", branches: [layer("a")] }), "tools/layer"],
    [stackFile({ trunk: "main", branches: [layer("tools/layer", true, 9)] }), "tools/layer"],
    [stackFile({ trunk: "main", branches: [layer("tools/layer")] }), null],
  ];
  for (const [file, branch] of cases) {
    const p = new FakeProbe();
    p.stackFileText = file;
    if (branch) p.branches["/repo"] = branch;
    assertEquals(await describeStackTrunk("gh stack submit", "/repo", p), null, String(file));
    assertEquals(p.ancestryQueries, [], String(file));
  }
});

Deno.test("Only gh stack submit is checked", async () => {
  for (const command of ["gh stack push", "gh stack link 1 2", "gh stack view --json", "echo gh stack submit"]) {
    const p = probe();
    assertEquals(await describeStackTrunk(command, "/repo", p), null, command);
    assertEquals(p.ancestryQueries, [], command);
  }
  assertStringIncludes(
    await describeStackTrunk("cd /repo && gh stack submit", "/elsewhere", probe()) ?? "",
    "docs/card",
  );
});

Deno.test("parseStackBottom picks the stack that contains the current branch and uses its trunk", () => {
  const file = stackFile(
    { trunk: "main", branches: [layer("x")] },
    { trunk: "develop", branches: [layer("y", true, 1), layer("z")] },
  );
  assertEquals(parseStackBottom(file, "z"), { branch: "z", trunk: "develop" });
  assertEquals(parseStackBottom(file, "x"), { branch: "x", trunk: "main" });
  assertEquals(parseStackBottom(file, "w"), null);
});

async function git(root: string, args: string[]) {
  const r = await runCommand("git", args, root, 5000, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
  assertEquals(r?.exitCode, 0, JSON.stringify({ args, r }));
  return r!.stdout.trim();
}
async function commit(root: string, file: string) {
  Deno.writeTextFileSync(join(root, file), file);
  await git(root, ["add", "-A"]);
  await git(root, ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", file]);
}

Deno.test("GitProbe reads the stack file from the common git dir of a linked worktree and tests ancestry", async () => {
  const root = Deno.makeTempDirSync({ prefix: "hook-test-" });
  try {
    const main = join(root, "main"), linked = join(root, "linked");
    Deno.mkdirSync(main);
    await git(main, ["init", "-q", "-b", "main"]);
    await commit(main, "a");
    await git(main, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    await git(main, ["worktree", "add", "-q", "-b", "layer", linked]);
    const p = new GitProbe();
    assertEquals(await p.stackFile(linked), null);
    Deno.writeTextFileSync(join(main, ".git", "gh-stack"), "{}");
    assertEquals(await p.stackFile(linked), "{}");
    assertEquals(await p.isAncestor(linked, "refs/remotes/origin/main", "layer"), true);
    await commit(main, "b");
    await git(main, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    assertEquals(await p.isAncestor(linked, "refs/remotes/origin/main", "layer"), false);
    assertEquals(await p.isAncestor(linked, "refs/remotes/origin/missing", "layer"), null);
    assert(await p.stackFile(join(root, "nowhere")) === null);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});
