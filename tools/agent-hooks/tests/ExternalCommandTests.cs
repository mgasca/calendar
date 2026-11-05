using System.Diagnostics;
using Shouldly;
using Xunit;

namespace AgentHooks.Tests;

public sealed class ExternalCommandTests
{
  private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);
  private readonly string _cwd = Path.GetTempPath();

  [Fact]
  public void Run_returns_the_exit_code_and_standard_output_only()
  {
    ExternalCommand.Output output = ExternalCommand.Run("sh", ["-c", "echo out; echo err >&2; exit 3"], _cwd, Timeout)
      .ShouldNotBeNull();

    output.ExitCode.ShouldBe(3);
    output.Stdout.ShouldBe("out" + Environment.NewLine);
  }

  [Fact]
  public void Run_closes_stdin_and_sets_the_environment()
  {
    Dictionary<string, string> environment = new(StringComparer.Ordinal) { ["AGENT_HOOKS_TEST"] = "set" };

    ExternalCommand.Output output = ExternalCommand.Run(
      "sh", ["-c", "cat; echo \"$AGENT_HOOKS_TEST\""], _cwd, Timeout, environment).ShouldNotBeNull();

    output.Stdout.Trim().ShouldBe("set");
  }

  [Fact]
  public void Run_is_null_for_a_missing_executable_or_directory()
  {
    ExternalCommand.Run("agent-hooks-no-such-executable", [], _cwd, Timeout).ShouldBeNull();
    ExternalCommand.Run("sh", ["-c", "true"], Path.Combine(_cwd, $"missing-{Guid.NewGuid():N}"), Timeout).ShouldBeNull();
  }

  [Fact]
  public void Run_stops_a_command_slower_than_the_timeout()
  {
    var clock = Stopwatch.StartNew();

    ExternalCommand.Run("sleep", ["10"], _cwd, TimeSpan.FromMilliseconds(200)).ShouldBeNull();

    clock.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(5));
  }

  [Fact]
  public void OnPath_resolves_a_name_and_keeps_an_absolute_path()
  {
    Path.IsPathRooted(ExternalCommand.OnPath("sh")).ShouldBeTrue();
    ExternalCommand.OnPath("/bin/sh").ShouldBe("/bin/sh");
    ExternalCommand.OnPath("agent-hooks-no-such-executable").ShouldBe("agent-hooks-no-such-executable");
  }
}
