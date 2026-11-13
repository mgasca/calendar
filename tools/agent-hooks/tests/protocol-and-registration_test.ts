import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { describeFormat, evaluateEdit } from "../checks.ts";
import { runHook } from "../hook-runner.ts";
import { parseInput } from "../protocol.ts";
import { FakeProbe } from "./fake-probe.ts";
function input(path: string) {
  return JSON.stringify({ cwd: "/repo", tool_name: "Edit", tool_input: { file_path: path } });
}
Deno.test("Deno formatting replaces C# line-length notices only for tooling TypeScript", async () => {
  for (
    const path of ["/repo/tools/agent-hooks/checks.ts", "tools/a.ts", "/repo/.claude/skills/run-calendar/scripts/a.ts"]
  ) {
    const result = await runHook("post-edit", input(path), new FakeProbe(), "2.9.8");
    assertEquals(result.exitCode, 0);
    const output = JSON.parse(result.stdout!);
    assertEquals(output.hookSpecificOutput.hookEventName, "PostToolUse");
    assertStringIncludes(output.hookSpecificOutput.additionalContext, "deno fmt");
    assertEquals(output.hookSpecificOutput.permissionDecision, undefined);
  }
  for (
    const path of [
      "/repo/a/B.cs",
      "/repo/x/Migrations/20260101_Init.cs",
      "/repo/a/b.ts",
      "/repo/frontend/apps/web/a.ts",
      "tools/a.rs",
    ]
  ) {
    assertEquals(describeFormat(path), null);
    assertEquals(await runHook("post-edit", input(path), new FakeProbe(), "2.9.8"), { exitCode: 0 });
  }
  assertEquals(await runHook("post-edit", "{}", new FakeProbe(), "2.9.8"), { exitCode: 0 });
});
Deno.test("SessionStart reports the active Deno runtime with the compatible warm command", async () => {
  const result = await runHook("warm", '{"hook_event_name":"SessionStart"}', new FakeProbe(), "2.9.8");
  assertEquals(result, {
    exitCode: 0,
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "agent-hooks active (tools/agent-hooks, Deno 2.9.8).",
      },
    }),
  });
});
Deno.test("New Deno locks and existing generated files remain guarded", () => {
  for (
    const path of ["/repo/tools/deno.lock", "/repo/.claude/skills/run-calendar/deno.lock", "C:\\repo\\tools\\deno.lock"]
  ) {
    assertEquals(evaluateEdit(path)?.decision, "deny");
    assertStringIncludes(evaluateEdit(path)?.reason ?? "", "deno install --frozen=false");
  }
});
Deno.test("Malformed JSON, bad root shapes, missing fields, unknown commands and stop reentry", async () => {
  const p = new FakeProbe();
  for (const json of ["not json", "[]", "null", "true", '"string"']) {
    const result = await runHook("pre-bash", json, p, "2.9.8");
    assertEquals(result.exitCode, 2);
    assertStringIncludes(result.stderr!, "stdin is not the hook JSON");
  }
  assertEquals((await runHook("dance", "{}", p, "2.9.8")).exitCode, 2);
  assertStringIncludes((await runHook("pre-edit", "{}", p, "2.9.8")).stderr!, "letting it through");
  assertEquals(parseInput('{"tool_input":{"command":3,"file_path":false},"stop_hook_active":"true"}').command, null);
  assertEquals(parseInput("{}").cwd, Deno.cwd());
  assertEquals(await runHook("stop", '{"stop_hook_active":true}', p, "2.9.8"), { exitCode: 0 });
});
Deno.test("Hook registrations switch atomically with frozen config and explicit noninteractive permissions", () => {
  const settings = JSON.parse(Deno.readTextFileSync(new URL("../../../.claude/settings.json", import.meta.url)));
  const commands: string[] = [];
  const graphify: string[] = [];
  for (const entries of Object.values(settings.hooks) as { hooks: { command: string; if?: string }[] }[][]) {
    for (const entry of entries) {
      for (const hook of entry.hooks) {
        // `graphify install` writes these hooks (story 0062), so they are not Deno hooks; they are checked below.
        if (hook.command.includes("graphify")) {
          graphify.push(hook.command);
          continue;
        }
        commands.push(hook.command);
        assertStringIncludes(hook.command, "deno run");
        assertStringIncludes(hook.command, "--frozen");
        assertStringIncludes(hook.command, "--no-prompt");
        assertStringIncludes(hook.command, '--config "$CLAUDE_PROJECT_DIR/tools/deno.json"');
        assertStringIncludes(hook.command, '"$CLAUDE_PROJECT_DIR/tools/agent-hooks/agent-hooks.ts"');
        assert(!hook.command.includes("dotnet"));
        assert(!hook.command.includes("--allow-all"));
      }
    }
  }
  assert(commands.length > 10);
  // Exactly the three graphify hooks, each guarded so that it does nothing where the program is not installed and
  // otherwise keeps its exit code, which is what blocks a call (story 0062, issue #702).
  const guarded = (mode: string) => `command -v graphify >/dev/null 2>&1 || exit 0; graphify hook-guard ${mode}`;
  assertEquals([...graphify].sort(), ["compact", "read", "search"].map(guarded));
  const edits = settings.hooks.PreToolUse.find((e: { matcher: string }) => e.matcher === "Edit|Write").hooks;
  for (
    const pattern of [
      "Edit(**/openapi.json)",
      "Edit(**/schema.gen.ts)",
      "Edit(**/packages.lock.json)",
      "Edit(**/pnpm-lock.yaml)",
      "Edit(**/deno.lock)",
    ]
  ) assert(edits.some((e: { if: string }) => e.if === pattern));
  const bash = settings.hooks.PreToolUse.find((e: { matcher: string }) => e.matcher === "Bash").hooks;
  for (const name of ["git", "gh", "just", "docker", "env", "sudo", "exec", "builtin", "command"]) {
    assert(bash.some((e: { if: string }) => e.if === `Bash(${name} *)`));
  }
});
Deno.test("CLI arguments, valid JSON stdout and malformed-input exits with the actual runtime", async () => {
  const entry = new URL("../agent-hooks.ts", import.meta.url).pathname;
  const config = new URL("../../deno.json", import.meta.url).pathname;
  async function run(args: string[], stdin: string) {
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--config",
        config,
        "--frozen",
        "--no-prompt",
        "--allow-read",
        "--allow-run",
        "--allow-env",
        entry,
        ...args,
      ],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(stdin));
    await writer.close();
    const output = await child.output();
    return {
      code: output.code,
      stdout: new TextDecoder().decode(output.stdout),
      stderr: new TextDecoder().decode(output.stderr),
    };
  }
  for (const args of [[], ["warm", "extra"], ["dance"]]) {
    const r = await run(args, "{}");
    assertEquals(r.code, 2);
    assertEquals(r.stdout, "");
  }
  const malformed = await run(["pre-bash"], "invalid");
  assertEquals(malformed.code, 2);
  assertStringIncludes(malformed.stderr, "stdin is not the hook JSON");
  const warm = await run(["warm"], "{}");
  assertEquals(warm.code, 0);
  assertEquals(warm.stderr, "");
  assertStringIncludes(JSON.parse(warm.stdout).hookSpecificOutput.additionalContext, `Deno ${Deno.version.deno}`);
  const deny = await run(["pre-edit"], input("/repo/tools/deno.lock"));
  assertEquals(deny.code, 0);
  assertEquals(JSON.parse(deny.stdout).hookSpecificOutput.permissionDecision, "deny");
});
