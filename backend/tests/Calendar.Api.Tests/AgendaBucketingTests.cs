using Calendar.Api.Contracts;
using Calendar.Api.Endpoints;
using Calendar.Domain.Agenda;
using Calendar.Domain.Time;

namespace Calendar.Api.Tests;

/// <summary>Placing items by day index gives the same days as testing every item against every day (issue #55).</summary>
public sealed class AgendaBucketingTests
{
  [Theory]
  [InlineData("America/New_York", 2026, 3, 6)]
  [InlineData("America/New_York", 2026, 10, 30)]
  [InlineData("Pacific/Apia", 2011, 12, 28)]
  public void IndexedBucketsMatchPerDayFiltering(string zoneId, int year, int month, int day)
  {
    var range = DateRangeWindow.Create(new DateOnly(year, month, day), 7, TimeZoneInfo.FindSystemTimeZoneById(zoneId));
    var random = new Random(55);
    var instants = range.Days.SelectMany(d => new[] { d.Start, d.End, d.Start.AddTicks(-1), d.Start.AddTicks(1) })
        .Concat(Enumerable.Range(0, 200).Select(_ => range.Start.AddMinutes(random.Next(-2880, 14400)))).ToArray();
    var events = Enumerable.Range(0, 500).Select(i =>
    {
      var start = instants[random.Next(instants.Length)];
      var end = i % 5 == 0 ? start : instants[random.Next(instants.Length)];
      if (end < start)
      {
        (start, end) = (end, start);
      }

      return new TimedEventItem
      {
        Id = Guid.NewGuid(),
        Title = $"Event {i % 8}",
        Start = start,
        End = end,
        TimeZone = zoneId,
        StartsBeforeDay = false,
        EndsAfterDay = false,
        HasNotes = false
      };
    }).ToArray();
    var tasks = Enumerable.Range(0, 500).Select(i => new AgendaTaskItem
    {
      Id = Guid.NewGuid(),
      Title = $"Task {i % 8}",
      IsCompleted = false,
      HasNotes = false,
      DueDate = i % 3 == 0 ? range.StartDate.AddDays(random.Next(-2, 9)) : null,
      DueAt = i % 3 != 0 ? instants[random.Next(instants.Length)] : null,
    }).ToArray();

    var actual = AgendaBuilder.Bucket(range, events, tasks);
    for (var i = 0; i < range.Days.Count; i++)
    {
      var window = range.Days[i];
      var expectedEvents = events.Where(e => DayInclusion.TimedEventOverlaps(e.Start, e.End, window))
          .Select(e => e with { StartsBeforeDay = e.Start < window.Start, EndsAfterDay = e.End > window.End })
          .Order(AgendaOrder.TimedEvents).ToArray();
      var expectedTasks = tasks.Where(t => DayInclusion.IsDueOn(t.DueDate, t.DueAt, window))
          .Order(AgendaOrder.DueTasks).ToArray();
      actual[i].Window.ShouldBe(window);
      actual[i].Events.ShouldBe(expectedEvents);
      actual[i].Tasks.ShouldBe(expectedTasks);
    }
  }
}
