using Calendar.Infrastructure;
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
    await using CalendarDbContext db = Postgres.Database.CreateMigratorContext();
    var definition = await db.Database.SqlQuery<string>(
        $"SELECT indexdef AS \"Value\" FROM pg_indexes WHERE tablename = 'tasks' AND indexname = {indexName}").SingleAsync(Ct);

    // ADR-0041: the owner leads, since every task query is scoped to one owner first.
    definition.ShouldContain($"(owner_id, {column})");
    definition.ShouldContain($"({column} IS NOT NULL)");
    definition.ShouldContain("(completed_at IS NULL)");
  }

  [Theory]
  [InlineData("events", "fk_events_owner")]
  [InlineData("tasks", "fk_tasks_owner")]
  public async Task OwnerId_IsANonNullForeignKeyToUsers(string table, string constraint)
  {
    await using CalendarDbContext db = Postgres.Database.CreateMigratorContext();

    var nullable = await db.Database.SqlQuery<string>(
        $"""
        SELECT is_nullable AS "Value" FROM information_schema.columns
        WHERE table_name = {table} AND column_name = 'owner_id'
        """).SingleAsync(Ct);
    nullable.ShouldBe("NO");

    var definition = await db.Database.SqlQuery<string>(
        $"SELECT pg_get_constraintdef(oid) AS \"Value\" FROM pg_constraint WHERE conname = {constraint}").SingleAsync(Ct);
    definition.ShouldBe("FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT");

    // Events need their shape columns too; tasks ignore them (UndefinedColumn) only if the FK check did not fire first.
    var insert = table == "events"
      ? "INSERT INTO events (id, owner_id, title, is_all_day, start_date, end_date) "
        + "VALUES (gen_random_uuid(), gen_random_uuid(), 'orphan', true, '2026-10-26', '2026-10-27')"
      : "INSERT INTO tasks (id, owner_id, title) VALUES (gen_random_uuid(), gen_random_uuid(), 'orphan')";
#pragma warning disable EF1003 // fixed literals chosen above, not user input
    PostgresException ex = await Should.ThrowAsync<PostgresException>(async () => await db.Database.ExecuteSqlRawAsync(insert, Ct));
#pragma warning restore EF1003
    ex.SqlState.ShouldBe(PostgresErrorCodes.ForeignKeyViolation);
  }

  [Fact]
  public async Task Task_WithBothDueValues_IsRejected()
  {
    await using CalendarDbContext db = Postgres.Database.CreateMigratorContext();

    PostgresException ex = await Should.ThrowAsync<PostgresException>(async () => await db.Database.ExecuteSqlAsync(
        $"INSERT INTO tasks (id, owner_id, title, due_date, due_at) VALUES (gen_random_uuid(), {UserA}, 't', '2026-10-26', now())",
        Ct));

    ex.SqlState.ShouldBe(PostgresErrorCodes.CheckViolation);
    ex.ConstraintName.ShouldBe("ck_tasks_due_date_xor_due_at");
  }

  [Theory]
  // timed with a time zone missing and dates set
  [InlineData("(gen_random_uuid(), 'e', false, now(), now() + interval '1 hour', NULL, '2026-10-26', '2026-10-27')")]
  [InlineData("(gen_random_uuid(), 'e', false, now(), now() - interval '1 hour', 'UTC', NULL, NULL)")] // ends before it starts
  [InlineData("(gen_random_uuid(), 'e', true, NULL, NULL, NULL, '2026-10-26', '2026-10-26')")] // empty all-day span
  [InlineData("(gen_random_uuid(), 'e', true, now(), now() + interval '1 hour', 'UTC', '2026-10-26', '2026-10-27')")] // both kinds
  [InlineData("(gen_random_uuid(), '  ', true, NULL, NULL, NULL, '2026-10-26', '2026-10-27')")] // blank title
  public async Task Event_ViolatingTheShapeRules_IsRejected(string values)
  {
    await using CalendarDbContext db = Postgres.Database.CreateMigratorContext();

#pragma warning disable EF1003 // values are fixed literals from the InlineData above, not user input
    PostgresException ex = await Should.ThrowAsync<PostgresException>(async () => await db.Database.ExecuteSqlRawAsync(
        "INSERT INTO events (id, owner_id, title, is_all_day, starts_at, ends_at, time_zone_id, start_date, end_date) VALUES "
        + values.Replace("(gen_random_uuid(), ", $"(gen_random_uuid(), '{UserA}', ", StringComparison.Ordinal),
        Ct));
#pragma warning restore EF1003

    // An inverted span is refused by the generated range column (data_exception) before the check constraint runs.
    ex.SqlState.ShouldBeOneOf(PostgresErrorCodes.CheckViolation, PostgresErrorCodes.DataException);
  }

  [Fact]
  public async Task EventSpan_IsAGistIndexedGeneratedRange_OnlyForTimedEvents()
  {
    await using CalendarDbContext db = Postgres.Database.CreateMigratorContext();

    var gist = await db.Database.SqlQueryRaw<string>(
        "SELECT indexdef AS \"Value\" FROM pg_indexes WHERE tablename = 'events' AND indexname = 'ix_events_span'").SingleAsync(Ct);
    gist.ShouldContain("USING gist (span)");

    await db.Database.ExecuteSqlAsync(
        $"""
        INSERT INTO events (id, owner_id, title, is_all_day, starts_at, ends_at, time_zone_id)
        VALUES (gen_random_uuid(), {UserA}, 'timed', false, '2026-10-26T10:00Z', '2026-10-26T11:00Z', 'UTC')
        """,
        Ct);
    await db.Database.ExecuteSqlAsync(
        $"""
        INSERT INTO events (id, owner_id, title, is_all_day, start_date, end_date)
        VALUES (gen_random_uuid(), {UserA}, 'day', true, '2026-10-26', '2026-10-27')
        """,
        Ct);

    List<string> spans = await db.Database
      .SqlQueryRaw<string>("SELECT COALESCE(span::text, 'NULL') AS \"Value\" FROM events ORDER BY is_all_day")
      .ToListAsync(Ct);
    spans.ShouldBe(["[\"2026-10-26 10:00:00+00\",\"2026-10-26 11:00:00+00\")", "NULL"]);
  }

  [Fact]
  public async Task EventDateSpan_IsAPartialGistIndexedGeneratedRange_OnlyForAllDayEvents()
  {
    await using CalendarDbContext db = Postgres.Database.CreateMigratorContext();

    var gist = await db.Database.SqlQueryRaw<string>(
        "SELECT indexdef AS \"Value\" FROM pg_indexes WHERE tablename = 'events' AND indexname = 'ix_events_date_span'").SingleAsync(Ct);
    gist.ShouldContain("USING gist (date_span) WHERE is_all_day");

    await db.Database.ExecuteSqlAsync(
        $"""
        INSERT INTO events (id, owner_id, title, is_all_day, starts_at, ends_at, time_zone_id)
        VALUES (gen_random_uuid(), {UserA}, 'timed', false, '2026-10-26T10:00Z', '2026-10-26T11:00Z', 'UTC')
        """,
        Ct);
    await db.Database.ExecuteSqlAsync(
        $"""
        INSERT INTO events (id, owner_id, title, is_all_day, start_date, end_date)
        VALUES (gen_random_uuid(), {UserA}, 'days', true, '2026-10-26', '2026-10-28')
        """,
        Ct);

    List<string> spans = await db.Database
      .SqlQueryRaw<string>("SELECT COALESCE(date_span::text, 'NULL') AS \"Value\" FROM events ORDER BY is_all_day")
      .ToListAsync(Ct);
    spans.ShouldBe(["NULL", "[2026-10-26,2026-10-28)"]);
  }

  [Fact]
  public async Task AppRole_CannotChangeTheSchema()
  {
    await using CalendarDbContext db = Postgres.Database.CreateAppContext();

    PostgresException ex = await Should.ThrowAsync<PostgresException>(
      async () => await db.Database.ExecuteSqlRawAsync("DROP TABLE tasks", Ct));

    ex.SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege);
  }
}
