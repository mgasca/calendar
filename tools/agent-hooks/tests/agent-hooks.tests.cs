#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.2
#:package Shouldly@4.3.0
#:include ../Hooks.cs

// Tests for the Claude Code hooks. Run: dotnet run tools/agent-hooks/tests/agent-hooks.tests.cs
// Each hook decision branch gets sample stdin JSON and a fake repository probe; the exit code and JSON are asserted.

using System.Text.Json;
using Shouldly;
using Xunit;

namespace AgentHooks.Tests;

/// <summary>A probe with scripted answers; records the questions it was asked.</summary>
internal sealed class FakeProbe : IRepoProbe
{
  public HashSet<string> Dirty { get; } = new(StringComparer.Ordinal);

  public HashSet<string> Existing { get; } = new(StringComparer.Ordinal);

  public Dictionary<string, string> Files { get; } = new(StringComparer.Ordinal);

  public List<string> Changed { get; } = [];

  public bool LinkedWorktree { get; set; }

  public List<(string Cwd, IReadOnlyList<string> Paths)> UnstagedQueries { get; } = [];

  public bool HasUnstagedChanges(string cwd, IReadOnlyList<string> paths)
  {
    UnstagedQueries.Add((cwd, paths));
    return paths.Select(p => Path.GetFullPath(Path.Combine(cwd, p)))
      .Any(full => Dirty.Any(d => d == full || d.StartsWith(full + "/", StringComparison.Ordinal)));
  }

  public bool PathExists(string cwd, string path) => Existing.Contains(path);

  public bool IsLinkedWorktree(string cwd) => LinkedWorktree;

  public string? ReadFile(string cwd, string path) => Files.TryGetValue(path, out var text) ? text : null;

  public IReadOnlyList<string> ChangedFiles(string cwd) => Changed;
}

public sealed class BashGuardTests
{
  private const string Root = "/repo";
  private readonly FakeProbe _probe = new();

  [Theory]
  [InlineData("git restore AGENTS.md")]
  [InlineData("git restore -SW AGENTS.md")]
  [InlineData("git restore --worktree --staged AGENTS.md")]
  [InlineData("git checkout -- AGENTS.md")]
  [InlineData("git checkout AGENTS.md")]
  [InlineData("git checkout -- .")]
  [InlineData("echo x && git restore AGENTS.md")]
  public void Discarding_unstaged_changes_is_denied(string command)
  {
    _probe.Dirty.Add("/repo/AGENTS.md");
    _probe.Existing.Add("AGENTS.md");

    Verdict verdict = BashGuard.Evaluate(command, Root, _probe).ShouldNotBeNull();

    verdict.Decision.ShouldBe("deny");
    verdict.Reason.ShouldContain("Save the patch");
  }

  [Theory]
  [InlineData("git restore AGENTS.md")]
  [InlineData("git restore --staged AGENTS.md")]
  [InlineData("git restore -S AGENTS.md")]
  [InlineData("git checkout main")]
  [InlineData("git checkout -b feature")]
  [InlineData("git status")]
  [InlineData("git diff -- AGENTS.md")]
  public void Clean_paths_branches_and_other_git_commands_pass(string command)
  {
    _probe.Dirty.Add("/repo/README.md");

    BashGuard.Evaluate(command, Root, _probe).ShouldBeNull();
  }

  [Fact]
  public void Restore_after_cd_probes_the_path_relative_to_the_new_directory()
  {
    _probe.Dirty.Add("/repo/backend/src/X.cs");

    Verdict verdict = BashGuard.Evaluate("cd backend && git restore src/X.cs", Root, _probe).ShouldNotBeNull();

    verdict.Decision.ShouldBe("deny");
    (var cwd, IReadOnlyList<string> paths) = _probe.UnstagedQueries.ShouldHaveSingleItem();
    cwd.ShouldBe("/repo/backend");
    paths.ShouldBe(["src/X.cs"]);
  }

  [Theory]
  [InlineData("gh pr create --title t --body \"see /home/me/repo/x.md\"", "/home/me/repo/x.md")]
  [InlineData("gh issue comment 1 --body 'logs in /tmp/claude/out.txt'", "/tmp/claude/out.txt")]
  [InlineData("gh pr comment 2 --body 'C:\\Users\\me\\repo'", "C:\\Users\\me\\repo")]
  [InlineData("gh pr edit 3 --body 'from .claude/worktrees/task-1/'", ".claude/worktrees/task-1/")]
  [InlineData("gh pr review 4 --comment --body 'agent-ab12cd34ef'", "agent-ab12cd34ef")]
  [InlineData(
    "gh api repos/o/r/issues/1/comments -f body='id 12345678-1234-1234-1234-123456789abc'",
    "12345678-1234-1234-1234-123456789abc")]
  public void Public_posts_with_private_details_are_denied(string command, string expectedHit)
  {
    Verdict verdict = BashGuard.Evaluate(command, Root, _probe).ShouldNotBeNull();

    verdict.Decision.ShouldBe("deny");
    verdict.Reason.ShouldContain(expectedHit);
  }

  [Theory]
  [InlineData("gh pr create --title t --body 'see docs/stories/0020.md and https://github.com/mgasca/calendar/pull/1'")]
  [InlineData("gh pr view 1 --json files")]
  [InlineData("gh issue list --limit 50")]
  [InlineData("gh api repos/o/r/pulls/1")]
  public void Clean_posts_and_read_only_gh_commands_pass(string command) =>
    BashGuard.Evaluate(command, Root, _probe).ShouldBeNull();

  [Fact]
  public void Body_file_contents_are_scanned_and_its_path_is_not()
  {
    _probe.Files["/tmp/body.md"] = "Refs #216, see docs/stories/0020.md";
    BashGuard.Evaluate("gh issue comment 1 --body-file /tmp/body.md", Root, _probe).ShouldBeNull();

    _probe.Files["/tmp/body.md"] = "ran from /home/me/repo";
    Verdict verdict = BashGuard.Evaluate("gh issue comment 1 --body-file /tmp/body.md", Root, _probe).ShouldNotBeNull();
    verdict.Reason.ShouldContain("/home/me/repo");
  }

  [Theory]
  [InlineData("just db-migrate")]
  [InlineData("just db-up db-migrate")]
  [InlineData("just db-reset")]
  [InlineData("docker compose down -v")]
  public void Shared_database_from_a_linked_worktree_asks(string command)
  {
    _probe.LinkedWorktree = true;

    Verdict verdict = BashGuard.Evaluate(command, Root, _probe).ShouldNotBeNull();

    verdict.Decision.ShouldBe("ask");
    verdict.Reason.ShouldContain("run-calendar");
  }

  [Theory]
  [InlineData("just db-migrate", true)]
  [InlineData("just db-migrate", false)]
  [InlineData("just db-seed --api-url http://localhost:55041", true)]
  [InlineData("docker run -d --rm --name calendar-agent-db postgres", true)]
  [InlineData("just test", true)]
  public void Shared_database_passes_from_the_main_checkout_and_isolated_commands_pass_anywhere(string command, bool linked)
  {
    _probe.LinkedWorktree = linked;

    Verdict? verdict = BashGuard.Evaluate(command, Root, _probe);

    if (command == "just db-migrate" && linked)
    {
      verdict.ShouldNotBeNull();
    }
    else
    {
      verdict.ShouldBeNull();
    }
  }
}

public sealed class ShellCommandTests
{
  [Fact]
  public void Split_tracks_cd_and_separators()
  {
    IReadOnlyList<ShellCommand.Segment> segments = ShellCommand.Split("cd backend && dotnet build; git status | head -1\ngit log", "/repo");

    segments.Select(s => s.Tokens[0]).ShouldBe(["dotnet", "git", "head", "git"]);
    segments.Select(s => s.Cwd).ShouldAllBe(c => c == "/repo/backend");
  }

  [Fact]
  public void Tokenize_honours_quotes() =>
    ShellCommand.Tokenize("gh pr create --body \"a b && c\" -t 'x y'").ShouldBe(["gh", "pr", "create", "--body", "a b && c", "-t", "x y"]);
}

public sealed class EditGuardTests
{
  [Theory]
  [InlineData("/repo/contracts/openapi.json")]
  [InlineData("/repo/frontend/packages/api-client/src/schema.gen.ts")]
  [InlineData("/repo/backend/src/Calendar.Api/packages.lock.json")]
  [InlineData("/repo/frontend/pnpm-lock.yaml")]
  public void Generated_files_are_denied(string path)
  {
    Verdict verdict = EditGuard.Evaluate(path).ShouldNotBeNull();

    verdict.Decision.ShouldBe("deny");
    verdict.Reason.ShouldContain("generated");
  }

  [Theory]
  [InlineData("/repo/backend/src/Calendar.Api/Program.cs")]
  [InlineData("/repo/contracts/README.md")]
  [InlineData("/repo/frontend/packages/api-client/src/index.ts")]
  public void Source_files_pass(string path) =>
    EditGuard.Evaluate(path).ShouldBeNull();
}

public sealed class LineLengthCheckTests
{
  private static readonly string Long = new('x', LineLengthCheck.MaximumLineLength + 10);
  private static readonly string Exact = new('x', LineLengthCheck.MaximumLineLength);

  [Fact]
  public void Long_cs_lines_are_listed_by_number()
  {
    LineLengthCheck.LongLines("/repo/a/B.cs", $"ok\n{Long}\n{Exact}\n{Long}\r\n").ShouldBe([2, 4]);
    (LineLengthCheck.Describe("/repo/a/B.cs", $"{Long}\n") ?? string.Empty).ShouldContain("B.cs: line(s) 1 exceed 140");
  }

  [Theory]
  [InlineData("/repo/a/B.cs")]
  [InlineData("/repo/x/Migrations/20260101_Init.cs")]
  [InlineData("/repo/a/b.ts")]
  public void Exact_limit_migrations_and_other_languages_produce_nothing(string path)
  {
    var content = path.EndsWith("B.cs", StringComparison.Ordinal) ? $"{Exact}\n" : $"{Long}\n";

    LineLengthCheck.LongLines(path, content).ShouldBeEmpty();
    LineLengthCheck.Describe(path, content).ShouldBeNull();
  }
}

public sealed class ContractCheckTests
{
  [Theory]
  [InlineData("backend/src/Calendar.Api/Endpoints/TaskEndpoints.cs")]
  [InlineData("backend/src/Calendar.Api/Contracts/TaskResponse.cs")]
  [InlineData("backend/src/Calendar.Api/Program.cs")]
  public void Changed_contract_sources_without_the_contract_block(string source) =>
    (ContractCheck.Evaluate([source]) ?? string.Empty).ShouldContain("just contracts");

  [Fact]
  public void Changed_contract_without_the_client_blocks() =>
    (ContractCheck.Evaluate(["backend/src/Calendar.Api/Endpoints/TaskEndpoints.cs", "contracts/openapi.json"]) ?? string.Empty)
      .ShouldContain("schema.gen.ts");

  [Fact]
  public void Sources_contract_and_client_together_pass_and_domain_changes_pass()
  {
    ContractCheck.Evaluate(
      [
        "backend/src/Calendar.Api/Endpoints/TaskEndpoints.cs",
        "contracts/openapi.json",
        "frontend/packages/api-client/src/schema.gen.ts",
      ]).ShouldBeNull();
    ContractCheck.Evaluate(["backend/src/Calendar.Domain/Agenda/DayInclusion.cs"]).ShouldBeNull();
    ContractCheck.Evaluate([]).ShouldBeNull();
  }
}

public sealed class HookRunnerTests
{
  private readonly FakeProbe _probe = new();

  private static string Json(string toolName, string key, string value, string cwd = "/repo") =>
    $$$"""
    {"session_id":"s","cwd":"{{{cwd}}}","hook_event_name":"X","tool_name":"{{{toolName}}}",
     "tool_input":{"{{{key}}}":"{{{JsonEncodedText.Encode(value)}}}"}}
    """;

  [Fact]
  public void Pre_bash_deny_is_pretooluse_json_with_exit_0()
  {
    _probe.Dirty.Add("/repo/AGENTS.md");

    HookResult result = HookRunner.Run("pre-bash", Json("Bash", "command", "git restore AGENTS.md"), _probe, "10.0.0");

    result.ExitCode.ShouldBe(0);
    JsonElement output = JsonDocument.Parse(result.Stdout!).RootElement.GetProperty("hookSpecificOutput");
    output.GetProperty("hookEventName").GetString().ShouldBe("PreToolUse");
    output.GetProperty("permissionDecision").GetString().ShouldBe("deny");
    (output.GetProperty("permissionDecisionReason").GetString() ?? string.Empty).ShouldContain("AGENTS.md");
  }

  [Fact]
  public void Pre_bash_ask_and_pass()
  {
    _probe.LinkedWorktree = true;
    HookResult ask = HookRunner.Run("pre-bash", Json("Bash", "command", "just db-reset"), _probe, "10.0.0");
    (ask.Stdout ?? string.Empty).ShouldContain("\"permissionDecision\":\"ask\"");

    HookResult pass = HookRunner.Run("pre-bash", Json("Bash", "command", "just test"), _probe, "10.0.0");
    pass.ShouldBe(HookResult.Pass);
  }

  [Fact]
  public void Pre_edit_denies_generated_files_and_passes_sources()
  {
    HookResult deny = HookRunner.Run("pre-edit", Json("Edit", "file_path", "/repo/contracts/openapi.json"), _probe, "10.0.0");
    (deny.Stdout ?? string.Empty).ShouldContain("\"permissionDecision\":\"deny\"");
    HookRunner.Run("pre-edit", Json("Write", "file_path", "/repo/AGENTS.md"), _probe, "10.0.0").ShouldBe(HookResult.Pass);
  }

  [Fact]
  public void Post_edit_reports_long_lines_as_context()
  {
    _probe.Files["/repo/a/B.cs"] = new string('x', 150) + "\n";

    HookResult result = HookRunner.Run("post-edit", Json("Edit", "file_path", "/repo/a/B.cs"), _probe, "10.0.0");

    result.ExitCode.ShouldBe(0);
    JsonElement output = JsonDocument.Parse(result.Stdout!).RootElement.GetProperty("hookSpecificOutput");
    output.GetProperty("hookEventName").GetString().ShouldBe("PostToolUse");
    (output.GetProperty("additionalContext").GetString() ?? string.Empty).ShouldContain("line(s) 1");
  }

  [Fact]
  public void Stop_blocks_once_then_respects_stop_hook_active()
  {
    _probe.Changed.Add("backend/src/Calendar.Api/Endpoints/TaskEndpoints.cs");

    HookResult first = HookRunner.Run("stop", """{"cwd":"/repo","hook_event_name":"Stop","stop_hook_active":false}""", _probe, "10.0.0");
    HookResult second = HookRunner.Run("stop", """{"cwd":"/repo","hook_event_name":"Stop","stop_hook_active":true}""", _probe, "10.0.0");

    JsonElement output = JsonDocument.Parse(first.Stdout!).RootElement;
    output.GetProperty("decision").GetString().ShouldBe("block");
    (output.GetProperty("reason").GetString() ?? string.Empty).ShouldContain("just contracts");
    second.ShouldBe(HookResult.Pass);
  }

  [Fact]
  public void Warm_adds_session_context()
  {
    HookResult result = HookRunner.Run("warm", """{"hook_event_name":"SessionStart"}""", _probe, "10.0.403");

    result.ExitCode.ShouldBe(0);
    (result.Stdout ?? string.Empty).ShouldContain("10.0.403");
  }

  [Fact]
  public void Malformed_json_and_unknown_subcommands_exit_2()
  {
    HookRunner.Run("pre-bash", "not json", _probe, "10.0.0").ExitCode.ShouldBe(2);
    (HookRunner.Run("pre-bash", "not json", _probe, "10.0.0").Stderr ?? string.Empty).ShouldContain("stdin");
    HookRunner.Run("dance", "{}", _probe, "10.0.0").ExitCode.ShouldBe(2);
  }

  [Fact]
  public void Missing_tool_input_passes_with_a_stderr_note()
  {
    HookResult result = HookRunner.Run("pre-bash", """{"cwd":"/repo","tool_name":"Bash"}""", _probe, "10.0.0");

    result.ExitCode.ShouldBe(0);
    result.Stdout.ShouldBeNull();
    (result.Stderr ?? string.Empty).ShouldContain("letting it through");
  }
}

public sealed class GitProbeTests : IDisposable
{
  private readonly string _root = Directory.CreateTempSubdirectory("agent-hooks-").FullName;

  public void Dispose() => Directory.Delete(_root, recursive: true);

  [Fact]
  public void Linked_worktree_is_detected_from_a_git_file_but_not_a_git_directory()
  {
    var probe = new GitProbe();
    var nested = Path.Combine(_root, "a", "b");
    Directory.CreateDirectory(nested);

    probe.IsLinkedWorktree(nested).ShouldBeFalse();

    Directory.CreateDirectory(Path.Combine(_root, ".git"));
    probe.IsLinkedWorktree(nested).ShouldBeFalse();

    Directory.Delete(Path.Combine(_root, ".git"));
    File.WriteAllText(Path.Combine(_root, ".git"), "gitdir: elsewhere\n");
    probe.IsLinkedWorktree(nested).ShouldBeTrue();
  }

  [Fact]
  public void ReadFile_returns_null_for_a_missing_file()
  {
    var probe = new GitProbe();
    File.WriteAllText(Path.Combine(_root, "body.md"), "hello");

    probe.ReadFile(_root, "body.md").ShouldBe("hello");
    probe.ReadFile(_root, "missing.md").ShouldBeNull();
  }
}
