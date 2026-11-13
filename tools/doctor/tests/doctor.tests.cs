#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.3
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
    WriteExecutable("deno", "echo deno " + PinnedDeno());
    WriteExecutable("cargo", "echo cargo " + PinnedRust());
    WriteExecutable("rustc", "echo \"rustc " + PinnedRust() + " (0000000 2026-01-01)\"");
    WriteExecutable("cc", "exit 0");
    WriteExecutable("node", "echo v24.0.0");
    WriteExecutable("pnpm", "exit 0");
    WriteExecutable("docker", "exit 0");
    WriteExecutable("just", "echo just 99.0.0");
    WriteExecutable("gh", "echo 'gh version 2.0.0 (fake)'");
    WriteExecutable("jq", "echo jq-1.7");
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

  [Theory]
  [InlineData("gh", "Install the GitHub CLI")]
  [InlineData("jq", "Install jq")]
  public async Task MissingGhOrJqFailsWithInstallHint(string tool, string hint)
  {
    File.Delete(Path.Combine(_bin, tool));
    (var code, var text) = await RunDoctor(infra: false);
    code.ShouldNotBe(0);
    text.ShouldContain($"{tool} not found");
    text.ShouldContain(hint);
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
  [InlineData(true)]
  [InlineData(false)]
  public async Task RepoToolsNeedTheSdkThatGlobalJsonPinsAtTheRoot(bool success)
  {
    // The real dotnet fails `--version` where no installed SDK satisfies the nearest global.json.
    WriteExecutable("dotnet", success
      ? "echo 10.0.404"
      : "echo 'A compatible .NET SDK was not found.' >&2; exit 145");
    (var code, var text) = await RunDoctor(infra: false);
    (code == 0).ShouldBe(success);
    text.ShouldContain(success
      ? ".NET SDK 10.0.404 for repo tools (satisfies global.json)"
      : "no .NET SDK satisfies global.json at the repo root");
  }

  [Fact]
  public async Task RustMatchingThePinnedToolchainPasses()
  {
    (var code, var text) = await RunDoctor(infra: false);
    code.ShouldBe(0, text);
    text.ShouldContain($"Rust {PinnedRust()} (backend/rust-toolchain.toml)");
    text.ShouldContain("C compiler and linker");
  }

  [Theory]
  [InlineData("cargo")]
  [InlineData("rustc")]
  public async Task MissingCargoOrRustcFailsWithInstallHint(string tool)
  {
    File.Delete(Path.Combine(_bin, tool));
    (var code, var text) = await RunDoctor(infra: false);
    code.ShouldNotBe(0);
    text.ShouldContain("cargo or rustc not found");
    text.ShouldContain("rustup");
  }

  [Theory]
  [InlineData("echo 'rustc 1.0.0 (0000000 2015-05-15)'", "Rust '1.0.0' in backend/")]
  // rustup's proxy fails when the pinned toolchain is not installed.
  [InlineData("echo \"error: toolchain is not installed\" >&2; exit 1", "Rust 'unavailable' in backend/")]
  public async Task RustOtherThanThePinnedToolchainFails(string rustc, string expected)
  {
    WriteExecutable("rustc", rustc);
    (var code, var text) = await RunDoctor(infra: false);
    code.ShouldNotBe(0);
    text.ShouldContain(expected);
    text.ShouldContain($"backend/rust-toolchain.toml wants {PinnedRust()}");
    text.ShouldContain("rustup toolchain install");
  }

  [Fact]
  public async Task MissingCCompilerFailsWithInstallHint()
  {
    File.Delete(Path.Combine(_bin, "cc"));
    (var code, var text) = await RunDoctor(infra: false);
    code.ShouldNotBe(0);
    text.ShouldContain("no C compiler (cc, gcc or clang) found");
  }

  [Fact]
  public async Task MissingDotnetFailsBecauseTheRepoToolsNeedIt()
  {
    File.Delete(Path.Combine(_bin, "dotnet"));
    (var code, var text) = await RunDoctor(infra: false);
    code.ShouldNotBe(0);
    text.ShouldContain("dotnet not found");
    text.ShouldContain("global.json");
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
    WriteExecutable("deno", "printf '<%s>\\n' \"$@\"");
    WriteExecutable("cargo", "printf '<%s>\\n' \"$@\"");
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

  /// <summary>The channel in backend/rust-toolchain.toml, which doctor.sh compares the installed toolchain with.</summary>
  private static string PinnedRust()
  {
    var file = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(SourcePath())!, "../../../backend/rust-toolchain.toml"));
    var line = File.ReadLines(file).First(l => l.StartsWith("channel", StringComparison.Ordinal));
    return line.Split('"')[1];
  }

  private static string SourcePath([System.Runtime.CompilerServices.CallerFilePath] string path = "") => path;

  private static string PinnedDeno() => File.ReadAllText(Path.GetFullPath(
    Path.Combine(Path.GetDirectoryName(SourcePath())!, "../../../.deno-version"))).Trim();

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
