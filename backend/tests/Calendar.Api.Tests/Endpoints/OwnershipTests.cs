using System.Net;
using System.Net.Http.Json;
using Calendar.Api.Contracts;
using Calendar.Domain.Events;
using Calendar.Domain.Tasks;
using Calendar.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace Calendar.Api.Tests.Endpoints;

/// <summary>
/// Story 0017, ADR-0041: every endpoint sees only the signed-in user's rows, and another user's id answers as if
/// it did not exist. <see cref="ApiTestBase.Client"/> acts as user A; <c>ClientAs(UserB)</c> as user B.
/// </summary>
public sealed class OwnershipTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
  private const string Zone = "UTC";
  private static readonly DateOnly Today = new(2026, 10, 26);

  [Fact]
  public async Task DayAndWeekAgendas_ShowOnlyTheCallersRows()
  {
    await SeedBothUsersAsync();

    DayAgendaResponse dayA = await GetAgendaAsync("2026-10-26", Zone);
    dayA.AllDayEvents.Select(e => e.Title).ShouldBe(["A all-day"]);
    dayA.Events.Select(e => e.Title).ShouldBe(["A timed"]);
    dayA.Tasks.DueToday.Select(t => t.Title).ShouldBe(["A due today"]);
    dayA.Tasks.Overdue.Select(t => t.Title).ShouldBe(["A overdue"]);
    dayA.Tasks.OverdueTotal.ShouldBe(1);
    dayA.Tasks.OverdueOpenTotal.ShouldBe(1);

    using HttpClient asB = ClientAs(UserB);
    using HttpResponseMessage response = await asB.GetAsync(
      new Uri($"/api/agenda/day?date=2026-10-26&timeZone={Zone}", UriKind.Relative),
      Ct);
    DayAgendaResponse dayB = (await response.Content.ReadFromJsonAsync<DayAgendaResponse>(Ct))!;
    dayB.AllDayEvents.Select(e => e.Title).ShouldBe(["B all-day"]);
    dayB.Events.Select(e => e.Title).ShouldBe(["B timed"]);
    dayB.Tasks.DueToday.Select(t => t.Title).ShouldBe(["B due today"]);
    dayB.Tasks.Overdue.Select(t => t.Title).ShouldBe(["B overdue"]);
    dayB.Tasks.OverdueTotal.ShouldBe(1);

    WeekAgendaResponse weekA = await GetWeekAgendaAsync("2026-10-26", Zone, "2026-10-26");
    weekA.AllDayEvents.Select(e => e.Title).ShouldBe(["A all-day"]);
    weekA.Days.SelectMany(d => d.Events).Select(e => e.Title).ShouldBe(["A timed"]);
    // "A upcoming" is due five days later, still inside the ISO week.
    weekA.Days.SelectMany(d => d.Tasks).Select(t => t.Title).ShouldBe(["A due today", "A upcoming"]);
    weekA.Overdue!.Select(t => t.Title).ShouldBe(["A overdue"]);
    weekA.OverdueTotal.ShouldBe(1);
  }

  [Theory]
  [InlineData("upcoming")]
  [InlineData("overdue")]
  [InlineData("completed")]
  [InlineData("no-deadline")]
  public async Task TaskListViews_ShowOnlyTheCallersRows(string view)
  {
    await SeedBothUsersAsync();

    TaskPage pageA = await ListAsync(Client, view);
    pageA.Items.Select(t => t.Title).ShouldAllBe(title => title.StartsWith("A ", StringComparison.Ordinal));
    pageA.Items.ShouldNotBeEmpty();
    if (view == "overdue")
    {
      pageA.Total.ShouldBe(1);
    }

    using HttpClient asB = ClientAs(UserB);
    TaskPage pageB = await ListAsync(asB, view);
    pageB.Items.Select(t => t.Title).ShouldAllBe(title => title.StartsWith("B ", StringComparison.Ordinal));
    pageB.Items.Count.ShouldBe(pageA.Items.Count);
  }

  [Fact]
  public async Task AnotherUsersEvent_IsNotFound_AndTheOwnersIsFound()
  {
    var eventOfB = CalendarEvent.Create(UserB, "B timed", Utc(2026, 10, 26, 10), Utc(2026, 10, 26, 11), Zone);
    await SeedAsync(events: [eventOfB]);

    using HttpResponseMessage asA = await Client.GetAsync(new Uri($"/api/events/{eventOfB.Id}", UriKind.Relative), Ct);
    asA.StatusCode.ShouldBe(HttpStatusCode.NotFound);

    using HttpClient clientB = ClientAs(UserB);
    using HttpResponseMessage asB = await clientB.GetAsync(new Uri($"/api/events/{eventOfB.Id}", UriKind.Relative), Ct);
    asB.StatusCode.ShouldBe(HttpStatusCode.OK);
  }

  [Fact]
  public async Task CreatedRows_BelongToTheCaller()
  {
    using HttpClient asB = ClientAs(UserB);
    using HttpResponseMessage createdEvent = await asB.PostAsJsonAsync(
      new Uri("/api/events", UriKind.Relative),
      new { title = "B's event", allDay = true, startDate = "2026-10-26", endDate = "2026-10-27" },
      Ct);
    using HttpResponseMessage createdTask = await asB.PostAsJsonAsync(
      new Uri("/api/tasks", UriKind.Relative),
      new { title = "B's task" },
      Ct);
    createdEvent.StatusCode.ShouldBe(HttpStatusCode.Created);
    createdTask.StatusCode.ShouldBe(HttpStatusCode.Created);
    Guid eventId = (await createdEvent.Content.ReadFromJsonAsync<EventResponse>(Ct))!.Id;
    Guid taskId = (await createdTask.Content.ReadFromJsonAsync<TaskResponse>(Ct))!.Id;

    await using CalendarDbContext db = Postgres.Database.CreateMigratorContext();
    (await db.Events.IgnoreQueryFilters().SingleAsync(e => e.Id == eventId, Ct)).OwnerId.ShouldBe(UserB);
    (await db.Tasks.IgnoreQueryFilters().SingleAsync(t => t.Id == taskId, Ct)).OwnerId.ShouldBe(UserB);

    // The creator sees them; user A does not.
    (await asB.GetAsync(new Uri($"/api/events/{eventId}", UriKind.Relative), Ct)).StatusCode.ShouldBe(HttpStatusCode.OK);
    (await Client.GetAsync(new Uri($"/api/events/{eventId}", UriKind.Relative), Ct)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    (await Client.GetAsync(new Uri($"/api/tasks/{taskId}", UriKind.Relative), Ct)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
  }

  [Fact]
  public async Task AnotherUsersTask_IsNotFoundForReadCompleteReopenAndDelete_AndStaysUnchanged()
  {
    var open = TodoTask.Create(UserB, "B open", dueDate: Today);
    TodoTask completed = CompletedTask(UserB, "B completed", Today, Utc(2026, 10, 25, 12));
    await SeedAsync(tasks: [open, completed]);

    (await Client.GetAsync(new Uri($"/api/tasks/{open.Id}", UriKind.Relative), Ct)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    (await Client.PostAsync(new Uri($"/api/tasks/{open.Id}/complete", UriKind.Relative), null, Ct)).StatusCode
      .ShouldBe(HttpStatusCode.NotFound);
    (await Client.PostAsync(new Uri($"/api/tasks/{completed.Id}/reopen", UriKind.Relative), null, Ct)).StatusCode
      .ShouldBe(HttpStatusCode.NotFound);
    (await Client.DeleteAsync(new Uri($"/api/tasks/{open.Id}", UriKind.Relative), Ct)).StatusCode.ShouldBe(HttpStatusCode.NotFound);

    await using CalendarDbContext db = Postgres.Database.CreateMigratorContext();
    List<TodoTask> rows = await db.Tasks.IgnoreQueryFilters().OrderBy(t => t.Title).ToListAsync(Ct);
    rows.Select(t => (t.Title, t.IsCompleted)).ShouldBe([("B completed", true), ("B open", false)]);

    // The owner can do all of it.
    using HttpClient asB = ClientAs(UserB);
    (await asB.PostAsync(new Uri($"/api/tasks/{open.Id}/complete", UriKind.Relative), null, Ct)).StatusCode.ShouldBe(HttpStatusCode.OK);
    (await asB.PostAsync(new Uri($"/api/tasks/{completed.Id}/reopen", UriKind.Relative), null, Ct)).StatusCode.ShouldBe(HttpStatusCode.OK);
    (await asB.DeleteAsync(new Uri($"/api/tasks/{open.Id}", UriKind.Relative), Ct)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
  }

  [Fact]
  public async Task BulkByIds_ReportsAnotherUsersTasksAsNotFound_AndLeavesThemUnchanged()
  {
    var mine = TodoTask.Create(UserA, "A open", dueDate: Today);
    var theirs = TodoTask.Create(UserB, "B open", dueDate: Today);
    await SeedAsync(tasks: [mine, theirs]);

    using HttpResponseMessage response = await Client.PostAsJsonAsync(
      new Uri("/api/tasks/bulk", UriKind.Relative),
      new { action = "complete", ids = new[] { mine.Id, theirs.Id } },
      Ct);
    response.StatusCode.ShouldBe(HttpStatusCode.OK);
    BulkTaskResponse body = (await response.Content.ReadFromJsonAsync<BulkTaskResponse>(Ct))!;
    body.Results.Select(r => (r.Id, r.Outcome)).ShouldBe([(mine.Id, "applied"), (theirs.Id, "notFound")]);
    body.Applied.ShouldBe(1);
    body.NotFound.ShouldBe(1);

    await using CalendarDbContext db = Postgres.Database.CreateMigratorContext();
    (await db.Tasks.IgnoreQueryFilters().SingleAsync(t => t.Id == theirs.Id, Ct)).IsCompleted.ShouldBeFalse();
    (await db.Tasks.IgnoreQueryFilters().SingleAsync(t => t.Id == mine.Id, Ct)).IsCompleted.ShouldBeTrue();
  }

  [Fact]
  public async Task BulkByFilter_OnlyTouchesTheCallersOverdueTasks()
  {
    var mine = TodoTask.Create(UserA, "A overdue", dueDate: Today.AddDays(-1));
    var theirs = TodoTask.Create(UserB, "B overdue", dueDate: Today.AddDays(-1));
    var theirsToo = TodoTask.Create(UserB, "B overdue too", dueDate: Today.AddDays(-2));
    await SeedAsync(tasks: [mine, theirs, theirsToo]);

    // The count guard is per caller too: A sees one overdue task, not three.
    (await ListAsync(Client, "overdue")).Total.ShouldBe(1);
    using HttpResponseMessage response = await Client.PostAsJsonAsync(
      new Uri("/api/tasks/bulk", UriKind.Relative),
      new { action = "delete", filter = new { view = "overdue", today = "2026-10-26", timeZone = Zone, expectedTotal = 1 } },
      Ct);
    response.StatusCode.ShouldBe(HttpStatusCode.OK);
    (await response.Content.ReadFromJsonAsync<BulkTaskResponse>(Ct))!.Applied.ShouldBe(1);

    await using CalendarDbContext db = Postgres.Database.CreateMigratorContext();
    List<string> remaining = await db.Tasks.IgnoreQueryFilters().OrderBy(t => t.Title).Select(t => t.Title).ToListAsync(Ct);
    remaining.ShouldBe(["B overdue", "B overdue too"]);
  }

  private static TodoTask CompletedTask(Guid owner, string title, DateOnly? dueDate, DateTimeOffset completedAt)
  {
    var task = TodoTask.Create(owner, title, dueDate);
    task.Complete(completedAt);
    return task;
  }

  private static async Task<TaskPage> ListAsync(HttpClient client, string view)
  {
    var query = view is "upcoming" or "overdue" ? $"view={view}&today=2026-10-26&timeZone={Zone}" : $"view={view}";
    using HttpResponseMessage response = await client.GetAsync(new Uri($"/api/tasks?{query}", UriKind.Relative), Ct);
    response.StatusCode.ShouldBe(HttpStatusCode.OK);
    return (await response.Content.ReadFromJsonAsync<TaskPage>(Ct))!;
  }

  /// <summary>The same shape of data for both users: one of each kind, titled with the owner's letter.</summary>
  private async Task SeedBothUsersAsync()
  {
    List<CalendarEvent> events = [];
    List<TodoTask> tasks = [];
    foreach ((Guid owner, var letter) in new[] { (UserA, "A"), (UserB, "B") })
    {
      events.Add(CalendarEvent.CreateAllDay(owner, $"{letter} all-day", Today, Today.AddDays(1)));
      events.Add(CalendarEvent.Create(owner, $"{letter} timed", Utc(2026, 10, 26, 10), Utc(2026, 10, 26, 11), Zone));
      tasks.Add(TodoTask.Create(owner, $"{letter} due today", dueDate: Today));
      tasks.Add(TodoTask.Create(owner, $"{letter} overdue", dueDate: Today.AddDays(-3)));
      tasks.Add(TodoTask.Create(owner, $"{letter} upcoming", dueDate: Today.AddDays(5)));
      tasks.Add(TodoTask.Create(owner, $"{letter} no deadline"));
      tasks.Add(CompletedTask(owner, $"{letter} completed", Today.AddDays(-10), Utc(2026, 10, 20, 9)));
    }

    await SeedAsync(events, tasks);
  }
}
