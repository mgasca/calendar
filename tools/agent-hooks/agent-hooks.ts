#!/usr/bin/env -S deno run --no-prompt --frozen --allow-read --allow-run --allow-env
// Claude Code hooks (ADR-0042/0044). Each command reads hook JSON on stdin.
// pre-bash: protect unstaged work, public posts, merged branches and shared databases; note PR links.
// pre-edit: protect generated files. post-edit: Deno format guidance for tooling TypeScript.
// stop: stale-contract protection, once. warm: SessionStart Deno version report.
// Exit 0: JSON decision/context or pass; exit 2: usage/JSON error. Other failures are non-blocking.
import { GitProbe } from "./git-probe.ts";
import { runHook, subcommands } from "./hook-runner.ts";
if (import.meta.main) {
  if (Deno.args.length !== 1) {
    console.error(`usage: agent-hooks <${subcommands.join("|")}>`);
    Deno.exit(2);
  }
  const stdin = Deno.stdin.isTerminal() ? "{}" : await new Response(Deno.stdin.readable).text();
  const result = await runHook(Deno.args[0]!, stdin, new GitProbe(), Deno.version.deno);
  if (result.stdout !== undefined) console.log(result.stdout);
  if (result.stderr !== undefined) console.error(result.stderr);
  Deno.exit(result.exitCode);
}
