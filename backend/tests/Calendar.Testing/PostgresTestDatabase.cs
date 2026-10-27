using Calendar.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Respawn;
using Testcontainers.PostgreSql;

namespace Calendar.Testing;

/// <summary>
/// A throwaway PostgreSQL container running the image pinned in compose.yaml, initialised with the same
/// role script as local development, with migrations applied via <c>Database.MigrateAsync</c> (never
/// <c>EnsureCreated</c>). Intended to be shared per test assembly through an xUnit assembly fixture.
/// </summary>
public sealed class PostgresTestDatabase : IAsyncDisposable
{
  private const string Database = "calendar";
  private const string AdminPassword = "test-admin-password";
  private const string MigratorPassword = "test-migrator-password";
  private const string AppPassword = "test-app-password";

  private readonly PostgreSqlContainer _container = new PostgreSqlBuilder(RepoFiles.PostgresImage())
      .WithDatabase(Database)
      .WithPassword(AdminPassword)
      .WithEnvironment("CALENDAR_MIGRATOR_PASSWORD", MigratorPassword)
      .WithEnvironment("CALENDAR_APP_PASSWORD", AppPassword)
      .WithResourceMapping(new FileInfo(RepoFiles.Find("docker/postgres/init/01-roles.sh")), "/docker-entrypoint-initdb.d/")
      .Build();

  private Respawner? _respawner;

  /// <summary>Connection string of the least-privilege role the application uses.</summary>
  public string AppConnectionString => ConnectionString("calendar_app", AppPassword);

  /// <summary>Connection string of the schema owner that runs migrations.</summary>
  public string MigratorConnectionString => ConnectionString("calendar_migrator", MigratorPassword);

  public async Task InitializeAsync(CancellationToken cancellationToken = default)
  {
    await _container.StartAsync(cancellationToken);

    await using (var migrator = CreateMigratorContext())
    {
      await migrator.Database.MigrateAsync(cancellationToken);
    }
  }

  /// <summary>Deletes all data (not the schema); call between tests that write.</summary>
  public async Task ResetAsync(CancellationToken cancellationToken = default)
  {
    await using var connection = new NpgsqlConnection(MigratorConnectionString);
    await connection.OpenAsync(cancellationToken);

    // Respawn refuses an empty schema, which is the case until the first entities are mapped.
    await using var count = new NpgsqlCommand(
        "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename <> '__EFMigrationsHistory'", connection);
    if ((long)(await count.ExecuteScalarAsync(cancellationToken))! == 0)
    {
      return;
    }

    _respawner ??= await Respawner.CreateAsync(connection, new RespawnerOptions
    {
      DbAdapter = DbAdapter.Postgres,
      SchemasToInclude = ["public"],
      TablesToIgnore = [new Respawn.Graph.Table("__EFMigrationsHistory")],
    });
    await _respawner.ResetAsync(connection);
  }

  /// <summary>A context connected as the schema owner, for arranging data or running DDL in tests.</summary>
  public CalendarDbContext CreateMigratorContext() => new(CalendarDbContextOptions.Create(MigratorConnectionString).Options);

  /// <summary>A context connected as the application role.</summary>
  public CalendarDbContext CreateAppContext() => new(CalendarDbContextOptions.Create(AppConnectionString).Options);

  public ValueTask DisposeAsync() => _container.DisposeAsync();

  private string ConnectionString(string username, string password) =>
      new NpgsqlConnectionStringBuilder(_container.GetConnectionString()) { Username = username, Password = password }.ConnectionString;
}
