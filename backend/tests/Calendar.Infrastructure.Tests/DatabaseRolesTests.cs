using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Calendar.Infrastructure.Tests;

public sealed class DatabaseRolesTests(PostgresFixture postgres)
{
  private static CancellationToken Ct => TestContext.Current.CancellationToken;

  [Fact]
  public async Task AppRole_CanConnect()
  {
    await using CalendarDbContext context = postgres.Database.CreateAppContext();

    (await context.Database.CanConnectAsync(Ct)).ShouldBeTrue();
  }

  [Fact]
  public async Task Migrations_AreAppliedByMigrateAsync()
  {
    await using CalendarDbContext context = postgres.Database.CreateMigratorContext();

    (await context.Database.GetPendingMigrationsAsync(Ct)).ShouldBeEmpty();
  }

  [Fact]
  public async Task AppRole_CannotRunDdl()
  {
    await using CalendarDbContext context = postgres.Database.CreateAppContext();

    PostgresException ex = await Should.ThrowAsync<PostgresException>(
        () => context.Database.ExecuteSqlRawAsync("CREATE TABLE app_ddl_attempt (id int)", Ct));

    ex.SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege);
  }

  [Fact]
  public async Task AppRole_GetsDmlOnTablesTheMigratorCreates()
  {
    await using CalendarDbContext migrator = postgres.Database.CreateMigratorContext();
    await migrator.Database.ExecuteSqlRawAsync("CREATE TABLE privilege_probe (id int PRIMARY KEY)", Ct);
    try
    {
      await using CalendarDbContext app = postgres.Database.CreateAppContext();
      await app.Database.ExecuteSqlRawAsync("INSERT INTO privilege_probe VALUES (1)", Ct);
      await app.Database.ExecuteSqlRawAsync("UPDATE privilege_probe SET id = 2", Ct);
      await app.Database.ExecuteSqlRawAsync("DELETE FROM privilege_probe", Ct);

      PostgresException ex = await Should.ThrowAsync<PostgresException>(
          () => app.Database.ExecuteSqlRawAsync("DROP TABLE privilege_probe", Ct));
      ex.SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege, "only the owner may drop");
    }
    finally
    {
      await migrator.Database.ExecuteSqlRawAsync("DROP TABLE privilege_probe", Ct);
    }
  }
}
