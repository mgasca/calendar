using Calendar.Domain.Events;
using Calendar.Domain.Tasks;
using Calendar.Domain.Time;

namespace Calendar.Domain.Agenda;

/// <summary>
/// Pure rules deciding what the "Today" view shows for a <see cref="DayWindow"/>. Each rule is a simple
/// comparison against <c>window.Date</c>, <c>window.Start</c> and <c>window.End</c> so it can be mirrored
/// one-to-one in a database query.
/// </summary>
public static class DayInclusion
{
  /// <summary>
  /// Timed: <c>Start &lt; window.End &amp;&amp; End &gt; window.Start</c>, never for an empty window (a date that a
  /// clock change skipped entirely has no time on it).
  /// All-day: <c>StartDate &lt;= window.Date &amp;&amp; EndDate &gt; window.Date</c> (end exclusive).
  /// </summary>
  public static bool EventOccursOn(CalendarEvent evt, DayWindow window)
  {
    ArgumentNullException.ThrowIfNull(evt);
    return evt.IsAllDay
        ? AllDayEventCovers(evt.StartDate!.Value, evt.EndDate!.Value, window)
        : TimedEventOverlaps(evt.Start!.Value, evt.End!.Value, window);
  }

  /// <summary>
  /// The timed-event rule of <see cref="EventOccursOn"/> on raw values, for read models that hold projections:
  /// <c>start &lt; window.End &amp;&amp; end &gt; window.Start</c>, never for an empty window.
  /// </summary>
  public static bool TimedEventOverlaps(DateTimeOffset start, DateTimeOffset end, DayWindow window) =>
      window.Length > TimeSpan.Zero && start < window.End && end > window.Start;

  /// <summary>
  /// The all-day rule of <see cref="EventOccursOn"/> on raw values:
  /// <c>startDate &lt;= window.Date &amp;&amp; endDate &gt; window.Date</c> (end exclusive).
  /// </summary>
  public static bool AllDayEventCovers(DateOnly startDate, DateOnly endDate, DayWindow window) =>
      startDate <= window.Date && endDate > window.Date;

  /// <summary>Due today: <c>DueDate == window.Date</c> or <c>DueAt</c> within <c>[window.Start, window.End)</c>.</summary>
  public static bool IsDueToday(TodoTask task, DayWindow window)
  {
    ArgumentNullException.ThrowIfNull(task);
    return IsDueOn(task.DueDate, task.DueAt, window);
  }

  /// <summary>The rule of <see cref="IsDueToday"/> on raw due values, for read models that hold projections.</summary>
  public static bool IsDueOn(DateOnly? dueDate, DateTimeOffset? dueAt, DayWindow window) =>
      dueDate == window.Date || (dueAt is { } at && window.Contains(at));

  /// <summary>
  /// Overdue: <c>DueDate &lt; window.Date</c> or <c>DueAt &lt; window.Start</c>. Independent of completion.
  /// A timed task due earlier today is "due today", not overdue.
  /// </summary>
  public static bool IsOverdue(TodoTask task, DayWindow window)
  {
    ArgumentNullException.ThrowIfNull(task);
    return task.DueDate < window.Date || task.DueAt < window.Start;
  }

  /// <summary>
  /// Shown in Today: due today (complete or not), or overdue and either incomplete or completed within the
  /// window. Undated tasks never match.
  /// </summary>
  public static bool IsIncludedInDay(TodoTask task, DayWindow window)
  {
    ArgumentNullException.ThrowIfNull(task);
    return IsDueToday(task, window)
        || (IsOverdue(task, window)
            && (task.CompletedAt is null || window.Contains(task.CompletedAt.Value)));
  }
}
