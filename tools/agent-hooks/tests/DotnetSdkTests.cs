using System.Diagnostics;
using Shouldly;
using Xunit;

namespace AgentHooks.Tests;

public sealed class DotnetSdkTests
{
  [Theory]
  [InlineData("10.0.403\n", "10.0.403")]
  [InlineData("10.0.100-rc.2.25502.107\r\n", "10.0.100-rc.2.25502.107")]
  [InlineData("Welcome to .NET!\n\n10.0.403\n", "10.0.403")]
  public void Parse_takes_the_version_on_the_last_line(string output, string expected) =>
    DotnetSdk.Parse(output).ShouldBe(expected);

  [Theory]
  [InlineData("")]
  [InlineData("\n\n")]
  [InlineData("not a version")]
  [InlineData("10.0")]
  [InlineData("10.0.403.1")]
  public void Parse_rejects_output_that_is_not_an_sdk_version(string output) =>
    DotnetSdk.Parse(output).ShouldBeNull();

  [Fact]
  public void Describe_names_the_sdk_or_says_it_is_unknown()
  {
    DotnetSdk.Describe("10.0.403", "10.0.14").ShouldBe("SDK 10.0.403, runtime 10.0.14");
    DotnetSdk.Describe(null, "10.0.14").ShouldBe("SDK unknown, runtime 10.0.14");
  }

  [Fact]
  public async Task Version_is_the_sdk_that_dotnet_selects_here()
  {
    var version = await DotnetSdk.VersionAsync(DotnetSdk.Timeout);

    version.ShouldNotBeNull();
    DotnetSdk.Parse(version).ShouldBe(version);
  }

  [Fact]
  public async Task Output_is_parsed_only_from_a_command_that_succeeds()
  {
    (await DotnetSdk.RunAsync("sh", ["-c", "echo 10.0.403"], DotnetSdk.Timeout)).ShouldBe("10.0.403");
    (await DotnetSdk.RunAsync("sh", ["-c", "echo 10.0.403; exit 1"], DotnetSdk.Timeout)).ShouldBeNull();
    (await DotnetSdk.RunAsync("agent-hooks-no-such-executable", [], DotnetSdk.Timeout)).ShouldBeNull();
  }

  [Fact]
  public async Task A_command_slower_than_the_timeout_is_stopped_and_gives_null()
  {
    var clock = Stopwatch.StartNew();

    (await DotnetSdk.RunAsync("sleep", ["10"], TimeSpan.FromMilliseconds(200))).ShouldBeNull();

    clock.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(5));
  }
}
