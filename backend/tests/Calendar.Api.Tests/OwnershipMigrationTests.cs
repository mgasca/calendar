using Calendar.Domain.Users;
using Calendar.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Calendar.Api.Tests;

/// <summary>
/// The ownership migration (ADR-0041) on a database with rows from before it: every row ends up owned by the
/// legacy placeholder, which exists unclaimed, and new rows must name an owner. Runs in the database collection
/// and leaves the schema at the latest migration.
/// </summary>
public sealed class OwnershipMigrationTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
  private const string BeforeOwnership = "DataProtectionKeys";

  [Fact]
  public async Task PreExistingRows_AreBackfilledToTheUnclaimedLegacyOwner()
  {
    await using CalendarDbContext db = Postgres.Database.CreateMigratorContext();
    try
    {
      await db.Database.MigrateAsync(BeforeOwnership, Ct);
      await db.Database.ExecuteSqlRawAsync(
        "INSERT INTO events (id, title, is_all_day, start_date, end_date) "
        + "VALUES (gen_random_uuid(), 'old event', true, '2026-10-26', '2026-10-27')",
        Ct);
      await db.Database.ExecuteSqlRawAsync("INSERT INTO tasks (id, title) VALUES (gen_random_uuid(), 'old task')", Ct);

      await db.Database.MigrateAsync(Ct);

      List<Guid> eventOwners = await db.Database.SqlQueryRaw<Guid>("SELECT owner_id AS \"Value\" FROM events").ToListAsync(Ct);
      List<Guid> taskOwners = await db.Database.SqlQueryRaw<Guid>("SELECT owner_id AS \"Value\" FROM tasks").ToListAsync(Ct);
      eventOwners.ShouldBe([User.LegacyOwnerId]);
      taskOwners.ShouldBe([User.LegacyOwnerId]);

      User placeholder = await db.Users.SingleAsync(u => u.Id == User.LegacyOwnerId, Ct);
      placeholder.IsUnclaimedPlaceholder.ShouldBeTrue();

      // The backfill default is gone: a new row must say who owns it.
      PostgresException missingOwner = await Should.ThrowAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync(
        "INSERT INTO tasks (id, title) VALUES (gen_random_uuid(), 'ownerless')",
        Ct));
      missingOwner.SqlState.ShouldBe(PostgresErrorCodes.NotNullViolation);
    }
    finally
    {
      await db.Database.MigrateAsync(CancellationToken.None);
    }
  }
}
