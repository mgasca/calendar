#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.2
#:package Shouldly@4.3.0
#:include ../Infrastructure.cs
#:include ../Diagnostics.cs
#:include ../Database.cs
#:package Npgsql@10.0.3

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
    (await Infra.RunAsync(["secret", "init-postgres-password", "staging"], az, output, error, TestContext.Current.CancellationToken)).ShouldBe(0);
    az.FileContents.ShouldNotBeNullOrEmpty();
    az.Calls.Any(c => c.Contains("ops-vault") && c.Contains("set")).ShouldBeTrue();
    az.Calls.SelectMany(x => x).ShouldNotContain(az.FileContents);
    WithoutMasks(output.ToString()).ShouldNotContain(az.FileContents);
    error.ToString().ShouldNotContain(az.FileContents);
    File.Exists(az.FilePath).ShouldBeFalse();
  }

  [Fact]
  public async Task ExistingPasswordCannotBeOverwritten()
  {
    var az = new FakeAzure { Existing = true };
    (await Infra.RunAsync(["secret", "init-postgres-password", "staging"], az, new StringWriter(), new StringWriter(), TestContext.Current.CancellationToken)).ShouldBe(1);
    az.Calls.Any(c => c.Contains("set")).ShouldBeFalse();
    (await Infra.RunAsync(["secret", "init-postgres-password", "staging", "--force"], az, new StringWriter(), new StringWriter(), TestContext.Current.CancellationToken)).ShouldBe(1);
  }

  [Fact]
  public async Task FullPreviewKeepsPasswordOffArgumentsAndOutput()
  {
    Environment.SetEnvironmentVariable("AZURE_DEPLOYER_CLIENT_ID", "00000000-0000-0000-0000-000000000001");
    try
    {
      var az = new FakeAzure { Existing = true };
      var output = new StringWriter();
      (await Infra.RunAsync(["what-if", "staging"], az, output, new StringWriter(), TestContext.Current.CancellationToken)).ShouldBe(0);
      az.Calls.SelectMany(x => x).ShouldNotContain("secret-value");
      WithoutMasks(output.ToString()).ShouldNotContain("secret-value");
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
      (await Infra.RunAsync(["what-if", "staging", "--phase", "foundation"], az, new StringWriter(), new StringWriter(), TestContext.Current.CancellationToken)).ShouldBe(0);
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
      (await Infra.RunAsync(["what-if", "staging", "--phase", "foundation", "--allow-ip", "203.0.113.0/24"], az, new StringWriter(), new StringWriter(), TestContext.Current.CancellationToken)).ShouldBe(0);
      az.FileContents.ShouldContain("203.0.113.0");
      az.FileContents.ShouldContain("203.0.113.255");
      az.FileContents.ShouldContain("192.0.2.2");
      (await Infra.RunAsync(["what-if", "staging", "--allow-ip", "1.2.3.4/33"], az, new StringWriter(), new StringWriter(), TestContext.Current.CancellationToken)).ShouldBe(1);
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
      await Infra.RunAsync([], new FakeAzure(), new StringWriter(), new StringWriter(), TestContext.Current.CancellationToken);
      File.Exists(stale).ShouldBeFalse();
      File.Exists(fresh).ShouldBeTrue();
    }
    finally { Environment.SetEnvironmentVariable("XDG_RUNTIME_DIR", previous); Directory.Delete(root, true); }
  }

  [Fact]
  public async Task FailureIsSanitizedTruncatedAndWrittenPrivately()
  {
    var diagnostics = new Diagnostics(new ScriptedAzure(), new StringWriter());
    diagnostics.Mask("known-value");
    var failure = new AzureFailureException(7, string.Join('\n', Enumerable.Repeat("filler", 80)), "known-value password=hidden Bearer abc123 jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop long AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA https://x/path?sv=2020&sig=signed");
    failure.Command = "az deployment group create";
    failure.Step = "creating deployment";
    var error = new StringWriter();
    await diagnostics.Report(failure, error);
    var report = error.ToString();
    report.ShouldContain("creating deployment: az deployment group create failed (exit 7)");
    report.ShouldContain("truncated");
    var path = report.Split("Sanitized transcript: ")[1].Trim();
    try
    {
      var transcript = await File.ReadAllTextAsync(path, TestContext.Current.CancellationToken);
      foreach (var secret in new[] { "known-value", "hidden", "abc123", "eyJhbGciOiJIUzI1NiJ9", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "signed" })
      {
        report.ShouldNotContain(secret);
        transcript.ShouldNotContain(secret);
      }
      if (!OperatingSystem.IsWindows()) { File.GetUnixFileMode(path).ShouldBe(UnixFileMode.UserRead | UnixFileMode.UserWrite); }
      diagnostics.Verbose = true;
      var verbose = new StringWriter();
      await diagnostics.Report(failure, verbose);
      verbose.ToString().ShouldNotContain("truncated");
      File.Delete(verbose.ToString().Split("Sanitized transcript: ")[1].Trim());
    }
    finally { File.Delete(path); }
  }

  [Theory]
  [InlineData("AuthorizationFailed role assignment", "role grant", true)]
  [InlineData("Unable to get value using Managed identity", "Secrets User", true)]
  [InlineData("ServerIsBusy", "temporarily busy", true)]
  [InlineData("HTTP 429", "temporarily busy", true)]
  [InlineData("InvalidTemplate", "template", false)]
  [InlineData("QuotaExceeded", "quota", false)]
  [InlineData("RegionIsOfferRestricted", "quota", false)]
  [InlineData("SkuNotAvailable", "quota", false)]
  [InlineData("name already taken", "name", false)]
  [InlineData("firewall rule", "firewall", false)]
  [InlineData("not logged in", "az login", false)]
  [InlineData("Conflict", "conflicting", false)]
  public void FailureHintsAreClassified(string message, string expected, bool retry)
  {
    var hint = Diagnostics.Classify(message);
    hint.ShouldNotBeNull();
    hint.Advice.ShouldContain(expected);
    (hint.RetryReason is not null).ShouldBe(retry);
  }

  [Fact]
  public async Task NestedOperationsAreCollectedAndSanitized()
  {
    var az = new ScriptedAzure
    {
      OperationResponses = new Dictionary<string, string>
      {
        ["main"] = "[{\"properties\":{\"targetResource\":{\"resourceType\":\"Microsoft.Resources/deployments\",\"resourceName\":\"app\"},\"statusMessage\":{\"error\":{\"code\":\"DeploymentFailed\",\"message\":\"failed\"}}}}]",
        ["app"] = "[{\"properties\":{\"targetResource\":{\"resourceType\":\"Microsoft.App/containerApps\",\"resourceName\":\"web\"},\"statusMessage\":{\"error\":{\"code\":\"Bad\",\"message\":\"password=hidden\"}}}}]"
      }
    };
    var diagnostics = new Diagnostics(az, new StringWriter());
    var failure = new AzureFailureException(1, "", "");
    await diagnostics.CollectOperations(failure, "group", "main");
    failure.Operations.Count.ShouldBe(2);
    diagnostics.Sanitize(string.Join('\n', failure.Operations)).ShouldContain("Microsoft.App/containerApps/web: Bad");
    diagnostics.Sanitize(string.Join('\n', failure.Operations)).ShouldNotContain("hidden");
    az.Calls.Count.ShouldBe(2);
    az.Calls[0].ShouldContain("[?properties.provisioningState=='Failed']");
  }

  [Theory]
  [InlineData("ServerIsBusy", 2, true, 2)]
  [InlineData("InvalidTemplate", 2, true, 1)]
  [InlineData("ServerIsBusy", 0, true, 1)]
  [InlineData("ServerIsBusy", 2, false, 1)]
  public async Task RetriesOnlySafeTransientDeployments(string message, int retries, bool deployment, int calls)
  {
    var az = new ScriptedAzure { FailureMessage = message, Failures = 1 };
    var output = new StringWriter();
    var waits = new List<TimeSpan>();
    var diagnostics = new Diagnostics(az, output, (duration, _) => { waits.Add(duration); return Task.CompletedTask; }) { Retries = retries };
    var wrapped = diagnostics.Wrap();
    var args = deployment ? new[] { "deployment", "group", "create", "--resource-group", "group" } : new[] { "keyvault", "secret", "set" };
    if (calls == 1) { await Should.ThrowAsync<AzureFailureException>(async () => await wrapped.RunAsync(args)); }
    else { await wrapped.RunAsync(args); waits.ShouldBe([TimeSpan.FromSeconds(60)]); output.ToString().ShouldContain("Attempt 2/3"); }
    az.Calls.Count(c => !c.Contains("operation")).ShouldBe(calls);
    output.ToString().ShouldContain(deployment ? "creating deployment" : "storing vault secret");
  }

  [Fact]
  public async Task RetryWaitsFollowBackoffAndObserveCancellation()
  {
    var az = new ScriptedAzure { FailureMessage = "ServerIsBusy", Failures = 2 };
    var waits = new List<TimeSpan>();
    var diagnostics = new Diagnostics(az, new StringWriter(), (duration, _) => { waits.Add(duration); return Task.CompletedTask; });
    await diagnostics.Wrap().RunAsync("deployment", "group", "create", "--resource-group", "group");
    waits.ShouldBe([TimeSpan.FromSeconds(60), TimeSpan.FromSeconds(120)]);
    using var cancellation = new CancellationTokenSource();
    var blocking = new Diagnostics(new ScriptedAzure { FailureMessage = "ServerIsBusy", Failures = 1 }, new StringWriter(), (duration, token) => Task.Delay(duration, token), cancellation.Token);
    var task = blocking.Wrap().RunAsync("deployment", "group", "create", "--resource-group", "group");
    await cancellation.CancelAsync();
    await Should.ThrowAsync<OperationCanceledException>(async () => await task);
  }

  private sealed class ScriptedAzure : IAzureProcess
  {
    public string FailureMessage { get; init; } = "";
    public int Failures { get; set; }
    public Dictionary<string, string> OperationResponses { get; init; } = [];
    public List<string[]> Calls { get; } = [];
    public Task<string> RunAsync(params string[] args)
    {
      Calls.Add(args);
      if (args.Contains("operation"))
      {
        var index = Array.IndexOf(args, "--name");
        return Task.FromResult(OperationResponses.GetValueOrDefault(args[index + 1], "[]"));
      }
      if (Failures-- > 0) { throw new AzureFailureException(1, "", FailureMessage); }
      return Task.FromResult("");
    }
  }

  private static string WithoutMasks(string output) => string.Join('\n', output.Split('\n').Where(line => !line.StartsWith("::add-mask::", StringComparison.Ordinal)));

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
