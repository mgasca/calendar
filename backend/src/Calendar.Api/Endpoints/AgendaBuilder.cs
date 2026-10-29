using System.Data;
using Calendar.Api.Contracts;
using Calendar.Domain.Agenda;
using Calendar.Domain.Time;
using Calendar.Infrastructure;
using Calendar.Infrastructure.Queries;
using Microsoft.EntityFrameworkCore;

namespace Calendar.Api.Endpoints;

/// <summary>Everything an agenda view shows for a range of days, read from one snapshot and already ordered.</summary>
/// <param name="Range">The days that were read.</param>
/// <param name="AllDayEvents">All-day events covering any date of the range, once each.</param>
/// <param name="Days">One entry per day of <paramref name="Range"/>, in date order.</param>
/// <param name="Overdue">The overdue tasks, or <c>null</c> when they were not requested.</param>
/// <param name="OverdueTotal">The total number of overdue tasks.</param>
/// <param name="OverdueOpenTotal">The number of open overdue tasks.</param>
internal sealed record AgendaSnapshot(
    DateRangeWindow Range,
    IReadOnlyList<AllDayEventItem> AllDayEvents,
    IReadOnlyList<AgendaSnapshotDay> Days,
    IReadOnlyList<AgendaTaskItem>? Overdue,
    int OverdueTotal,
    int OverdueOpenTotal);

/// <summary>One day of an <see cref="AgendaSnapshot"/>.</summary>
/// <param name="Window">The day.</param>
/// <param name="Events">Timed events overlapping the day, with continuation flags relative to it.</param>
/// <param name="Tasks">Tasks due on the day, open or completed.</param>
internal sealed record AgendaSnapshotDay(DayWindow Window, IReadOnlyList<TimedEventItem> Events, IReadOnlyList<AgendaTaskItem> Tasks);

/// <summary>
/// The shared read side of every agenda view. It reads a <see cref="DateRangeWindow"/> with a fixed number of
/// queries, whatever its length, and splits the results into days in memory with <see cref="DayInclusion"/>, so
/// the per-day rules have one implementation. Nothing here knows how long a view's range is.
/// </summary>
internal static class AgendaBuilder
{
  private const int OverdueLimit = 20;

  /// <summary>Reads and buckets the agenda for <paramref name="range"/>.</summary>
  /// <param name="db">The database context.</param>
  /// <param name="range">The days to read.</param>
  /// <param name="overdueAsOf">
  /// The day overdue tasks are judged against (still open, or completed within it), or <c>null</c> for no overdue
  /// list. Only tasks due before the range's first day are returned, so none repeats a task in a day.
  /// </param>
  /// <param name="cancellationToken">Cancels the reads.</param>
  public static async Task<AgendaSnapshot> ReadAsync(
      CalendarDbContext db, DateRangeWindow range, DayWindow? overdueAsOf, CancellationToken cancellationToken)
  {
    // One snapshot for all reads (ADR-0020 D1): a task completed or an event added between them must not show
    // up in some lists and not in others.
    await using var snapshot = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken);
    await db.Database.ExecuteSqlAsync($"SET TRANSACTION READ ONLY", cancellationToken);

    var allDay = await db.Events.AsNoTracking().AllDayOverlapping(range).Select(AllDayEventItem.Projection).ToListAsync(cancellationToken);
    var timed = await db.Events.AsNoTracking().TimedOverlapping(range).Select(TimedEventItem.Projection).ToListAsync(cancellationToken);
    var due = await db.Tasks.AsNoTracking().DueWithin(range).Select(AgendaTaskItem.Projection).ToListAsync(cancellationToken);
    List<AgendaTaskItem>? overdue = null;
    var overdueTotal = 0;
    var overdueOpenTotal = 0;
    if (overdueAsOf is { } asOf)
    {
      var query = db.Tasks.AsNoTracking().OverdueFor(asOf).DueBefore(range);
      overdueTotal = await query.CountAsync(cancellationToken);
      overdueOpenTotal = await query.CountAsync(t => t.CompletedAt == null, cancellationToken);
      overdue = await query.OrderByDated(range.Zone.Id).Take(OverdueLimit).Select(AgendaTaskItem.Projection).ToListAsync(cancellationToken);
    }

    await snapshot.CommitAsync(cancellationToken);

    return new AgendaSnapshot(
        range,
        [.. allDay.Order(AgendaOrder.AllDayEvents)],
        Bucket(range, timed, due),
        overdue, overdueTotal, overdueOpenTotal);
  }

  /// <summary>
  /// Splits the range's items into its days. Each item is tested only against the days its instants or date can
  /// fall on (found by binary search over the sorted day boundaries), and <see cref="DayInclusion"/> still
  /// decides, so the work is linear in the items rather than days × items.
  /// </summary>
  internal static IReadOnlyList<AgendaSnapshotDay> Bucket(
      DateRangeWindow range, IReadOnlyList<TimedEventItem> timed, IReadOnlyList<AgendaTaskItem> due)
  {
    var days = range.Days;
    var eventsByDay = days.Select(_ => new List<TimedEventItem>()).ToArray();
    var tasksByDay = days.Select(_ => new List<AgendaTaskItem>()).ToArray();

    foreach (var evt in timed)
    {
      // Ends and starts are monotonic, including repeated boundaries for skipped dates.
      var first = LowerBound(days, day => day.End > evt.Start);
      var end = LowerBound(days, day => day.Start >= evt.End);
      for (var i = first; i < end; i++)
      {
        var day = days[i];
        if (DayInclusion.TimedEventOverlaps(evt.Start, evt.End, day))
        {
          eventsByDay[i].Add(evt with { StartsBeforeDay = evt.Start < day.Start, EndsAfterDay = evt.End > day.End });
        }
      }
    }

    foreach (var task in due)
    {
      var dateIndex = task.DueDate is { } date ? date.DayNumber - range.StartDate.DayNumber : -1;
      if (dateIndex >= 0 && dateIndex < days.Count && DayInclusion.IsDueOn(task.DueDate, task.DueAt, days[dateIndex]))
      {
        tasksByDay[dateIndex].Add(task);
      }

      if (task.DueAt is { } at)
      {
        var index = LowerBound(days, day => day.Start > at) - 1;
        if (index >= 0 && index != dateIndex && DayInclusion.IsDueOn(task.DueDate, task.DueAt, days[index]))
        {
          tasksByDay[index].Add(task);
        }
      }
    }

    return [.. days.Select((day, i) => new AgendaSnapshotDay(
        day, [.. eventsByDay[i].Order(AgendaOrder.TimedEvents)], [.. tasksByDay[i].Order(AgendaOrder.DueTasks)]))];
  }

  private static int LowerBound(IReadOnlyList<DayWindow> days, Func<DayWindow, bool> predicate)
  {
    var low = 0;
    var high = days.Count;
    while (low < high)
    {
      var middle = low + ((high - low) / 2);
      if (predicate(days[middle]))
      {
        high = middle;
      }
      else
      {
        low = middle + 1;
      }
    }

    return low;
  }
}
