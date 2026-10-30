using System.Net.Http.Json;
using Calendar.Api.Contracts;
using Calendar.Domain.Events;
using Calendar.Domain.Tasks;
using Calendar.Infrastructure;
using Microsoft.Extensions.Time.Testing;

namespace Calendar.Api.Tests;

/// <summary>
/// Starts the API on the shared PostgreSQL container with a controllable clock (2026-10-26T15:00Z) and
/// empties the tables before each test.
/// </summary>
// All tests that write share one database, so their classes run one at a time.
[Collection("Database")]
public abstract class ApiTestBase(PostgresFixture postgres) : IAsyncLifetime
{
  protected FakeTimeProvider Clock { get; } = new(new DateTimeOffset(2026, 10, 26, 15, 0, 0, TimeSpan.Zero));

  protected PostgresFixture Postgres { get; } = postgres;

  protected CalendarApiFactory Factory { get; private set; } = null!;

  protected HttpClient Client { get; private set; } = null!;

  protected static CancellationToken Ct => TestContext.Current.CancellationToken;

  public async ValueTask InitializeAsync()
  {
    await Postgres.Database.ResetAsync(Ct);
    Factory = new CalendarApiFactory(Postgres.Database, Clock);
    Client = Factory.CreateClient();
  }

  public async ValueTask DisposeAsync()
  {
    Client.Dispose();
    await Factory.DisposeAsync();
    await Postgres.Database.ResetAsync(CancellationToken.None);
    GC.SuppressFinalize(this);
  }

  protected static DateTimeOffset Utc(int year, int month, int day, int hour = 0, int minute = 0) =>
      new(year, month, day, hour, minute, 0, TimeSpan.Zero);

  /// <summary>Inserts rows directly (as the schema owner), bypassing the API, to arrange exact states.</summary>
  protected async Task SeedAsync(IEnumerable<CalendarEvent>? events = null, IEnumerable<TodoTask>? tasks = null)
  {
    await using CalendarDbContext db = Postgres.Database.CreateMigratorContext();
    db.Events.AddRange(events ?? []);
    db.Tasks.AddRange(tasks ?? []);
    await db.SaveChangesAsync(Ct);
  }

  protected static TodoTask CompletedTask(string title, DateOnly? dueDate, DateTimeOffset completedAt, DateTimeOffset? dueAt = null)
  {
    var task = TodoTask.Create(title, dueDate, dueAt);
    task.Complete(completedAt);
    return task;
  }

  protected async Task<DayAgendaResponse> GetAgendaAsync(string date, string zone)
  {
    using HttpResponseMessage response = await Client.GetAsync(
        new Uri($"/api/agenda/day?date={date}&timeZone={Uri.EscapeDataString(zone)}", UriKind.Relative),
        Ct);
    response.EnsureSuccessStatusCode();
    return (await response.Content.ReadFromJsonAsync<DayAgendaResponse>(Ct))!;
  }

  protected async Task<WeekAgendaResponse> GetWeekAgendaAsync(string date, string zone, string today)
  {
    using HttpResponseMessage response = await Client.GetAsync(
        new Uri($"/api/agenda/week?date={date}&timeZone={Uri.EscapeDataString(zone)}&today={today}", UriKind.Relative),
        Ct);
    response.EnsureSuccessStatusCode();
    return (await response.Content.ReadFromJsonAsync<WeekAgendaResponse>(Ct))!;
  }
}
