using System.Globalization;
using Calendar.Api.Contracts;
using Calendar.Domain.Events;
using Calendar.Domain.Tasks;
using Calendar.Domain.Time;

namespace Calendar.Api.Tests;

/// <summary>
/// The week and day read models must never disagree: for rows arranged on and around every day edge of a week,
/// in ordinary, DST, skipped-midnight and skipped-date weeks, <c>days[i]</c> of the week equals the day agenda for
/// <c>weekStart + i</c>, item for item and in the same order.
/// </summary>
public sealed class WeekAgendaAgreementTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
  public static TheoryData<string, string> Scenarios => new()
    {
        { "2026-10-28", "UTC" },
        { "2026-10-28", "Asia/Kolkata" },
        { "2026-10-28", "America/New_York" }, // falls back on Sunday 2026-11-01
        { "2026-03-08", "America/New_York" }, // springs forward on Sunday 2026-03-08
        { "2026-10-25", "Europe/Berlin" }, // falls back on Sunday 2026-10-25
        { "2026-09-06", "America/Santiago" }, // skips midnight on Sunday 2026-09-06
        { "2011-12-30", "Pacific/Apia" }, // skips Friday 2011-12-30 entirely
        { "2026-10-28", "Pacific/Kiritimati" },
    };

  [Theory]
  [MemberData(nameof(Scenarios))]
  public async Task EachDayOfTheWeek_EqualsTheDayAgenda(string dateText, string zoneId)
  {
    var range = DateRangeWindow.IsoWeek(DateOnly.Parse(dateText, CultureInfo.InvariantCulture), TimeZones.FindIana(zoneId));
    var weekStart = Text(range.StartDate);
    await SeedAsync(BuildEvents(range, zoneId), BuildTasks(range));

    // With today on the Monday, the week's overdue list is the Monday's: nothing due in the week is overdue yet.
    WeekAgendaResponse week = await GetWeekAgendaAsync(dateText, zoneId, weekStart);

    week.WeekStart.ShouldBe(range.StartDate);
    week.Days.Count.ShouldBe(7);
    for (var i = 0; i < 7; i++)
    {
      DateOnly date = range.StartDate.AddDays(i);
      DayAgendaResponse day = await GetAgendaAsync(Text(date), zoneId);

      week.Days[i].Date.ShouldBe(day.Date);
      week.Days[i].Window.ShouldBe(day.Window);
      week.Days[i].Events.ShouldBe(day.Events, $"events on {Text(date)}");
      week.Days[i].Tasks.ShouldBe(day.Tasks.DueToday, $"tasks on {Text(date)}");
      week.AllDayEvents.Where(e => e.StartDate <= date && e.EndDate > date).ShouldBe(day.AllDayEvents, $"all-day events on {Text(date)}");

      if (i == 0)
      {
        week.Overdue.ShouldNotBeNull().ShouldBe(day.Tasks.Overdue);
        day.Tasks.Overdue.ShouldNotBeEmpty();
      }
    }

    // The scenario must place things on several days, or the comparison proves little.
    week.Days.Count(d => d.Events.Count > 0).ShouldBeGreaterThan(4);
    week.Days.Count(d => d.Tasks.Count > 0).ShouldBe(7);
    week.AllDayEvents.ShouldNotBeEmpty();
  }

  private static string Text(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

  /// <summary>Instants on and around every day edge, and the middle of each day (whole seconds: PostgreSQL keeps microseconds).</summary>
  private static DateTimeOffset[] EdgePoints(DateRangeWindow range)
  {
    var points = new List<DateTimeOffset> { range.Start.AddHours(-26), range.End.AddSeconds(1), range.End.AddHours(26) };
    foreach (DayWindow day in range.Days)
    {
      points.AddRange([day.Start.AddSeconds(-1), day.Start, day.Start.AddSeconds(1), day.End]);
      if (day.Length > TimeSpan.FromHours(2))
      {
        points.Add(day.Start + (day.Length / 2));
      }
    }

    return [.. points.Distinct().Order()];
  }

  private static List<CalendarEvent> BuildEvents(DateRangeWindow range, string zoneId)
  {
    DateTimeOffset[] points = EdgePoints(range);
    var events = new List<CalendarEvent>();
    for (var i = 0; i < points.Length; i++)
    {
      // Short events near each point, events crossing one or two day edges, and a few long ones.
      foreach (var j in new[] { i + 1, i + 2, i + 4, i + 9, points.Length - 1 }.Distinct().Where(j => j > i && j < points.Length))
      {
        events.Add(CalendarEvent.Create($"timed {i}-{j}", points[i], points[j], zoneId));
        events.Add(CalendarEvent.Create($"Timed {i}-{j}", points[i], points[j], zoneId)); // ties broken by id
      }
    }

    for (var start = -2; start <= 8; start++)
    {
      foreach (var length in new[] { 1, 2, 9 })
      {
        events.Add(CalendarEvent.CreateAllDay(
          $"all-day {start}+{length}",
          range.StartDate.AddDays(start),
          range.StartDate.AddDays(start + length)));
      }
    }

    return events;
  }

  private static List<TodoTask> BuildTasks(DateRangeWindow range)
  {
    DateTimeOffset[] points = EdgePoints(range);
    DayWindow monday = range.Days[0];
    DateTimeOffset?[] completions = [null, monday.Start.AddSeconds(-1), monday.Start, monday.Start.AddHours(1), monday.End, range.End];
    var tasks = new List<TodoTask>();
    foreach (DateTimeOffset? completedAt in completions)
    {
      for (var offset = -2; offset <= 8; offset++)
      {
        tasks.Add(Task($"date {offset}", range.StartDate.AddDays(offset), null, completedAt));
      }

      foreach (DateTimeOffset dueAt in points)
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
