using System.Net.Http.Json;
using Calendar.Api.Contracts;
using Calendar.Domain.Events;
using Calendar.Domain.Tasks;
using Calendar.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Time.Testing;

namespace Calendar.Api.Tests;

/// <summary>
/// Starts the API on the shared PostgreSQL container with a controllable clock (2026-10-26T15:00Z) and
/// empties the tables before each test. Two users exist: <see cref="Client"/> acts as <see cref="UserA"/>
/// (also <see cref="Owner"/>, the owner of everything <see cref="SeedAsync"/> inserts by default), and
/// <see cref="ClientAs"/> gives a client for another user, such as <see cref="UserB"/>.
/// </summary>
// All tests that write share one database, so their classes run one at a time.
[Collection("Database")]
public abstract class ApiTestBase(PostgresFixture postgres) : IAsyncLifetime
{
  public const string UserAEmail = "a@example.com";
  public const string UserBEmail = "b@example.com";

  /// <summary>The user every request acts as unless it says otherwise.</summary>
  public static readonly Guid UserA = new("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

  /// <summary>A second user, for cross-user tests.</summary>
  public static readonly Guid UserB = new("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

  /// <summary>The owner of rows the tests arrange: <see cref="UserA"/>.</summary>
  protected static readonly Guid Owner = UserA;

  protected FakeTimeProvider Clock { get; } = new(new DateTimeOffset(2026, 10, 26, 15, 0, 0, TimeSpan.Zero));

  protected PostgresFixture Postgres { get; } = postgres;

  protected CalendarApiFactory Factory { get; private set; } = null!;

  protected HttpClient Client { get; private set; } = null!;

  protected static CancellationToken Ct => TestContext.Current.CancellationToken;

  public async ValueTask InitializeAsync()
  {
    await Postgres.Database.ResetAsync(Ct);
    await using (CalendarDbContext db = Postgres.Database.CreateMigratorContext())
    {
      await db.Database.ExecuteSqlAsync(
        $"INSERT INTO users (id, email, created_at) VALUES ({UserA}, {UserAEmail}, now()), ({UserB}, {UserBEmail}, now())",
        Ct);
    }

    Factory = new CalendarApiFactory(Postgres.Database, Clock);
    Client = Factory.CreateClient();
  }

  /// <summary>A client whose requests act as <paramref name="user"/>.</summary>
  protected HttpClient ClientAs(Guid user)
  {
    HttpClient client = Factory.CreateClient();
    client.DefaultRequestHeaders.Add(FakeAuthenticationHandler.UserHeader, user.ToString());
    return client;
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

  /// <summary>
  /// Inserts rows directly (as the schema owner, whose context has no current user and so accepts any owner),
  /// bypassing the API, to arrange exact states.
  /// </summary>
  protected async Task SeedAsync(IEnumerable<CalendarEvent>? events = null, IEnumerable<TodoTask>? tasks = null)
  {
    await using CalendarDbContext db = Postgres.Database.CreateMigratorContext();
    db.Events.AddRange(events ?? []);
    db.Tasks.AddRange(tasks ?? []);
    await db.SaveChangesAsync(Ct);
  }

  protected static TodoTask CompletedTask(string title, DateOnly? dueDate, DateTimeOffset completedAt, DateTimeOffset? dueAt = null)
  {
    var task = TodoTask.Create(Owner, title, dueDate, dueAt);
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
