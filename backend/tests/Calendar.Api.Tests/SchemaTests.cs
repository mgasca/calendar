using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Calendar.Api.Tests;

/// <summary>The database enforces the invariants itself, not only the domain code.</summary>
public sealed class SchemaTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
  [Theory]
  [InlineData("ix_tasks_open_due_date", "due_date")]
  [InlineData("ix_tasks_open_due_at", "due_at")]
  public async Task OpenTaskDueIndex_ExcludesCompletedAndUndatedTasks(string indexName, string column)
  {
    await using var db = Postgres.Database.CreateMigratorContext();
    var definition = await db.Database.SqlQuery<string>(
        $"SELECT indexdef AS \"Value\" FROM pg_indexes WHERE tablename = 'tasks' AND indexname = {indexName}").SingleAsync(Ct);

    definition.ShouldContain($"({column})");
    definition.ShouldContain($"({column} IS NOT NULL)");
    definition.ShouldContain("(completed_at IS NULL)");
  }

  [Fact]
  public async Task Task_WithBothDueValues_IsRejected()
  {
    await using var db = Postgres.Database.CreateMigratorContext();

    var ex = await Should.ThrowAsync<PostgresException>(async () => await db.Database.ExecuteSqlRawAsync(
        "INSERT INTO tasks (id, title, due_date, due_at) VALUES (gen_random_uuid(), 't', '2026-10-26', now())", Ct));

    ex.SqlState.ShouldBe(PostgresErrorCodes.CheckViolation);
    ex.ConstraintName.ShouldBe("ck_tasks_due_date_xor_due_at");
  }

  [Theory]
  [InlineData("(gen_random_uuid(), 'e', false, now(), now() + interval '1 hour', NULL, '2026-10-26', '2026-10-27')")] // timed with a time zone missing and dates set
  [InlineData("(gen_random_uuid(), 'e', false, now(), now() - interval '1 hour', 'UTC', NULL, NULL)")] // ends before it starts
  [InlineData("(gen_random_uuid(), 'e', true, NULL, NULL, NULL, '2026-10-26', '2026-10-26')")] // empty all-day span
  [InlineData("(gen_random_uuid(), 'e', true, now(), now() + interval '1 hour', 'UTC', '2026-10-26', '2026-10-27')")] // both kinds
  [InlineData("(gen_random_uuid(), '  ', true, NULL, NULL, NULL, '2026-10-26', '2026-10-27')")] // blank title
  public async Task Event_ViolatingTheShapeRules_IsRejected(string values)
  {
    await using var db = Postgres.Database.CreateMigratorContext();

#pragma warning disable EF1003 // values are fixed literals from the InlineData above, not user input
    var ex = await Should.ThrowAsync<PostgresException>(async () => await db.Database.ExecuteSqlRawAsync(
        "INSERT INTO events (id, title, is_all_day, starts_at, ends_at, time_zone_id, start_date, end_date) VALUES " + values, Ct));
#pragma warning restore EF1003

    // An inverted span is refused by the generated range column (data_exception) before the check constraint runs.
    ex.SqlState.ShouldBeOneOf(PostgresErrorCodes.CheckViolation, PostgresErrorCodes.DataException);
  }

  [Fact]
  public async Task EventSpan_IsAGistIndexedGeneratedRange_OnlyForTimedEvents()
  {
    await using var db = Postgres.Database.CreateMigratorContext();

    var gist = await db.Database.SqlQueryRaw<string>(
        "SELECT indexdef AS \"Value\" FROM pg_indexes WHERE tablename = 'events' AND indexname = 'ix_events_span'").SingleAsync(Ct);
    gist.ShouldContain("USING gist (span)");

    await db.Database.ExecuteSqlRawAsync(
        "INSERT INTO events (id, title, is_all_day, starts_at, ends_at, time_zone_id) VALUES (gen_random_uuid(), 'timed', false, '2026-10-26T10:00Z', '2026-10-26T11:00Z', 'UTC')", Ct);
    await db.Database.ExecuteSqlRawAsync(
        "INSERT INTO events (id, title, is_all_day, start_date, end_date) VALUES (gen_random_uuid(), 'day', true, '2026-10-26', '2026-10-27')", Ct);

    var spans = await db.Database.SqlQueryRaw<string>("SELECT COALESCE(span::text, 'NULL') AS \"Value\" FROM events ORDER BY is_all_day").ToListAsync(Ct);
    spans.ShouldBe(["[\"2026-10-26 10:00:00+00\",\"2026-10-26 11:00:00+00\")", "NULL"]);
  }

  [Fact]
  public async Task EventDateSpan_IsAPartialGistIndexedGeneratedRange_OnlyForAllDayEvents()
  {
    await using var db = Postgres.Database.CreateMigratorContext();

    var gist = await db.Database.SqlQueryRaw<string>(
        "SELECT indexdef AS \"Value\" FROM pg_indexes WHERE tablename = 'events' AND indexname = 'ix_events_date_span'").SingleAsync(Ct);
    gist.ShouldContain("USING gist (date_span) WHERE is_all_day");

    await db.Database.ExecuteSqlRawAsync(
        "INSERT INTO events (id, title, is_all_day, starts_at, ends_at, time_zone_id) VALUES (gen_random_uuid(), 'timed', false, '2026-10-26T10:00Z', '2026-10-26T11:00Z', 'UTC')", Ct);
    await db.Database.ExecuteSqlRawAsync(
        "INSERT INTO events (id, title, is_all_day, start_date, end_date) VALUES (gen_random_uuid(), 'days', true, '2026-10-26', '2026-10-28')", Ct);

    var spans = await db.Database.SqlQueryRaw<string>("SELECT COALESCE(date_span::text, 'NULL') AS \"Value\" FROM events ORDER BY is_all_day").ToListAsync(Ct);
    spans.ShouldBe(["NULL", "[2026-10-26,2026-10-28)"]);
  }

  [Fact]
  public async Task AppRole_CannotChangeTheSchema()
  {
    await using var db = Postgres.Database.CreateAppContext();

    var ex = await Should.ThrowAsync<PostgresException>(async () => await db.Database.ExecuteSqlRawAsync("DROP TABLE tasks", Ct));

    ex.SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege);
  }
}
