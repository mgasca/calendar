using System.Reflection;
using System.Text.Json;

namespace Calendar.Api.Tests;

/// <summary>
/// Keeps the API test classes running in parallel (#349, record 0009): xUnit runs each class as a collection of its
/// own, in parallel, unless a <c>[Collection]</c>, an assembly-wide <c>CollectionBehavior</c> or the runner settings
/// put them back in one serial collection. Only <see cref="ApiTestLifecycleTests"/>, which must run alone, may opt out.
/// </summary>
public sealed class ApiTestParallelismTests
{
  private static readonly Assembly TestAssembly = typeof(ApiTestParallelismTests).Assembly;

  [Fact]
  public void NoTestClassButTheLifecycleTests_JoinsANamedCollection()
  {
    var inCollections = TestAssembly.GetTypes()
      .Where(t => t != typeof(ApiTestLifecycleTests))
      .Where(t => t.GetCustomAttributes(inherit: true)
        .Any(a => a.GetType().Name.StartsWith("CollectionAttribute", StringComparison.Ordinal)))
      .Select(t => t.FullName)
      .ToList();

    inCollections.ShouldBeEmpty("a shared [Collection] runs those classes one at a time");
  }

  [Fact]
  public void OnlyTheLifecycleCollection_DisablesParallelization()
  {
    var serial = TestAssembly.GetTypes()
      .Where(t => t.GetCustomAttribute<CollectionDefinitionAttribute>() is { DisableParallelization: true })
      .ToList();

    serial.ShouldBe([typeof(ApiTestLifecycleRunsAlone)]);
  }

  [Fact]
  public void TheAssembly_DoesNotOverrideTheParallelDefaults()
  {
    var overrides = TestAssembly.GetCustomAttributes()
      .Select(a => a.GetType().Name)
      .Where(name => name is "CollectionBehaviorAttribute" or "ParallelizationAttribute")
      .ToList();

    overrides.ShouldBeEmpty("an assembly-wide setting can serialise every collection");
  }

  [Fact]
  public void TheRunnerSettings_DoNotOverrideTheParallelDefaults()
  {
    string[] parallelSettings = ["parallelizeTestCollections", "maxParallelThreads", "parallelAlgorithm"];
    using var settings = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "xunit.runner.json")));

    var overrides = settings.RootElement.EnumerateObject()
      .Select(p => p.Name)
      .Where(name => parallelSettings.Contains(name, StringComparer.Ordinal))
      .ToList();

    overrides.ShouldBeEmpty("xunit.runner.json can serialise every collection");
  }
}
