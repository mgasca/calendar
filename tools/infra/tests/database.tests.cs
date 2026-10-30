#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.2
#:package Shouldly@4.3.0
#:package Npgsql@10.0.3
#:include ../Infrastructure.cs
#:include ../Diagnostics.cs
#:include ../Database.cs

using Shouldly;
using Xunit;
namespace InfraTool.Tests;
#pragma warning disable CS1591
public sealed class DatabaseTests
{
  [Theory]
  [InlineData(false, false, "store,read,create,report")]
  [InlineData(false, true, "read,create,report")]
  [InlineData(true, true, "read,verify,report")]
  public async Task Reconcile(bool role, bool secret, string expected)
  {
    var steps = new List<string>();
    var result = await Infra.ReconcileRole(role, secret,
      () => { steps.Add("store"); return Task.FromResult("password"); },
      () => { steps.Add("read"); return Task.FromResult("password"); },
      password => { password.ShouldBe("password"); steps.Add("verify"); return Task.FromResult(true); },
      password => { password.ShouldBe("password"); steps.Add("create"); return Task.CompletedTask; },
      _ => { steps.Add("report"); return Task.CompletedTask; });
    result.ShouldBe("password");
    string.Join(',', steps).ShouldBe(expected);
  }

  [Fact]
  public async Task ExistingRoleWithoutSecretRefusesBeforeAnyAction()
  {
    var calls = 0;
    await Should.ThrowAsync<InvalidOperationException>(() => Infra.ReconcileRole(true, false,
      () => { calls++; return Task.FromResult("password"); },
      () => { calls++; return Task.FromResult("password"); },
      _ => { calls++; return Task.FromResult(true); },
      _ => { calls++; return Task.CompletedTask; },
      _ => { calls++; return Task.CompletedTask; }));
    calls.ShouldBe(0);
  }

  [Fact]
  public async Task ExistingRoleWithWrongSecretRefuses()
  {
    var created = false;
    await Should.ThrowAsync<InvalidOperationException>(() => Infra.ReconcileRole(true, true,
      () => Task.FromResult("wrong"), () => Task.FromResult("wrong"), _ => Task.FromResult(false),
      _ => { created = true; return Task.CompletedTask; }, _ => Task.CompletedTask));
    created.ShouldBeFalse();
  }

  [Fact]
  public void ExistingConnectionStringMustMatch()
  {
    Infra.CheckConnectionSecret("expected", "expected");
    Should.Throw<InvalidOperationException>(() => Infra.CheckConnectionSecret("different", "expected"));
  }

  [Fact]
  public void GrantsIncludeIdempotentSchemaPrivileges()
  {
    Infra.GrantsSql.ShouldContain("GRANT CONNECT ON DATABASE calendar TO CURRENT_USER;");
    Infra.GrantsSql.ShouldContain("REVOKE CREATE ON SCHEMA public FROM PUBLIC;");
    Infra.GrantsSql.ShouldContain("GRANT USAGE, CREATE ON SCHEMA public TO calendar_migrator;");
    Infra.GrantsSql.ShouldContain("GRANT USAGE ON SCHEMA public TO calendar_app;");
    Infra.GrantsSql.ShouldNotContain("ALTER SCHEMA public OWNER");
  }

  [Fact]
  public async Task SecretStorageUsesPrivateFileAndNeverArguments()
  {
    var azure = new FakeAzure();
    await Infra.StoreSecret(azure, "ops-vault", "calendar-app-password", "secret-value");
    azure.FileContents.ShouldBe("secret-value");
    azure.Calls.SelectMany(x => x).ShouldNotContain("secret-value");
    File.Exists(azure.FilePath).ShouldBeFalse();
    azure.FileMode.ShouldBe(UnixFileMode.UserRead | UnixFileMode.UserWrite);
  }

  [Fact]
  public async Task FirewallIsRemovedAfterFailure()
  {
    var azure = new FakeAzure();
    await Should.ThrowAsync<InvalidOperationException>(() => Infra.WithFirewall(azure, "rg", "server", "192.0.2.1", () => throw new InvalidOperationException("bundle failure")));
    azure.Calls.Count.ShouldBe(2);
    azure.Calls[0].ShouldContain("create");
    azure.Calls[1].ShouldContain("delete");
    azure.Calls[0].ShouldContain("--server-name");
    azure.Calls[1].ShouldContain("--server-name");
    azure.Calls[0][Array.IndexOf(azure.Calls[0], "--name") + 1].ShouldBe(azure.Calls[1][Array.IndexOf(azure.Calls[1], "--name") + 1]);
    azure.Calls.SelectMany(x => x).ShouldNotContain("secret-value");
  }

  [Fact]
  public async Task FailedFirewallCleanupReportsRuleForManualRemoval()
  {
    var azure = new FakeAzure { FailDelete = true };
    var error = await Should.ThrowAsync<InvalidOperationException>(() => Infra.WithFirewall(azure, "rg", "server", "192.0.2.1", () => Task.CompletedTask));
    error.Message.ShouldContain("remove it manually");
    error.Message.ShouldContain(azure.Calls[1][Array.IndexOf(azure.Calls[1], "--name") + 1]);
  }

  [Fact]
  public async Task NewSecretRefusesAConcurrentWriter()
  {
    var az = new FakeAzure { RuleList = "[{\"id\":\"https://vault/secrets/password\",\"enabled\":true}]" };
    await Should.ThrowAsync<InvalidOperationException>(() => Infra.StoreNewSecret(az, "ops", "password", "secret", TextWriter.Null));
    az.Calls.Any(call => call.Contains("set")).ShouldBeFalse();
  }

  [Fact]
  public async Task ConcurrentSecretChangeIsRejected()
  {
    var az = new FakeAzure { OverrideSecret = "changed" };
    var error = await Should.ThrowAsync<InvalidOperationException>(() => Infra.StoreSecret(az, "ops", "password", "original"));
    error.Message.ShouldContain("Concurrent initialization");
  }

  [Fact]
  public async Task ReconcileRejectsChangedSecretBeforeCreate()
  {
    var created = false;
    await Should.ThrowAsync<InvalidOperationException>(() => Infra.ReconcileRole(false, false, () => Task.FromResult("original"), () => Task.FromResult("changed"), _ => Task.FromResult(true), _ => { created = true; return Task.CompletedTask; }, _ => Task.CompletedTask));
    created.ShouldBeFalse();
  }

  [Fact]
  public async Task CreationRechecksRoleAndSecret()
  {
    await Infra.ConfirmCreationState(() => Task.FromResult(false), () => Task.FromResult("same"), "same");
    await Should.ThrowAsync<InvalidOperationException>(() => Infra.ConfirmCreationState(() => Task.FromResult(true), () => Task.FromResult("same"), "same"));
    await Should.ThrowAsync<InvalidOperationException>(() => Infra.ConfirmCreationState(() => Task.FromResult(false), () => Task.FromResult("changed"), "same"));
  }

  [Fact]
  public async Task MaskCommandsEscapeSecretsWithoutOtherOutput()
  {
    var previous = Environment.GetEnvironmentVariable("GITHUB_ACTIONS");
    Environment.SetEnvironmentVariable("GITHUB_ACTIONS", "true");
    try
    {
      var output = new StringWriter();
      await Infra.MaskSecret(output, "secret%\r\nvalue");
      output.ToString().ShouldBe("::add-mask::secret%25%0D%0Avalue" + Environment.NewLine);
    }
    finally { Environment.SetEnvironmentVariable("GITHUB_ACTIONS", previous); }
  }

  [Fact]
  public async Task StoredAndReadSecretsOnlyAppearInMaskCommands()
  {
    var previous = Environment.GetEnvironmentVariable("GITHUB_ACTIONS");
    Environment.SetEnvironmentVariable("GITHUB_ACTIONS", "true");
    try
    {
      var output = new StringWriter();
      var az = new FakeAzure();
      await Infra.StoreSecret(az, "ops", "password", "secret-value", output);
      var lines = output.ToString().Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries);
      lines.Length.ShouldBe(2);
      lines.All(line => line == "::add-mask::secret-value").ShouldBeTrue();
      az.Calls.SelectMany(x => x).ShouldNotContain("secret-value");
    }
    finally { Environment.SetEnvironmentVariable("GITHUB_ACTIONS", previous); }
  }

  [Fact]
  public async Task CleanupFailureDoesNotMaskOriginalError()
  {
    var az = new FakeAzure { FailDelete = true };
    var error = await Should.ThrowAsync<InvalidOperationException>(() => Infra.WithFirewall(az, "rg", "server", "192.0.2.1", () => throw new InvalidOperationException("original")));
    error.Message.ShouldBe("original");
    error.Data["FirewallCleanup"].ShouldNotBeNull();
  }

  [Fact]
  public async Task CancellationStillRemovesFirewall()
  {
    var az = new FakeAzure();
    await Should.ThrowAsync<OperationCanceledException>(() => Infra.WithFirewall(az, "rg", "server", "192.0.2.1", () => throw new OperationCanceledException()));
    az.Calls[^1].ShouldContain("delete");
  }

  [Fact]
  public async Task SweepDeletesOnlyMigrationRules()
  {
    var az = new FakeAzure { RuleList = "[\"calendar-migration-old\",\"other\"]" };
    await Infra.SweepFirewall(az, "rg", "server");
    az.Calls.Count.ShouldBe(2);
    az.Calls[1].ShouldContain("calendar-migration-old");
  }

  private sealed class FakeAzure : IAzureProcess
  {
    public List<string[]> Calls { get; } = [];
    public bool FailDelete { get; init; }
    public string? OverrideSecret { get; init; }
    public string RuleList { get; init; } = "[]";
    public string FileContents { get; private set; } = "";
    public string FilePath { get; private set; } = "";
    public UnixFileMode FileMode { get; private set; }
    public Task<string> RunAsync(params string[] args)
    {
      Calls.Add(args);
      if (args.Contains("list")) { return Task.FromResult(RuleList); }
      if (args.Contains("show")) { return Task.FromResult(OverrideSecret ?? FileContents); }
      if (FailDelete && args.Contains("delete")) { throw new InvalidOperationException("Azure failure"); }
      var index = Array.IndexOf(args, "--file");
      if (index >= 0)
      {
        FilePath = args[index + 1];
        FileContents = File.ReadAllText(FilePath);
        if (!OperatingSystem.IsWindows()) { FileMode = File.GetUnixFileMode(FilePath); }
      }
      return Task.FromResult("");
    }
  }
}
