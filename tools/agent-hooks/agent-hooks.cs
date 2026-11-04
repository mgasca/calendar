#!/usr/bin/env -S dotnet run
#:include HookProtocol.cs
#:include IRepoProbe.cs
#:include ShellCommand.cs
#:include BashGuard.cs
#:include EditGuard.cs
#:include LineLengthCheck.cs
#:include ContractCheck.cs
#:include HookRunner.cs
#:include GitProbe.cs
#:include DotnetSdk.cs

// Claude Code hooks for this repo (ADR-0042), wired up in .claude/settings.json. Each run handles one event:
// it reads the hook JSON on stdin and answers on stdout, as https://code.claude.com/docs/en/hooks describes.
//
//   dotnet run tools/agent-hooks/agent-hooks.cs -- pre-bash    PreToolUse Bash (git, gh, just, docker): deny discarding
//                                                               unstaged work and public posts with private details; ask
//                                                               before the shared database is touched from a worktree
//   dotnet run tools/agent-hooks/agent-hooks.cs -- pre-edit    PreToolUse Edit|Write: deny edits of generated files
//   dotnet run tools/agent-hooks/agent-hooks.cs -- post-edit   PostToolUse Edit|Write: report C# lines over 140 chars
//   dotnet run tools/agent-hooks/agent-hooks.cs -- stop        Stop: keep going once if the API contract looks stale
//   dotnet run tools/agent-hooks/agent-hooks.cs -- warm        SessionStart: compile the tool, name the SDK and runtime
//
// Exit 0 with JSON is a decision or a note; exit 2 with stderr is a usage error. Claude Code treats any other
// failure (for example an SDK below 10.0.300, which rejects #:include) as non-blocking, so the rules in
// AGENTS.md still apply by hand.

using AgentHooks;

if (args.Length != 1)
{
  await Console.Error.WriteLineAsync($"usage: agent-hooks <{string.Join('|', HookRunner.Subcommands)}>");
  return 2;
}

var stdin = Console.IsInputRedirected ? await Console.In.ReadToEndAsync() : "{}";
// Only the session-start line names the SDK, so only warm pays for `dotnet --version` (about 0.2 s, once a session).
var sdk = args[0] == "warm" ? await DotnetSdk.VersionAsync(DotnetSdk.Timeout) : null;
HookResult result = HookRunner.Run(args[0], stdin, new GitProbe(), DotnetSdk.Describe(sdk, Environment.Version.ToString()));
if (result.Stdout is not null)
{
  await Console.Out.WriteLineAsync(result.Stdout);
}
if (result.Stderr is not null)
{
  await Console.Error.WriteLineAsync(result.Stderr);
}
return result.ExitCode;
