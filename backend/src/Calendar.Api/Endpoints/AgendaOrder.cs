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
  {
    var comparison = a.StartDate.CompareTo(b.StartDate);
    if (comparison != 0)
    {
      return comparison;
    }
    comparison = Title.Compare(a.Title, b.Title);
    return comparison != 0 ? comparison : a.Id.CompareTo(b.Id);
  });

  /// <summary>Timed events by start, then title, then id.</summary>
  public static readonly IComparer<TimedEventItem> TimedEvents = Comparer<TimedEventItem>.Create((a, b) =>
  {
    var comparison = a.Start.CompareTo(b.Start);
    if (comparison != 0)
    {
      return comparison;
    }
    comparison = Title.Compare(a.Title, b.Title);
    return comparison != 0 ? comparison : a.Id.CompareTo(b.Id);
  });

  /// <summary>Tasks due on a day: timed ones by due instant first, then date-only ones; then priority, title, and id.</summary>
  public static readonly IComparer<AgendaTaskItem> DueTasks = Comparer<AgendaTaskItem>.Create(CompareDue);

  private static int CompareDue(AgendaTaskItem a, AgendaTaskItem b)
  {
    var comparison = (a.DueAt is null).CompareTo(b.DueAt is null);
    if (comparison != 0)
    {
      return comparison;
    }
    comparison = Nullable.Compare(a.DueAt, b.DueAt);
    if (comparison != 0)
    {
      return comparison;
    }
    comparison = PriorityRank(a.Priority).CompareTo(PriorityRank(b.Priority));
    if (comparison != 0)
    {
      return comparison;
    }
    comparison = Title.Compare(a.Title, b.Title);
    return comparison != 0 ? comparison : a.Id.CompareTo(b.Id);
  }

  private static int PriorityRank(string priority) => priority switch
  {
    "high" => 0,
    "medium" => 1,
    "low" => 2,
    _ => 3,
  };

}
