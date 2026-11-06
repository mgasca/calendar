using Calendar.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Calendar.Api.Tests;

/// <summary>
/// The database each API test rents is a copy of the migrated one with the same roles and rights
/// (docker/postgres/init/01-roles.sh, ADR-0014), so tests still run as the least-privilege app role.
/// </summary>
public sealed class DatabaseCopyTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
  [Fact]
  public async Task Copy_HasTheOwnerAndAccessListOfTheMigratedDatabase()
  {
    await using CalendarDbContext db = Database.CreateMigratorContext();
    var name = await db.Database.SqlQuery<string>($"SELECT current_database() AS \"Value\"").SingleAsync(Ct);

    (string Owner, string Acl) copy = await DescribeAsync(db, name);
    (string Owner, string Acl) migrated = await DescribeAsync(db, "calendar");

    name.ShouldNotBe("calendar");
    copy.Owner.ShouldBe("calendar_migrator");
    copy.Owner.ShouldBe(migrated.Owner);
    copy.Acl.ShouldBe(migrated.Acl);
  }

  [Fact]
  public async Task Copy_GivesTheAppRoleNoDdlRights()
  {
    await using CalendarDbContext db = Database.CreateAppContext();

    (await db.Database.SqlQuery<string>($"SELECT current_user AS \"Value\"").SingleAsync(Ct)).ShouldBe("calendar_app");
    PostgresException denied = await Should.ThrowAsync<PostgresException>(
        () => db.Database.ExecuteSqlRawAsync("CREATE TABLE app_may_not_create (id int)", Ct));
    denied.SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege);
  }

  // The owner and the sorted access list (role=privileges/grantor), which name roles, not the database.
  private static async Task<(string Owner, string Acl)> DescribeAsync(CalendarDbContext db, string name)
  {
    var row = await db.Database.SqlQuery<string>(
        $"""
        SELECT datdba::regrole::text || '|' || array_to_string(ARRAY(SELECT a::text FROM unnest(datacl) a ORDER BY 1), ',')
          AS "Value"
        FROM pg_database WHERE datname = {name}
        """).SingleAsync(Ct);
    var parts = row.Split('|');
    return (parts[0], parts[1]);
  }
}
