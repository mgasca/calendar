using Calendar.Domain.Events;
using Calendar.Domain.Tasks;
using Calendar.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace Calendar.Api.Tests;

/// <summary>
/// The context-level guarantees of ADR-0041: a context with a user sees and saves only that user's rows, and a
/// context without one sees nothing.
/// </summary>
public sealed class CalendarDbContextOwnershipTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
  private static readonly DateOnly Day = new(2026, 10, 26);

  [Fact]
  public async Task AContextWithAUser_SeesOnlyThatUsersRows_AndOneWithout_SeesNothing()
  {
    await SeedAsync(
      [CalendarEvent.CreateAllDay(UserA, "A", Day, Day.AddDays(1)), CalendarEvent.CreateAllDay(UserB, "B", Day, Day.AddDays(1))],
      [TodoTask.Create(UserA, "A"), TodoTask.Create(UserB, "B")]);

    await using CalendarDbContext asA = AppContext(new FixedCurrentUser(UserA));
    (await asA.Tasks.Select(t => t.Title).ToListAsync(Ct)).ShouldBe(["A"]);
    (await asA.Events.Select(e => e.Title).ToListAsync(Ct)).ShouldBe(["A"]);
    (await asA.Tasks.CountAsync(Ct)).ShouldBe(1);

    await using CalendarDbContext nobody = AppContext(FixedCurrentUser.None);
    (await nobody.Tasks.CountAsync(Ct)).ShouldBe(0);
    (await nobody.Events.CountAsync(Ct)).ShouldBe(0);
    (await nobody.Tasks.IgnoreQueryFilters().CountAsync(Ct)).ShouldBe(2);

    // The migrator context has no user either: that is how the tests arrange rows for several users.
    await using CalendarDbContext migrator = Database.CreateMigratorContext();
    (await migrator.Events.CountAsync(Ct)).ShouldBe(0);
  }

  [Fact]
  public async Task AContextWithAUser_RefusesToSaveARowOwnedByAnyoneElse_OnEveryOverload()
  {
    await using CalendarDbContext asA = AppContext(new FixedCurrentUser(UserA));

    asA.Tasks.Add(TodoTask.Create(UserB, "theirs"));
    await Should.ThrowAsync<InvalidOperationException>(() => asA.SaveChangesAsync(Ct));
    await Should.ThrowAsync<InvalidOperationException>(() => asA.SaveChangesAsync(acceptAllChangesOnSuccess: false, Ct));
    Should.Throw<InvalidOperationException>(() => asA.SaveChanges());
    Should.Throw<InvalidOperationException>(() => asA.SaveChanges(acceptAllChangesOnSuccess: false));
    asA.ChangeTracker.Clear();

    asA.Events.Add(CalendarEvent.CreateAllDay(UserB, "theirs", Day, Day.AddDays(1)));
    await Should.ThrowAsync<InvalidOperationException>(() => asA.SaveChangesAsync(Ct));
    asA.ChangeTracker.Clear();

    asA.Tasks.Add(TodoTask.Create(UserA, "mine"));
    (await asA.SaveChangesAsync(Ct)).ShouldBe(1);

    await using CalendarDbContext migrator = Database.CreateMigratorContext();
    (await migrator.Tasks.IgnoreQueryFilters().Select(t => t.Title).ToListAsync(Ct)).ShouldBe(["mine"]);
    (await migrator.Events.IgnoreQueryFilters().CountAsync(Ct)).ShouldBe(0);
  }

  private CalendarDbContext AppContext(ICurrentUser user) =>
    new(CalendarDbContextOptions.Create(Database.AppConnectionString).Options, user);
}
