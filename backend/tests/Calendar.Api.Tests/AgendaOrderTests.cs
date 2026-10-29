using Calendar.Api.Contracts;
using Calendar.Api.Endpoints;

namespace Calendar.Api.Tests;

/// <summary>The agenda orderings are unchanged by evaluating their keys lazily and once per item.</summary>
public sealed class AgendaOrderTests
{
  [Fact]
  public void OrderingMatchesOriginalComparersAcrossTiesAndDst()
  {
    var random = new Random(54);
    var zone = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
    DateOnly[] dates = [new(2026, 3, 7), new(2026, 3, 8), new(2026, 3, 9), new(2026, 10, 31), new(2026, 11, 1), new(2026, 11, 2)];
    DateTimeOffset[] instants = [new(2026, 3, 8, 6, 30, 0, TimeSpan.Zero), new(2026, 3, 8, 7, 30, 0, TimeSpan.Zero), new(2026, 11, 1, 5, 30, 0, TimeSpan.Zero), new(2026, 11, 1, 6, 30, 0, TimeSpan.Zero)];
    string[] titles = ["alpha", "ALPHA", "Beta", "beta"];
    string[] priorities = ["high", "medium", "low", "other"];
    var tasks = new List<TaskResponse>();
    var allDay = new List<AllDayEventItem>();
    var timed = new List<TimedEventItem>();
    for (var i = 0; i < 2000; i++)
    {
      var id = new Guid(random.Next(), (short)random.Next(short.MaxValue), (short)random.Next(short.MaxValue), new byte[8]);
      var title = titles[random.Next(titles.Length)];
      var date = dates[random.Next(dates.Length)];
      var instant = instants[random.Next(instants.Length)];
      var dateOnly = random.Next(2) == 0;
      tasks.Add(new TaskResponse { Id = id, Title = title, Priority = priorities[random.Next(priorities.Length)], DueDate = dateOnly ? date : null, DueAt = dateOnly ? null : instant, IsCompleted = false });
      allDay.Add(new AllDayEventItem { Id = id, Title = title, StartDate = date, EndDate = date.AddDays(1) });
      timed.Add(new TimedEventItem { Id = id, Title = title, Start = instant, End = instant.AddHours(1), TimeZone = zone.Id, StartsBeforeDay = false, EndsAfterDay = false });
    }

    // The reference orders are the comparers as they were before short-circuiting (issue #54).
    tasks.Order(AgendaOrder.DueTasks).ShouldBe(tasks.Order(Comparer<TaskResponse>.Create(OriginalDue)));
    AgendaOrder.OverdueTasks(tasks, zone).ShouldBe(
        tasks.Order(Comparer<TaskResponse>.Create((a, b) => FirstDifference(LocalDate(a, zone).CompareTo(LocalDate(b, zone)), OriginalDue(a, b)))));
    allDay.Order(AgendaOrder.AllDayEvents).ShouldBe(
        allDay.Order(Comparer<AllDayEventItem>.Create((a, b) => FirstDifference(a.StartDate.CompareTo(b.StartDate), StringComparer.OrdinalIgnoreCase.Compare(a.Title, b.Title), a.Id.CompareTo(b.Id)))));
    timed.Order(AgendaOrder.TimedEvents).ShouldBe(
        timed.Order(Comparer<TimedEventItem>.Create((a, b) => FirstDifference(a.Start.CompareTo(b.Start), StringComparer.OrdinalIgnoreCase.Compare(a.Title, b.Title), a.Id.CompareTo(b.Id)))));
  }

  private static int OriginalDue(TaskResponse a, TaskResponse b) => FirstDifference(
      (a.DueAt is null).CompareTo(b.DueAt is null), Nullable.Compare(a.DueAt, b.DueAt),
      Rank(a.Priority).CompareTo(Rank(b.Priority)), StringComparer.OrdinalIgnoreCase.Compare(a.Title, b.Title), a.Id.CompareTo(b.Id));

  private static int Rank(string priority) => priority switch { "high" => 0, "medium" => 1, "low" => 2, _ => 3 };

  private static DateOnly LocalDate(TaskResponse task, TimeZoneInfo zone) =>
      task.DueDate ?? DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(task.DueAt!.Value, zone).DateTime);

  private static int FirstDifference(params ReadOnlySpan<int> comparisons)
  {
    foreach (var comparison in comparisons)
    {
      if (comparison != 0)
      {
        return comparison;
      }
    }

    return 0;
  }
}
