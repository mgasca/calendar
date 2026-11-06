using Calendar.Testing;

[assembly: AssemblyFixture(typeof(Calendar.Api.Tests.PostgresFixture))]

namespace Calendar.Api.Tests;

/// <summary>One PostgreSQL container for the whole assembly; inject into test classes via the constructor.</summary>
public sealed class PostgresFixture : IAsyncLifetime
{
  public PostgresTestDatabase Database { get; } = new();

  public async ValueTask InitializeAsync()
  {
    await Database.InitializeAsync();

    // Before any test connects, so the migrated database can be copied for ApiTestBase.
    await Database.CreateTemplateAsync();
  }

  public async ValueTask DisposeAsync() => await Database.DisposeAsync();
}
