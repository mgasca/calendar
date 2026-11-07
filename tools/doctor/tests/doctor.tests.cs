#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.2
#:package Shouldly@4.3.0

using System.Diagnostics;
using Shouldly;
using Xunit;

namespace CalendarDoctor.Tests;

#pragma warning disable CS1591

public sealed class DoctorTests : IDisposable
{
  private readonly string _bin = Directory.CreateTempSubdirectory("doctor-tests-").FullName;

  public DoctorTests()
  {
    foreach (var command in new[] { "dirname", "tr", "sed", "sort", "head" })
    {
      File.CreateSymbolicLink(Path.Combine(_bin, command), "/usr/bin/" + command);
    }
    WriteExecutable("dotnet", "echo 10.0.403");
    WriteExecutable("node", "echo v24.0.0");
    WriteExecutable("pnpm", "exit 0");
    WriteExecutable("docker", "exit 0");
    WriteExecutable("just", "echo just 99.0.0");
  }

  private void WriteExecutable(string name, string body)
  {
    var path = Path.Combine(_bin, name);
    File.WriteAllText(path, "#!/bin/sh\n" + body + "\n");
    if (!OperatingSystem.IsWindows())
    {
      File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
    }
  }

  public void Dispose() => Directory.Delete(_bin, true);

  [Fact]
  public async Task MissingAzureCliFailsWithInstallHint()
  {
    (var code, var text) = await RunDoctor();
    code.ShouldNotBe(0);
    text.ShouldContain("Azure CLI not found");
    text.ShouldContain("Install Azure CLI");
  }

  [Theory]
  [InlineData("2.91.0", "", false, "Bicep version 'unavailable'")]
  [InlineData("0.1.0", "0.48.1", false, "Azure CLI version '0.1.0'")]
  [InlineData("2.91.0", "0.1.0", false, "Bicep version '0.1.0'")]
  [InlineData("2.91.0", "0.48.1", true, "Toolchain OK")]
  public async Task InfraVersionsAreCheckedIndependently(string azure, string bicep, bool success, string expected)
  {
    var bicepCommand = string.IsNullOrEmpty(bicep) ? "exit 1" : $"echo 'Bicep CLI version {bicep} (fake)'";
    WriteExecutable("az", $"case \"$1\" in version) echo {azure};; bicep) {bicepCommand};; esac");
    (var code, var text) = await RunDoctor();
    (code == 0).ShouldBe(success);
    text.ShouldContain(expected);
  }

  [Fact]
  public async Task MissingJustFailsWithInstallHint()
  {
    File.Delete(Path.Combine(_bin, "just"));
    (var code, var text) = await RunDoctor(infra: false);
    code.ShouldNotBe(0);
    text.ShouldContain("just not found");
    text.ShouldContain("Install just");
  }

  [Fact]
  public async Task JustOlderThanPinnedVersionFails()
  {
    WriteExecutable("just", "echo just 0.1.0");
    (var code, var text) = await RunDoctor(infra: false);
    code.ShouldNotBe(0);
    text.ShouldContain("just 0.1.0, but .just-version wants");
  }

  [Theory]
  [InlineData("10.0.114", false)]
  [InlineData("10.0.204", false)]
  [InlineData("10.0.300", true)]
  [InlineData("10.0.403", true)]
  public async Task RepoToolsNeedSdkWithIncludeDirective(string sdk, bool success)
  {
    WriteExecutable("dotnet", $"echo {sdk}");
    (var code, var text) = await RunDoctor(infra: false);
    (code == 0).ShouldBe(success);
    text.ShouldContain(success ? $".NET SDK {sdk} for repo tools" : "#:include needs 10.0.300 or later");
  }

  [Fact]
  public async Task OrdinaryDoctorDoesNotRequireAzure()
  {
    (var code, var text) = await RunDoctor(infra: false);
    code.ShouldBe(0);
    text.ShouldNotContain("Azure CLI not found");
  }

  [Theory]
  [InlineData("tools", "ci-timings")]
  [InlineData("tools", "versions")]
  [InlineData("tools", "handover-watch")]
  [InlineData("tools", "adr")]
  [InlineData("backend", "restore")]
  [InlineData("backend", "test")]
  [InlineData("db", "seed")]
  [InlineData("frontend", "test-web")]
  [InlineData("docs", "test")]
  [InlineData("infra", "migrate")]
  [InlineData("infra", "init-roles")]
  public async Task RecipesPreserveForwardedArguments(string module, string recipe)
  {
    File.Delete(Path.Combine(_bin, "just"));
    WriteExecutable("dotnet", "printf '<%s>\\n' \"$@\"");
    WriteExecutable("pnpm", "printf '<%s>\\n' \"$@\"");
    var root = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(SourcePath())!, "../../.."));
    var info = new ProcessStartInfo("just")
    {
      WorkingDirectory = root,
      RedirectStandardOutput = true,
      RedirectStandardError = true,
    };
    info.Environment["PATH"] = _bin + ":" + Environment.GetEnvironmentVariable("PATH");
    info.ArgumentList.Add(module);
    info.ArgumentList.Add(recipe);
    if (module == "infra")
    {
      info.ArgumentList.Add("staging");
    }
    info.ArgumentList.Add("--example");
    info.ArgumentList.Add("Docs site");
    info.ArgumentList.Add("literal;$HOME");
    using Process process = Process.Start(info) ?? throw new InvalidOperationException();
    var output = await process.StandardOutput.ReadToEndAsync(TestContext.Current.CancellationToken);
    var error = await process.StandardError.ReadToEndAsync(TestContext.Current.CancellationToken);
    await process.WaitForExitAsync(TestContext.Current.CancellationToken);
    process.ExitCode.ShouldBe(0, error);
    output.ShouldContain("<--example>\n<Docs site>\n<literal;$HOME>");
  }

  private static string SourcePath([System.Runtime.CompilerServices.CallerFilePath] string path = "") => path;

  private async Task<(int, string)> RunDoctor(bool infra = true)
  {
    var info = new ProcessStartInfo("/bin/bash") { RedirectStandardOutput = true, RedirectStandardError = true };
    info.ArgumentList.Add(Path.GetFullPath(Path.Combine(Path.GetDirectoryName(SourcePath())!, "../doctor.sh")));
    if (infra)
    {
      info.ArgumentList.Add("--infra");
    }
    info.Environment["PATH"] = _bin;
    using Process process = Process.Start(info) ?? throw new InvalidOperationException();
    var output = await process.StandardOutput.ReadToEndAsync();
    await process.WaitForExitAsync();
    return (process.ExitCode, output + await process.StandardError.ReadToEndAsync());
  }
}
