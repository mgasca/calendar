using Calendar.Domain.Agenda;
using Calendar.Domain.Events;
using Calendar.Domain.Tasks;
using Calendar.Domain.Time;

namespace Calendar.Api.Tests;

/// <summary>
/// The agenda's SQL must select exactly what the pure rules in <see cref="DayInclusion"/> select. This arranges
/// rows on and around every window edge, for ordinary, DST, skipped-midnight and skipped-date days, and compares
/// the API's answer with the domain predicates evaluated in memory.
/// </summary>
public sealed class AgendaAgreementTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
  public static TheoryData<string, string> Scenarios => new()
    {
        { "2026-10-26", "UTC" },
        { "2026-10-26", "Asia/Kolkata" },
        { "2026-11-01", "America/New_York" },
        { "2026-03-08", "America/New_York" },
        { "2026-09-06", "America/Santiago" },
        { "2024-10-06", "America/Asuncion" },
        { "2011-12-30", "Pacific/Apia" },
        { "2026-10-26", "Pacific/Kiritimati" },
    };

  [Theory]
  [MemberData(nameof(Scenarios))]
  public async Task Api_SelectsExactlyWhatDayInclusionSelects(string dateText, string zoneId)
  {
    var date = DateOnly.Parse(dateText, System.Globalization.CultureInfo.InvariantCulture);
    var zone = TimeZones.FindIana(zoneId);
    var window = DayWindow.Create(date, zone);

    await SeedAsync(BuildEvents(date, zoneId, window), BuildTasks(date, window));

    await using var db = Postgres.Database.CreateMigratorContext();
    var events = db.Events.ToList();
    var tasks = db.Tasks.ToList();
    events.Count.ShouldBeGreaterThan(40);

    var agenda = await GetAgendaAsync(dateText, zoneId);

    var expectedAllDay = events.Where(e => e.IsAllDay && DayInclusion.EventOccursOn(e, window)).Select(e => e.Id);
    var expectedTimed = events.Where(e => !e.IsAllDay && DayInclusion.EventOccursOn(e, window)).Select(e => e.Id);
    var expectedDue = tasks.Where(t => DayInclusion.IsIncludedInDay(t, window) && DayInclusion.IsDueToday(t, window)).Select(t => t.Id);
    var expectedOverdue = tasks.Where(t => DayInclusion.IsIncludedInDay(t, window) && DayInclusion.IsOverdue(t, window)).Select(t => t.Id);

    agenda.AllDayEvents.Select(e => e.Id).Order().ShouldBe(expectedAllDay.Order());
    agenda.Events.Select(e => e.Id).Order().ShouldBe(expectedTimed.Order());
    agenda.Tasks.DueToday.Select(t => t.Id).Order().ShouldBe(expectedDue.Order());
    agenda.Tasks.Overdue.Select(t => t.Id).Order().ShouldBe(expectedOverdue.Order());

    // The scenario must actually select and reject things, or the comparison proves nothing.
    if (window.Length > TimeSpan.Zero)
    {
      agenda.Events.ShouldNotBeEmpty();
      agenda.Events.Count.ShouldBeLessThan(events.Count(e => !e.IsAllDay));
    }

    agenda.Tasks.DueToday.ShouldNotBeEmpty();
    agenda.Tasks.Overdue.ShouldNotBeEmpty();
  }

  /// <summary>Instants on and around both edges (whole seconds: PostgreSQL keeps microseconds).</summary>
  private static DateTimeOffset[] EdgePoints(DayWindow window)
  {
    var points = new List<DateTimeOffset>
        {
            window.Start.AddHours(-26), window.Start.AddHours(-1), window.Start.AddSeconds(-1), window.Start, window.Start.AddSeconds(1),
            window.End.AddSeconds(-1), window.End, window.End.AddSeconds(1), window.End.AddHours(1), window.End.AddHours(26),
        };
    if (window.Length > TimeSpan.FromHours(2))
    {
      points.Add(window.Start + (window.Length / 2));
    }

    return [.. points.Distinct().Order()];
  }

  private static List<CalendarEvent> BuildEvents(DateOnly date, string zoneId, DayWindow window)
  {
    var points = EdgePoints(window);
    var events = new List<CalendarEvent>();
    for (var i = 0; i < points.Length; i++)
    {
      for (var j = i + 1; j < points.Length; j++)
      {
        events.Add(CalendarEvent.Create($"timed {i}-{j}", points[i], points[j], zoneId));
      }
    }

    for (var start = -3; start <= 3; start++)
    {
      for (var end = start + 1; end <= 4; end++)
      {
        events.Add(CalendarEvent.CreateAllDay($"all-day {start}..{end}", date.AddDays(start), date.AddDays(end)));
      }
    }

    return events;
  }

  private static List<TodoTask> BuildTasks(DateOnly date, DayWindow window)
  {
    var points = EdgePoints(window);
    DateTimeOffset?[] completions = [null, .. points.Cast<DateTimeOffset?>()];
    var tasks = new List<TodoTask>();
    foreach (var completedAt in completions)
    {
      for (var offset = -2; offset <= 2; offset++)
      {
        tasks.Add(Task($"date {offset}", date.AddDays(offset), null, completedAt));
      }

      foreach (var dueAt in points)
      {
        tasks.Add(Task($"at {dueAt:O}", null, dueAt, completedAt));
      }

      tasks.Add(Task("undated", null, null, completedAt));
    }

    return tasks;
  }

  private static TodoTask Task(string title, DateOnly? dueDate, DateTimeOffset? dueAt, DateTimeOffset? completedAt)
  {
    var task = TodoTask.Create(title, dueDate, dueAt);
    if (completedAt is { } at)
    {
      task.Complete(at);
    }

    return task;
  }
}
