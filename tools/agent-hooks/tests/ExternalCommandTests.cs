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
  public void Run_retries_while_the_script_is_still_open_for_writing()
  {
    // Linux refuses to exec a file that some descriptor has open for writing (ETXTBSY). A sibling process start in the
    // same test run can hold a just-written script's descriptor for a moment (#528), so the start is retried.
    if (OperatingSystem.IsWindows())
    {
      return;
    }
    var script = Path.Combine(_cwd, $"busy-{Guid.NewGuid():N}");
    File.WriteAllText(script, "#!/bin/sh\necho ran\n");
    File.SetUnixFileMode(script, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
    var writer = new FileStream(script, FileMode.Open, FileAccess.Write, FileShare.ReadWrite);
    var release = new Thread(() =>
    {
      using var gate = new ManualResetEventSlim();
      gate.Wait(300);
      writer.Dispose();
    });
    release.Start();
    try
    {
      ExternalCommand.Run(script, [], _cwd, Timeout).ShouldNotBeNull().Stdout.Trim().ShouldBe("ran");
    }
    finally
    {
      release.Join();
      File.Delete(script);
    }
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
