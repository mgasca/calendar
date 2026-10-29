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
    foreach (var command in new[] { "dirname", "tr", "sed" })
    {
      File.CreateSymbolicLink(Path.Combine(_bin, command), "/usr/bin/" + command);
    }
  }

  public void Dispose() => Directory.Delete(_bin, true);

  [Fact]
  public async Task MissingAzureCliFailsWithInstallHint()
  {
    var (code, text) = await RunDoctor();
    code.ShouldNotBe(0);
    text.ShouldContain("Azure CLI not found");
    text.ShouldContain("Install Azure CLI");
  }

  [Fact]
  public async Task MismatchedAzureAndBicepVersionsFailWithInstallHints()
  {
    var az = Path.Combine(_bin, "az");
    await File.WriteAllTextAsync(az, "#!/bin/sh\ncase \"$1\" in version) echo 0.1.0;; bicep) echo 'Bicep CLI version 0.1.0 (fake)';; esac\n", TestContext.Current.CancellationToken);
    if (!OperatingSystem.IsWindows()) { File.SetUnixFileMode(az, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute); }
    var (code, text) = await RunDoctor();
    code.ShouldNotBe(0);
    text.ShouldContain("Azure CLI version '0.1.0'");
    text.ShouldContain("Bicep version '0.1.0'");
    text.ShouldContain("az bicep install --version");
  }

  private static string SourcePath([System.Runtime.CompilerServices.CallerFilePath] string path = "") => path;

  private async Task<(int, string)> RunDoctor()
  {
    var info = new ProcessStartInfo("/bin/bash") { RedirectStandardOutput = true, RedirectStandardError = true };
    info.ArgumentList.Add(Path.GetFullPath(Path.Combine(Path.GetDirectoryName(SourcePath())!, "../doctor.sh")));
    info.ArgumentList.Add("--infra");
    info.Environment["PATH"] = _bin;
    using var process = Process.Start(info) ?? throw new InvalidOperationException();
    var output = await process.StandardOutput.ReadToEndAsync();
    await process.WaitForExitAsync();
    return (process.ExitCode, output + await process.StandardError.ReadToEndAsync());
  }
}
