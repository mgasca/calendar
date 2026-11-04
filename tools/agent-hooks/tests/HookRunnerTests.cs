using System.Text.Json;
using Shouldly;
using Xunit;

namespace AgentHooks.Tests;

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
    HookResult ask = HookRunner.Run("pre-bash", Json("Bash", "command", "just db reset"), _probe, "10.0.0");
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
