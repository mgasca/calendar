#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.2
#:package Shouldly@4.3.0
#:include ../Infrastructure.cs

using Shouldly;
using Xunit;

namespace InfraTool.Tests;
#pragma warning disable CS1591

public sealed class InfraTests
{
  [Fact]
  public async Task SecretInitializationKeepsPasswordOffArgumentsAndOutput()
  {
    var az = new FakeAzure();
    var output = new StringWriter();
    var error = new StringWriter();
    (await Infra.RunAsync(["secret", "init-postgres-password", "staging"], az, output, error)).ShouldBe(0);
    az.FileContents.ShouldNotBeNullOrEmpty();
    az.Calls.Any(c => c.Contains("ops-vault") && c.Contains("set")).ShouldBeTrue();
    az.Calls.SelectMany(x => x).ShouldNotContain(az.FileContents);
    output.ToString().ShouldNotContain(az.FileContents);
    error.ToString().ShouldNotContain(az.FileContents);
    File.Exists(az.FilePath).ShouldBeFalse();
  }

  [Fact]
  public async Task ExistingPasswordCannotBeOverwritten()
  {
    var az = new FakeAzure { Existing = true };
    (await Infra.RunAsync(["secret", "init-postgres-password", "staging"], az, new StringWriter(), new StringWriter())).ShouldBe(1);
    az.Calls.Any(c => c.Contains("set")).ShouldBeFalse();
    (await Infra.RunAsync(["secret", "init-postgres-password", "staging", "--force"], az, new StringWriter(), new StringWriter())).ShouldBe(1);
  }

  [Fact]
  public async Task FullPreviewKeepsPasswordOffArgumentsAndOutput()
  {
    Environment.SetEnvironmentVariable("AZURE_DEPLOYER_CLIENT_ID", "00000000-0000-0000-0000-000000000001");
    try
    {
      var az = new FakeAzure { Existing = true };
      var output = new StringWriter();
      (await Infra.RunAsync(["what-if", "staging"], az, output, new StringWriter())).ShouldBe(0);
      az.Calls.SelectMany(x => x).ShouldNotContain("secret-value");
      output.ToString().ShouldNotContain("secret-value");
      output.ToString().ShouldNotContain("transformed-secret");
      output.ToString().ShouldNotContain("encoded-value");
      az.FileContents.ShouldContain("secret-value");
      az.FileContents.ShouldContain("calendar-connection-string");
      az.FileContents.ShouldContain("allowed-email-2");
      az.FileContents.ShouldContain("\"keyVaultSecretNames\":{\"value\":[\"allowed-email-2\",\"calendar-connection-string\"]}");
      az.FileContents.ShouldNotContain("postgres-admin-password");
      az.FileContents.ShouldNotContain("google-client-secret");
      az.Calls.Any(c => c.Contains("ops-vault") && c.Contains("show")).ShouldBeTrue();
      az.Calls.Any(c => c.Contains("app-vault") && c.Contains("list")).ShouldBeTrue();
      File.Exists(az.FilePath).ShouldBeFalse();
    }
    finally { Environment.SetEnvironmentVariable("AZURE_DEPLOYER_CLIENT_ID", null); }
  }

  [Fact]
  public async Task FoundationPreviewDoesNotAccessVault()
  {
    Environment.SetEnvironmentVariable("AZURE_DEPLOYER_CLIENT_ID", "00000000-0000-0000-0000-000000000001");
    try
    {
      var az = new FakeAzure();
      (await Infra.RunAsync(["what-if", "staging", "--phase", "foundation"], az, new StringWriter(), new StringWriter())).ShouldBe(0);
      az.Calls.Any(c => c.Contains("keyvault")).ShouldBeFalse();
      az.FileContents.ShouldContain("\"deployDatabaseAndApp\":{\"value\":false}");
    }
    finally { Environment.SetEnvironmentVariable("AZURE_DEPLOYER_CLIENT_ID", null); }
  }

  [Fact]
  public async Task FirewallAddressesAreValidatedAndPassed()
  {
    Environment.SetEnvironmentVariable("AZURE_DEPLOYER_CLIENT_ID", "00000000-0000-0000-0000-000000000001");
    Environment.SetEnvironmentVariable("AZURE_ALLOWED_IPS", "192.0.2.2,198.51.100.0/24");
    try
    {
      var az = new FakeAzure();
      (await Infra.RunAsync(["what-if", "staging", "--phase", "foundation", "--allow-ip", "203.0.113.0/24"], az, new StringWriter(), new StringWriter())).ShouldBe(0);
      az.FileContents.ShouldContain("203.0.113.0");
      az.FileContents.ShouldContain("203.0.113.255");
      az.FileContents.ShouldContain("192.0.2.2");
      (await Infra.RunAsync(["what-if", "staging", "--allow-ip", "1.2.3.4/33"], az, new StringWriter(), new StringWriter())).ShouldBe(1);
    }
    finally { Environment.SetEnvironmentVariable("AZURE_DEPLOYER_CLIENT_ID", null); Environment.SetEnvironmentVariable("AZURE_ALLOWED_IPS", null); }
  }

  [Fact]
  public async Task StartupRemovesOnlyStaleFiles()
  {
    var root = Directory.CreateTempSubdirectory("infra-runtime-test-").FullName;
    var previous = Environment.GetEnvironmentVariable("XDG_RUNTIME_DIR");
    Environment.SetEnvironmentVariable("XDG_RUNTIME_DIR", root);
    try
    {
      var directory = Path.Combine(root, "calendar-infra-private");
      if (!OperatingSystem.IsWindows()) { Directory.CreateDirectory(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute); }
      var stale = Path.Combine(directory, "calendar-infra-old");
      var fresh = Path.Combine(directory, "calendar-infra-fresh");
      await File.WriteAllTextAsync(stale, "stale", TestContext.Current.CancellationToken);
      await File.WriteAllTextAsync(fresh, "fresh", TestContext.Current.CancellationToken);
      File.SetLastWriteTimeUtc(stale, DateTime.UtcNow.AddDays(-2));
      await Infra.RunAsync([], new FakeAzure(), new StringWriter(), new StringWriter());
      File.Exists(stale).ShouldBeFalse();
      File.Exists(fresh).ShouldBeTrue();
    }
    finally { Environment.SetEnvironmentVariable("XDG_RUNTIME_DIR", previous); Directory.Delete(root, true); }
  }

  private sealed class FakeAzure : IAzureProcess
  {
    public bool Existing { get; init; }
    public List<string[]> Calls { get; } = [];
    public string FileContents { get; private set; } = "";
    public string FilePath { get; private set; } = "";

    public Task<string> RunAsync(params string[] args)
    {
      Calls.Add(args);
      if (args.Contains("resource")) { return Task.FromResult("[\"vault\"]"); }
      if (args.Contains("list"))
      {
        if (args.Contains("ops-vault")) { return Task.FromResult(Existing ? "[{\"id\":\"https://vault/secrets/postgres-admin-password\",\"enabled\":true}]" : "[]"); }
        return Task.FromResult("[{\"id\":\"https://vault/secrets/postgres-admin-password\",\"enabled\":true},{\"id\":\"https://vault/secrets/google-client-secret\",\"enabled\":false},{\"id\":\"https://vault/secrets/calendar-connection-string\",\"enabled\":true},{\"id\":\"https://vault/secrets/allowed-email-2\",\"enabled\":true}]");
      }
      if (args.Contains("deployment") && args.Contains("show")) { return Task.FromResult(args.Any(a => a.Contains("opsKeyVaultName", StringComparison.Ordinal)) ? "ops-vault" : "app-vault"); }
      if (args.Contains("show") && args.Contains("keyvault")) { return Task.FromResult("secret-value"); }
      if (args.Contains("rest")) { return Task.FromResult("00000000-0000-0000-0000-000000000002"); }
      if (args.Contains("build-params")) { return Task.FromResult("{\"parametersJson\":\"{\\\"parameters\\\":{}}\"}"); }
      var fileArg = Array.FindIndex(args, x => x == "--file" || x == "--parameters");
      if (fileArg >= 0)
      {
        FilePath = args[fileArg + 1].TrimStart('@');
        FileContents = File.ReadAllText(FilePath);
      }
      return Task.FromResult(args.Contains("what-if") ? "{\"preview\":\"secret-value\",\"password\":\"transformed-secret\",\"changes\":[{\"path\":\"properties.postgresAdministratorPassword\",\"after\":\"encoded-value\"}]}" : "");
    }
  }
}
