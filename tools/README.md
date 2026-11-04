# Repo tooling

Every script in this repo is a .NET 10 *file-based app* (`dotnet run x.cs`, no project file), kept in `tools/<name>/` or in the skill folder it belongs to, with that folder's own analyzers, `.editorconfig` and xUnit tests ([ADR-0017](../docs/decisions/0017-dotnet-file-based-apps-for-repo-tooling.md)). The only exception is `tools/doctor/doctor.sh`, a bootstrap check that must run without the SDK. Don't write new tooling in Python, Node or shell. Read this page before writing or fixing a tool.

## Layout and discovery

- A tool is `tools/<name>/<name>.cs` (the entry point, with a `#!/usr/bin/env -S dotnet run` line and a usage comment), one or more `#:include`d implementation files, and `tests/<name>.tests.cs`. Copy `tools/tool-versions/` as the pattern, including `tests/Directory.Build.props`.
- `just tooling` runs every `*.tests.cs` under the `tool_dirs` list in the justfile and `dotnet format whitespace --verify-no-changes` on each directory. `tools` is in the list, so a new `tools/<name>/` is checked automatically. A tool inside a skill folder must be added to `tool_dirs` by hand, or neither its tests nor CI validate it (the gap behind #190 and #209). After adding one, check that `just tooling` prints its test file.
- Package pins (`#:package` directives and `Directory.Build.props`) must match `backend/Directory.Packages.props`; `just tool-versions` fails on drift and `just tool-versions --fix` rewrites them. The first run of a tool writes `packages.lock.json` next to it: commit it. CI restores in locked mode.

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

A scratch build that drops the folder's `Directory.Build.props`, `.editorconfig`, `SonarLint.xml` or package settings can pass locally and fail the CI analyzers (#185). When you report verification, name the directory, the command, and whether `just tooling` discovered the tests.

## agent-hooks

`tools/agent-hooks/` is the set of Claude Code hooks wired in `.claude/settings.json` ([ADR-0042](../docs/decisions/0042-layered-agent-guidance-and-hooks.md)): it denies discarding unstaged work, bare stashes, public posts with private details and edits of generated files; asks before the shared database is touched from a linked worktree; and reports over-long C# lines and a stale API contract. Each subcommand reads the hook JSON on stdin, so you can try one by hand:

```bash
printf '{"tool_name":"Bash","tool_input":{"command":"git restore AGENTS.md"},"cwd":"%s"}' "$PWD" | dotnet run tools/agent-hooks/agent-hooks.cs -- pre-bash
```

Exit 0 with JSON is a decision or a note; exit 2 with stderr is a usage error; any other failure (for example an SDK below 10.0.300) is non-blocking for Claude Code, and the rules in `AGENTS.md` still apply by hand. Personal overrides go in the git-ignored `.claude/settings.local.json`. Revisit the hooks when their latency is felt in sessions (add `if` argument filters), when Claude Code documents native nested `AGENTS.md` loading (drop the `CLAUDE.md` shims), or when a rule in `AGENTS.md` is ignored repeatedly (promote it to a hook).
