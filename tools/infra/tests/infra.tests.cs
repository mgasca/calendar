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
    az.Calls.SelectMany(x => x).ShouldNotContain(az.FileContents);
    output.ToString().ShouldNotContain(az.FileContents);
    error.ToString().ShouldNotContain(az.FileContents);
    File.Exists(az.FilePath).ShouldBeFalse();
  }

  [Fact]
  public async Task ExistingPasswordRequiresForce()
  {
    var az = new FakeAzure { Existing = true };
    (await Infra.RunAsync(["secret", "init-postgres-password", "staging"], az, new StringWriter(), new StringWriter())).ShouldBe(1);
    az.Calls.Any(c => c.Contains("set")).ShouldBeFalse();
    (await Infra.RunAsync(["secret", "init-postgres-password", "staging", "--force"], az, new StringWriter(), new StringWriter())).ShouldBe(0);
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
      az.FileContents.ShouldContain("secret-value");
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
      if (args.Contains("list")) { return Task.FromResult(Existing ? "[\"https://vault.vault.azure.net/secrets/postgres-admin-password\"]" : "[]"); }
      if (args.Contains("show") && args.Contains("keyvault")) { return Task.FromResult("secret-value"); }
      if (args.Contains("rest")) { return Task.FromResult("00000000-0000-0000-0000-000000000002"); }
      if (args.Contains("build-params")) { return Task.FromResult("{\"parametersJson\":\"{\\\"parameters\\\":{}}\"}"); }
      var fileArg = Array.FindIndex(args, x => x == "--file" || x == "--parameters");
      if (fileArg >= 0)
      {
        FilePath = args[fileArg + 1].TrimStart('@');
        FileContents = File.ReadAllText(FilePath);
      }
      return Task.FromResult(args.Contains("what-if") ? "preview secret-value" : "");
    }
  }
}
