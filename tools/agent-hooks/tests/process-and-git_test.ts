import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { isAbsolute, join } from "node:path";
import { onPath, runCommand } from "../external-command.ts";
import { findPr, findPrText, informTimeout, lookupTimeout, parsePr, parsePrText } from "../pull-request-lookup.ts";
import { GitProbe, maxTextFileBytes } from "../git-probe.ts";
async function temp(test: (root: string) => void | Promise<void>) {
  const root = Deno.makeTempDirSync({ prefix: "hook-test-" });
  try {
    await test(root);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
}
function script(root: string, body: string) {
  const path = join(root, crypto.randomUUID());
  Deno.writeTextFileSync(path, "#!/bin/sh\n" + body + "\n");
  Deno.chmodSync(path, 0o700);
  return path;
}
async function command(root: string, args: string[]) {
  const r = await runCommand("git", args, root, 5000, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
  assertEquals(r?.exitCode, 0, JSON.stringify({ args, r }));
  return r!.stdout.trim();
}
async function commit(root: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) Deno.writeTextFileSync(join(root, path), text);
  await command(root, ["add", "-A"]);
  await command(root, [
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-q",
    "-m",
    "change",
  ]);
}
Deno.test("ExternalCommand: exit code, stdout only, final newline and nonzero statuses", () =>
  temp(async (root) => {
    assertEquals(await runCommand("sh", ["-c", "echo out; echo err >&2; exit 3"], root, 5000), {
      exitCode: 3,
      stdout: "out\n",
    });
    assertEquals(await runCommand("sh", ["-c", "printf out; exit 124"], root, 5000), {
      exitCode: 124,
      stdout: "out\n",
    });
    assertEquals(await runCommand("sh", ["-c", "exit 127"], root, 5000), { exitCode: 127, stdout: "" });
  }));
Deno.test("ExternalCommand: closes stdin and sets environment", () =>
  temp(async (root) => {
    assertEquals(
      await runCommand("sh", ["-c", 'cat; echo "$AGENT_HOOKS_TEST"'], root, 5000, { AGENT_HOOKS_TEST: "set" }),
      { exitCode: 0, stdout: "set\n" },
    );
  }));
Deno.test("ExternalCommand: missing executable or directory", () =>
  temp(async (root) => {
    assertEquals(await runCommand("agent-hooks-no-such-executable", [], root, 5000), null);
    assertEquals(await runCommand("sh", ["-c", "true"], join(root, "missing"), 5000), null);
  }));
Deno.test("ExternalCommand: kills command and its descendants within time limit", () =>
  temp(async (root) => {
    const start = performance.now();
    assertEquals(await runCommand("sh", ["-c", "sleep 10 & echo $! > child.pid; wait"], root, 200), null);
    assert(performance.now() - start < 5000);
    const pid = Number(Deno.readTextFileSync(join(root, "child.pid")).trim());
    // A reaped child is absent; a zombie has exited and cannot execute or hold pipes.
    const child = await runCommand("ps", ["-o", "stat=", "-p", String(pid)], root, 5000);
    assert(child === null || child.exitCode !== 0 || child.stdout.trim().startsWith("Z"));
  }));
Deno.test("ExternalCommand: retries a script held open for writing (ETXTBSY)", async () => {
  const root = Deno.makeTempDirSync();
  let holder: Deno.ChildProcess | undefined;
  try {
    const path = script(root, "echo ran");
    holder = new Deno.Command("sh", {
      args: ["-c", 'exec 3>"$1"; echo ready; sleep 0.3; exec 3>&-', "sh", path],
      stdout: "piped",
    }).spawn();
    const reader = holder.stdout.getReader();
    await reader.read();
    reader.releaseLock();
    // Opening without truncation is necessary: the holder only owns a write descriptor.
    Deno.writeTextFileSync(path, "#!/bin/sh\necho ran\n");
    assertEquals((await runCommand(path, [], root, 5000))?.stdout.trim(), "ran");
    await holder.status;
    await holder.stdout.cancel();
  } finally {
    if (holder) await holder.status;
    Deno.removeSync(root, { recursive: true });
  }
});
Deno.test("ExternalCommand: OnPath resolves names, keeps absolute and missing paths", () => {
  assert(isAbsolute(onPath("sh")));
  assertEquals(onPath("/bin/sh"), "/bin/sh");
  assertEquals(onPath("agent-hooks-no-such-executable"), "agent-hooks-no-such-executable");
});
Deno.test("PullRequestLookup: branch and cwd arguments", () =>
  temp(async (root) => {
    const gh = script(root, 'pwd > "$0.cwd"; echo "$@" > "$0.args"; echo \'{"number":186,"state":"MERGED"}\'');
    assertEquals(await findPr(root, "feature", gh), { number: 186, state: "MERGED" });
    assertEquals(Deno.readTextFileSync(gh + ".args").trim(), "pr view feature --json number,state");
    assertEquals(Deno.readTextFileSync(gh + ".cwd").trim(), root);
  }));
for (
  const [name, body] of [
    ["no PR", "echo 'no pull requests found for branch feature' >&2; exit 1"],
    ["failure after PR output", 'echo \'{"number":186,"state":"MERGED"}\'; exit 4'],
  ]
) {
  Deno.test(`PullRequestLookup: ${name}`, () =>
    temp(async (root) => assertEquals(await findPr(root, "feature", script(root, body!)), null)));
}
Deno.test("PullRequestLookup: missing gh", () =>
  temp(async (root) => assertEquals(await findPr(root, "feature", join(root, "no-gh")), null)));
Deno.test("PullRequestLookup: waits for input then times out", () =>
  temp(async (root) => {
    const start = performance.now();
    assertEquals(
      await findPr(
        root,
        "feature",
        script(root, 'read answer; sleep 10; echo \'{"number":186,"state":"MERGED"}\''),
        300,
      ),
      null,
    );
    assert(performance.now() - start < 5000);
  }));
Deno.test("PullRequestLookup: prompt and update notifier disabled", () =>
  temp(async (root) => {
    assertEquals(
      await findPr(
        root,
        "feature",
        script(
          root,
          'test "$GH_NO_UPDATE_NOTIFIER" = 1 || exit 1; echo "{\\"number\\":${GH_PROMPT_DISABLED:-0},\\"state\\":\\"OPEN\\"}"',
        ),
      ),
      { number: 1, state: "OPEN" },
    );
  }));
Deno.test("PullRequestLookup: named PR/repo text arguments", () =>
  temp(async (root) => {
    const gh = script(root, 'echo "$@" > "$0.args"; echo \'{"number":358,"baseRefName":"main","body":"Refs #318"}\'');
    assertEquals(await findPrText(root, "358", "mgasca/calendar", gh), {
      number: 358,
      baseRefName: "main",
      body: "Refs #318",
    });
    assertEquals(
      Deno.readTextFileSync(gh + ".args").trim(),
      "pr view 358 --repo mgasca/calendar --json number,baseRefName,body",
    );
  }));
Deno.test("PullRequestLookup: omitted selector uses current branch", () =>
  temp(async (root) => {
    const gh = script(root, 'echo "$@" > "$0.args"; echo \'{"number":1,"baseRefName":"main","body":""}\'');
    assertEquals(await findPrText(root, null, null, gh), { number: 1, baseRefName: "main", body: "" });
    assertEquals(Deno.readTextFileSync(gh + ".args").trim(), "pr view --json number,baseRefName,body");
  }));
Deno.test("PullRequestLookup: inform lookup shorter timeout and failures", () =>
  temp(async (root) => {
    const start = performance.now();
    assertEquals(
      await findPrText(
        root,
        "358",
        null,
        script(root, 'sleep 10; echo \'{"number":1,"baseRefName":"main","body":""}\''),
        300,
      ),
      null,
    );
    assert(performance.now() - start < 5000);
    assert(informTimeout <= 3000);
    assert(informTimeout < lookupTimeout);
    assertEquals(await findPrText(root, "358", null, script(root, "exit 1")), null);
  }));
Deno.test("PullRequestLookup: malformed types and int32 bounds", () => {
  for (
    const value of [null, [], {}, { number: 1.5, state: "OPEN" }, { number: 2147483648, state: "OPEN" }, {
      number: -2147483649,
      state: "OPEN",
    }]
  ) assertEquals(parsePr(JSON.stringify(value)), null);
  assertEquals(parsePrText('{"number":1.1,"baseRefName":"main","body":""}'), null);
});
Deno.test("GitProbe: linked worktree file versus directory at ancestors", () =>
  temp((root) => {
    const probe = new GitProbe(), nested = join(root, "a", "b");
    Deno.mkdirSync(nested, { recursive: true });
    assertEquals(probe.isLinkedWorktree(nested), false);
    Deno.mkdirSync(join(root, ".git"));
    assertEquals(probe.isLinkedWorktree(nested), false);
    Deno.removeSync(join(root, ".git"));
    Deno.writeTextFileSync(join(root, ".git"), "gitdir: elsewhere\n");
    assertEquals(probe.isLinkedWorktree(nested), true);
  }));
Deno.test("GitProbe: excludes already squash-delivered contents from changed files", () =>
  temp(async (root) => {
    await command(root, ["init", "-q", "-b", "main"]);
    await commit(root, { "delivered.cs": "old", "pending.cs": "old" });
    await command(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    await command(root, ["switch", "-q", "-c", "feature"]);
    await commit(root, { "delivered.cs": "new", "pending.cs": "new" });
    const branch = await command(root, ["rev-parse", "HEAD"]);
    await command(root, ["switch", "-q", "--detach", "origin/main"]);
    await commit(root, { "delivered.cs": "new" });
    await command(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    await command(root, ["switch", "-q", "feature"]);
    assertEquals(await command(root, ["rev-parse", "HEAD"]), branch);
    assertEquals(await new GitProbe().changedFiles(root), ["pending.cs"]);
  }));
Deno.test("GitProbe: checked-out and detached branches, absent directory and default branch", () =>
  temp(async (root) => {
    const p = new GitProbe();
    await command(root, ["init", "-q", "-b", "main"]);
    await commit(root, { "a.cs": "a" });
    await command(root, ["switch", "-q", "-c", "claude/293-push-guard"]);
    assertEquals(await p.currentBranch(root), "claude/293-push-guard");
    await command(root, ["switch", "-q", "--detach"]);
    assertEquals(await p.currentBranch(root), null);
    assertEquals(await p.currentBranch(join(root, "missing")), null);
    assertEquals(await p.defaultBranch(root), null);
    await command(root, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
    assertEquals(await p.defaultBranch(root), "main");
  }));
Deno.test("GitProbe: timestamps and absent files", () =>
  temp((root) => {
    const p = new GitProbe(), when = new Date("2026-11-05T13:38:22Z"), path = join(root, "openapi.json");
    Deno.writeTextFileSync(path, "{}");
    Deno.utimeSync(path, when, when);
    assertEquals(p.lastWriteTimeUtc(root, "openapi.json"), when.getTime());
    assertEquals(p.lastWriteTimeUtc(root, "missing.json"), null);
  }));
Deno.test("GitProbe: missing, text, empty, exact limit, oversized and binary reads", () =>
  temp((root) => {
    const p = new GitProbe();
    Deno.writeTextFileSync(join(root, "body.md"), "hello");
    assertEquals(p.readFile(root, "body.md"), "hello");
    assertEquals(p.readFile(root, "missing.md"), null);
    Deno.writeTextFileSync(join(root, "empty.md"), "");
    Deno.writeTextFileSync(join(root, "limit.md"), "a".repeat(maxTextFileBytes));
    Deno.writeTextFileSync(join(root, "big.md"), "a".repeat(maxTextFileBytes) + "/home/me/x");
    Deno.writeFileSync(join(root, "asset.bin"), new Uint8Array([127, 69, 76, 70, 0, 47, 116, 109, 112]));
    assertEquals(p.readFile(root, "empty.md"), "");
    assertEquals(p.readFile(root, "limit.md")?.length, maxTextFileBytes);
    assertEquals(p.readFile(root, "big.md"), "");
    assertEquals(p.readFile(root, "asset.bin"), "");
  }));
Deno.test("GitProbe: named pipe reads empty without opening or waiting", () =>
  temp(async (root) => {
    assertEquals((await runCommand("mkfifo", [join(root, "body.fifo")], root, 5000))?.exitCode, 0);
    const start = performance.now();
    assertEquals(new GitProbe().readFile(root, "body.fifo"), "");
    assert(performance.now() - start < 1000);
  }));
Deno.test("GitProbe: real unstaged query, path existence and untracked files", () =>
  temp(async (root) => {
    await command(root, ["init", "-q", "-b", "main"]);
    await commit(root, { "a.ts": "old" });
    const p = new GitProbe();
    assertEquals(await p.hasUnstagedChanges(root, ["a.ts"]), false);
    Deno.writeTextFileSync(join(root, "a.ts"), "new");
    assertEquals(await p.hasUnstagedChanges(root, ["a.ts"]), true);
    assertEquals(p.pathExists(root, "a.ts"), true);
    assertEquals(p.pathExists(root, "missing"), false);
    Deno.writeTextFileSync(join(root, "new.ts"), "new");
    assertEquals(await p.changedFiles(root), ["a.ts", "new.ts"]);
  }));
Deno.test("ExternalCommand: literal arguments never evaluated by a shell", () =>
  temp(async (root) => {
    const value = "$(touch marker); `touch marker`";
    const r = await runCommand("printf", ["%s", value], root, 5000);
    assertStringIncludes(r?.stdout ?? "", value);
    assertEquals(new GitProbe().pathExists(root, "marker"), false);
  }));
