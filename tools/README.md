# Repo tooling

Every script in this repo is a .NET 10 *file-based app* (`dotnet run x.cs`, no project file), kept in `tools/<name>/` or in the skill folder it belongs to, with that folder's own analyzers, `.editorconfig` and xUnit tests ([ADR-0017](../docs/decisions/0017-dotnet-file-based-apps-for-repo-tooling.md)). The only exception is `tools/doctor/doctor.sh`, a bootstrap check that must run without the SDK. Don't write new tooling in Python, Node or shell. Read this page before writing or fixing a tool.

## Layout and discovery

- A tool is `tools/<name>/<name>.cs` (the entry point, with a `#!/usr/bin/env -S dotnet run` line and a usage comment), one or more `#:include`d implementation files, and `tests/<name>.tests.cs`. Copy `tools/tool-versions/` as the pattern, including `tests/Directory.Build.props`.
- `just tools test` runs every `*.tests.cs` under the `tool_dirs` list in `tools/mod.just` and `dotnet format whitespace --verify-no-changes` on each directory. `tools` is in the list, so a new `tools/<name>/` is checked automatically. A tool inside a skill folder must be added to `tool_dirs` by hand, or neither its tests nor CI validate it (the gap behind #190 and #209). After adding one, check that `just tools test` prints its test file.
- Package pins (`#:package` directives and `Directory.Build.props`) must match `backend/Directory.Packages.props`; `just tools versions` fails on drift and `just tools versions --fix` rewrites them. The first run of a tool writes `packages.lock.json` next to it: commit it. CI restores in locked mode.

## SDK and build gotchas

- `#:include` needs .NET SDK **10.0.300 or later**. On 10.0.1xx or 10.0.2xx every tool that uses it fails with `Unrecognized directive 'include'` before compiling. `just doctor` checks the SDK that `dotnet --version` resolves at the repo root; `backend/global.json` does not cover the tools.
- File-based apps default to `PublishAot=true`, so reflection-based `System.Text.Json` fails analysis. Use `JsonDocument`, `Utf8JsonWriter` or a source-generated `JsonSerializerContext` (see `tools/seed-dev/SeedPlan.cs`).
- Warnings are errors, with the same analyzers as the backend. The traps that bite most: S103 (lines over 140 characters, which nothing fixes automatically), IDE0007/IDE0008 (`var` only when the type is apparent on the right-hand side), IDE0305 (use collection expressions instead of `.ToList()` into a typed variable), CA1307 (pass a `StringComparison`), S127 (don't change a `for` loop variable in its body), S4036 (start processes by absolute path), S6966 (await the async console methods). The first `dotnet run` compiles the file and takes a few seconds; later runs are cached.

## Formatting a tool

`dotnet format` doesn't accept file-based apps. To apply code fixes, convert the tool into a scratch project inside its own directory, so its `Directory.Build.props`, `.editorconfig` and `SonarLint.xml` still apply, format that, copy the code back and keep the `#!`/`#:` header lines:

```bash
cd tools/<name> && mkdir -p .scratch && cp *.cs .scratch/ && cd .scratch && dotnet project convert <name>.cs
```

Then `dotnet format` inside `.scratch`, copy the formatted bodies back and delete `.scratch`. The whitespace check that CI runs (`dotnet format whitespace --folder --verify-no-changes <dir>`) does accept file-based apps, so run it last.

## Reporting what a tool's checks covered

A scratch build that drops the folder's `Directory.Build.props`, `.editorconfig`, `SonarLint.xml` or package settings can pass locally and fail the CI analyzers (#185). When you report verification, name the directory, the command, and whether `just tools test` discovered the tests.

## ci-timings

`tools/ci-timings/` samples how long a workflow's jobs and steps take from the runs GitHub keeps (`just tools ci-timings --job Frontend`, needs `gh auth status` to pass). Only completed, successful runs count; `--branch <name>` keeps only the runs of one branch, which is how a PR measures itself against `main`. It prints Markdown tables for a benchmark record (`docs/benchmarks/README.md`): one row per job with min, median, p90 and max, and, for each `--job`, one row per step. `CiTimings.cs` holds the parsing, the nearest-rank statistics and the rendering, which the tests cover; the entry file only calls `gh`.

## agent-hooks

`tools/agent-hooks/` is the set of Claude Code hooks wired in `.claude/settings.json` ([ADR-0042](../docs/decisions/0042-layered-agent-guidance-and-hooks.md)): it denies discarding unstaged work, public posts with private details and edits of generated files; asks before the shared database is touched from a linked worktree; and reports over-long C# lines and a stale API contract. The code is one file per guard or check (`BashGuard.cs`, `EditGuard.cs`, `LineLengthCheck.cs`, `ContractCheck.cs`), plus `ShellCommand.cs` (command splitting), `HookRunner.cs` (subcommand dispatch), `GitProbe.cs` behind `IRepoProbe.cs` (questions asked of git) and `HookProtocol.cs` (the hook JSON in and out); each tested class has a matching `tests/<Class>Tests.cs`, included by the one test app `tests/agent-hooks.tests.cs`. Each subcommand reads the hook JSON on stdin, so you can try one by hand:

```bash
printf '{"tool_name":"Bash","tool_input":{"command":"git restore AGENTS.md"},"cwd":"%s"}' "$PWD" | dotnet run tools/agent-hooks/agent-hooks.cs -- pre-bash
```

The stale-contract check at stop counts a file as changed only while it still differs from `origin/main`, so a squash-merged branch stops tripping it. It passes when `contracts/openapi.json` was written after every changed contract source (any API build regenerates it, so an unchanged contract no longer blocks every turn), and the same holds for `schema.gen.ts` against the contract; a deleted source still blocks (#254).

Exit 0 with JSON is a decision or a note; exit 2 with stderr is a usage error; any other failure (for example an SDK below 10.0.300) is non-blocking for Claude Code, and the rules in `AGENTS.md` still apply by hand. Each handler carries an `if` filter (`Bash(git *)`, `Edit(**/*.cs)`, …) so unrelated commands and edits start no process. Personal overrides go in the git-ignored `.claude/settings.local.json`. Revisit the hooks when their latency is still felt in sessions, when Claude Code documents native nested `AGENTS.md` loading (drop the `CLAUDE.md` shims), or when a rule in `AGENTS.md` is ignored repeatedly (promote it to a hook).
