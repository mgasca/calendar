using System.Collections.Concurrent;
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
/// Tests that write can each rent a copy of the migrated database (<see cref="RentCopyAsync"/>), so they
/// can run in parallel.
/// </summary>
public sealed class PostgresTestDatabase : IAsyncDisposable
{
  /// <summary>
  /// The most copies <see cref="RentCopyAsync"/> keeps. Each holds a few pooled connections per role, so this keeps a run
  /// well under PostgreSQL's default max_connections of 100 on any machine; CI runners have 4 cores and never reach it.
  /// </summary>
  public const int MaxCopies = 8;

  private const string Database = "calendar";
  private const string Template = "calendar_template";
  private const string AdminPassword = "test-admin-password";
  private const string MigratorPassword = "test-migrator-password";
  private const string AppPassword = "test-app-password";

  private readonly PostgreSqlContainer _container;
  private readonly string _database;

  // The database this one was copied from; null for the container's own database, which owns the copies.
  private readonly PostgresTestDatabase? _origin;
  private readonly ConcurrentBag<PostgresTestDatabase> _idleCopies = [];
  private readonly SemaphoreSlim _copySlots = new(MaxCopies, MaxCopies);
  private readonly SemaphoreSlim _creating = new(1, 1);
  private bool _templateCreated;
  private int _copies;
  private int _resets;
  private Respawner? _respawner;

  public PostgresTestDatabase()
    : this(
      new PostgreSqlBuilder(RepoFiles.PostgresImage())
        .WithDatabase(Database)
        .WithPassword(AdminPassword)
        .WithEnvironment("CALENDAR_MIGRATOR_PASSWORD", MigratorPassword)
        .WithEnvironment("CALENDAR_APP_PASSWORD", AppPassword)
        .WithResourceMapping(new FileInfo(RepoFiles.Find("docker/postgres/init/01-roles.sh")), "/docker-entrypoint-initdb.d/")
        .Build(),
      Database,
      origin: null)
  {
  }

  private PostgresTestDatabase(PostgreSqlContainer container, string database, PostgresTestDatabase? origin)
  {
    _container = container;
    _database = database;
    _origin = origin;
  }

  /// <summary>Connection string of the least-privilege role the application uses.</summary>
  public string AppConnectionString => ConnectionString("calendar_app", AppPassword);

  /// <summary>Connection string of the schema owner that runs migrations.</summary>
  public string MigratorConnectionString => ConnectionString("calendar_migrator", MigratorPassword);

  /// <summary>How many times <see cref="ResetAsync"/> has run on this database, including on the copies rented from it.</summary>
  public int ResetCount => Volatile.Read(ref _resets);

  public async Task InitializeAsync(CancellationToken cancellationToken = default)
  {
    await _container.StartAsync(cancellationToken);

    // Unpooled, so no connection to the database outlives the migration and CreateTemplateAsync can copy it.
    var unpooled = new NpgsqlConnectionStringBuilder(MigratorConnectionString) { Pooling = false }.ConnectionString;
    await using var migrator = new CalendarDbContext(CalendarDbContextOptions.Create(unpooled).Options);
    await migrator.Database.MigrateAsync(cancellationToken);
  }

  /// <summary>
  /// Snapshots the migrated database into a template that nobody can connect to, for <see cref="RentCopyAsync"/>.
  /// Call it once, right after <see cref="InitializeAsync"/> and before any test connects, because PostgreSQL copies
  /// only a database without connections.
  /// </summary>
  public async Task CreateTemplateAsync(CancellationToken cancellationToken = default)
  {
    await using NpgsqlConnection admin = await OpenAdminConnectionAsync(cancellationToken);
    await ExecuteAsync(admin, $"CREATE DATABASE {Template} TEMPLATE {Database} ALLOW_CONNECTIONS false", cancellationToken);
    _templateCreated = true;
  }

  /// <summary>
  /// Rents a database of its own, copied from the template (<see cref="CreateTemplateAsync"/>), so tests that write
  /// can run in parallel. A returned copy is reused as it was left, so reset it before use. A new copy is created
  /// only when every existing one is rented; when <see cref="MaxCopies"/> are, this waits for a return.
  /// </summary>
  public async Task<PostgresTestDatabase> RentCopyAsync(CancellationToken cancellationToken = default)
  {
    if (_origin is not null || !_templateCreated)
    {
      throw new InvalidOperationException("Rent copies from the container's own database, after CreateTemplateAsync.");
    }

    await _copySlots.WaitAsync(cancellationToken);
    try
    {
      return _idleCopies.TryTake(out PostgresTestDatabase? idle) ? idle : await CreateCopyAsync(cancellationToken);
    }
    catch
    {
      _copySlots.Release();
      throw;
    }
  }

  /// <summary>Returns a copy from <see cref="RentCopyAsync"/>, for the next test to rent.</summary>
  public void ReturnCopy(PostgresTestDatabase copy)
  {
    EnsureRentedFromThis(copy);
    _idleCopies.Add(copy);
    _copySlots.Release();
  }

  /// <summary>
  /// Gives up a copy from <see cref="RentCopyAsync"/> that may be in an unknown state, such as after a test failed to
  /// shut down: no test rents it again, and its slot goes to a new copy.
  /// </summary>
  public void DiscardCopy(PostgresTestDatabase copy)
  {
    EnsureRentedFromThis(copy);
    _copySlots.Release();
  }

  /// <summary>Deletes all data (not the schema); call between tests that write.</summary>
  public async Task ResetAsync(CancellationToken cancellationToken = default)
  {
    Interlocked.Increment(ref _resets);
    if (_origin is not null)
    {
      Interlocked.Increment(ref _origin._resets);
    }

    await using var connection = new NpgsqlConnection(MigratorConnectionString);
    await connection.OpenAsync(cancellationToken);

    if (_respawner is null)
    {
      // Respawn refuses an empty schema, which is the case until the first entities are mapped.
      await using var count = new NpgsqlCommand(
          "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename <> '__EFMigrationsHistory'",
          connection);
      if ((long)(await count.ExecuteScalarAsync(cancellationToken))! == 0)
      {
        return;
      }

      _respawner = await Respawner.CreateAsync(connection, new RespawnerOptions
      {
        DbAdapter = DbAdapter.Postgres,
        SchemasToInclude = ["public"],
        TablesToIgnore = [new Respawn.Graph.Table("__EFMigrationsHistory")],
      });
    }

    await _respawner.ResetAsync(connection);
  }

  /// <summary>A context connected as the schema owner, for arranging data or running DDL in tests.</summary>
  public CalendarDbContext CreateMigratorContext() => new(CalendarDbContextOptions.Create(MigratorConnectionString).Options);

  /// <summary>A context connected as the application role.</summary>
  public CalendarDbContext CreateAppContext() => new(CalendarDbContextOptions.Create(AppConnectionString).Options);

  /// <summary>Stops the container, and with it every copy. A copy's own disposal does nothing; return it instead.</summary>
  public async ValueTask DisposeAsync()
  {
    if (_origin is not null)
    {
      return;
    }

    _copySlots.Dispose();
    _creating.Dispose();
    await _container.DisposeAsync();
  }

  private static async Task ExecuteAsync(NpgsqlConnection connection, string sql, CancellationToken cancellationToken)
  {
    await using var command = new NpgsqlCommand(sql, connection);
    await command.ExecuteNonQueryAsync(cancellationToken);
  }

  private void EnsureRentedFromThis(PostgresTestDatabase copy)
  {
    ArgumentNullException.ThrowIfNull(copy);
    if (copy._origin != this)
    {
      throw new ArgumentException("The database was not rented from this one.", nameof(copy));
    }
  }

  private async Task<PostgresTestDatabase> CreateCopyAsync(CancellationToken cancellationToken)
  {
    // One at a time: concurrent copies of one template compete for the same locks for no gain.
    await _creating.WaitAsync(cancellationToken);
    try
    {
      var name = $"{Database}_copy_{Interlocked.Increment(ref _copies)}";
      await using NpgsqlConnection admin = await OpenAdminConnectionAsync(cancellationToken);

      // CREATE DATABASE can't share a batch: it refuses to run inside the batch's implicit transaction.
      await ExecuteAsync(admin, $"CREATE DATABASE {name} TEMPLATE {Template} OWNER calendar_migrator", cancellationToken);

      // A copy keeps the schema's grants and default privileges, but not the database's own ACL, so repeat the
      // database-level part of docker/postgres/init/01-roles.sh.
      await ExecuteAsync(
          admin,
          $"REVOKE ALL ON DATABASE {name} FROM PUBLIC; "
          + $"GRANT CONNECT ON DATABASE {name} TO CURRENT_USER; "
          + $"GRANT CONNECT ON DATABASE {name} TO calendar_app",
          cancellationToken);
      return new PostgresTestDatabase(_container, name, origin: this);
    }
    finally
    {
      _creating.Release();
    }
  }

  // The maintenance database, because PostgreSQL won't copy the database a session is connected to.
  private async Task<NpgsqlConnection> OpenAdminConnectionAsync(CancellationToken cancellationToken)
  {
    var connection = new NpgsqlConnection(
        new NpgsqlConnectionStringBuilder(_container.GetConnectionString()) { Database = "postgres", Pooling = false }.ConnectionString);
    await connection.OpenAsync(cancellationToken);
    return connection;
  }

  private string ConnectionString(string username, string password) =>
      new NpgsqlConnectionStringBuilder(_container.GetConnectionString())
      {
        Database = _database,
        Username = username,
        Password = password,
      }.ConnectionString;
}
