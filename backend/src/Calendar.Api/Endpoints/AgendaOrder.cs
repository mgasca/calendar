using Calendar.Api.Contracts;

namespace Calendar.Api.Endpoints;

/// <summary>
/// The orderings of the agenda lists, shared by every agenda view. Titles compare ordinally and
/// case-insensitively in memory, so the order does not depend on the database collation; the id breaks ties.
/// </summary>
internal static class AgendaOrder
{
  private static readonly StringComparer Title = StringComparer.OrdinalIgnoreCase;

  /// <summary>All-day events by start date, then title, then id.</summary>
  public static readonly IComparer<AllDayEventItem> AllDayEvents = Comparer<AllDayEventItem>.Create((a, b) =>
      FirstDifference(a.StartDate.CompareTo(b.StartDate), Title.Compare(a.Title, b.Title), a.Id.CompareTo(b.Id)));

  /// <summary>Timed events by start, then title, then id.</summary>
  public static readonly IComparer<TimedEventItem> TimedEvents = Comparer<TimedEventItem>.Create((a, b) =>
      FirstDifference(a.Start.CompareTo(b.Start), Title.Compare(a.Title, b.Title), a.Id.CompareTo(b.Id)));

  /// <summary>Tasks due on a day: timed ones by due instant first, then date-only ones; then priority, title, and id.</summary>
  public static readonly IComparer<TaskResponse> DueTasks = Comparer<TaskResponse>.Create(CompareDue);

  /// <summary>
  /// Overdue tasks, oldest due first: by due date (a due instant counts on its local date in
  /// <paramref name="zone"/>), then as <see cref="DueTasks"/>, so on the same date timed ones come first.
  /// </summary>
  public static IComparer<TaskResponse> OverdueTasks(TimeZoneInfo zone) => Comparer<TaskResponse>.Create((a, b) =>
      FirstDifference(DueLocalDate(a, zone).CompareTo(DueLocalDate(b, zone)), CompareDue(a, b)));

  private static int CompareDue(TaskResponse a, TaskResponse b) =>
      FirstDifference(
          (a.DueAt is null).CompareTo(b.DueAt is null),
          Nullable.Compare(a.DueAt, b.DueAt),
          PriorityRank(a.Priority).CompareTo(PriorityRank(b.Priority)),
          Title.Compare(a.Title, b.Title),
          a.Id.CompareTo(b.Id));

  private static int PriorityRank(string priority) => priority switch
  {
    "high" => 0,
    "medium" => 1,
    "low" => 2,
    _ => 3,
  };

  private static DateOnly DueLocalDate(TaskResponse task, TimeZoneInfo zone) =>
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
