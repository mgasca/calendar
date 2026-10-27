using Calendar.Domain.Events;
using Calendar.Domain.Tasks;
using Calendar.Domain.Time;
using Calendar.Infrastructure.Configurations;
using Microsoft.EntityFrameworkCore;
using NpgsqlTypes;

namespace Calendar.Infrastructure.Queries;

/// <summary>
/// SQL translations of the pure rules in <c>Calendar.Domain.Agenda.DayInclusion</c>. Keep each predicate in step
/// with its counterpart there; integration tests assert the two agree. The per-day forms take a
/// <see cref="DayWindow"/>; the range forms take a <see cref="DateRangeWindow"/> and select a superset that the
/// read model then splits into days with <c>DayInclusion</c>.
/// </summary>
public static class AgendaQueries
{
  /// <summary>All-day events covering the window's date: <c>StartDate &lt;= Date &lt; EndDate</c>.</summary>
  public static IQueryable<CalendarEvent> AllDayOn(this IQueryable<CalendarEvent> events, DayWindow window)
  {
    ArgumentNullException.ThrowIfNull(events);
    var date = window.Date;
    return events.Where(e => e.IsAllDay && e.StartDate <= date && e.EndDate > date);
  }

  /// <summary>
  /// Timed events overlapping the window: the generated half-open span range overlaps <c>[Start, End)</c>
  /// (GiST-backed <c>&amp;&amp;</c>), i.e. <c>starts_at &lt; End AND ends_at &gt; Start</c>. A window with no
  /// length (a date that was skipped by a clock change) matches nothing.
  /// </summary>
  public static IQueryable<CalendarEvent> TimedOn(this IQueryable<CalendarEvent> events, DayWindow window)
  {
    ArgumentNullException.ThrowIfNull(events);
    return events.TimedWithin(window.Start, window.End);
  }

  /// <summary>Tasks due on the window's day, whether or not they are completed.</summary>
  public static IQueryable<TodoTask> DueOn(this IQueryable<TodoTask> tasks, DayWindow window)
  {
    ArgumentNullException.ThrowIfNull(tasks);
    var (date, start, end) = (window.Date, window.Start, window.End);
    return tasks.Where(t => t.DueDate == date || (t.DueAt >= start && t.DueAt < end));
  }

  /// <summary>Overdue tasks that are still open, or that were completed within the window.</summary>
  public static IQueryable<TodoTask> OverdueFor(this IQueryable<TodoTask> tasks, DayWindow window)
  {
    ArgumentNullException.ThrowIfNull(tasks);
    var (date, start, end) = (window.Date, window.Start, window.End);
    return tasks.Where(t =>
        (t.DueDate < date || t.DueAt < start)
        && (t.CompletedAt == null || (t.CompletedAt >= start && t.CompletedAt < end)));
  }

  /// <summary>
  /// All-day events covering at least one date of the range: <c>StartDate &lt; range.EndDate &amp;&amp; EndDate &gt;
  /// range.StartDate</c> (both ends exclusive). The range form of <see cref="AllDayOn"/>.
  /// </summary>
  public static IQueryable<CalendarEvent> AllDayOverlapping(this IQueryable<CalendarEvent> events, DateRangeWindow range)
  {
    ArgumentNullException.ThrowIfNull(events);
    ArgumentNullException.ThrowIfNull(range);
    var (startDate, endDate) = (range.StartDate, range.EndDate);
    return events.Where(e => e.IsAllDay && e.StartDate < endDate && e.EndDate > startDate);
  }

  /// <summary>
  /// Timed events overlapping the range's <c>[Start, End)</c>, with the same GiST-backed span overlap as
  /// <see cref="TimedOn"/>. A range with no length (only skipped dates) matches nothing. Which days an event
  /// touches is decided per day by <c>DayInclusion</c>, so a skipped date inside the range still shows none.
  /// </summary>
  public static IQueryable<CalendarEvent> TimedOverlapping(this IQueryable<CalendarEvent> events, DateRangeWindow range)
  {
    ArgumentNullException.ThrowIfNull(events);
    ArgumentNullException.ThrowIfNull(range);
    return events.TimedWithin(range.Start, range.End);
  }

  /// <summary>
  /// Tasks due on any day of the range, whether or not they are completed: <c>DueDate</c> in
  /// <c>[StartDate, EndDate)</c> or <c>DueAt</c> in <c>[Start, End)</c>. The range form of <see cref="DueOn"/>.
  /// </summary>
  public static IQueryable<TodoTask> DueWithin(this IQueryable<TodoTask> tasks, DateRangeWindow range)
  {
    ArgumentNullException.ThrowIfNull(tasks);
    ArgumentNullException.ThrowIfNull(range);
    var (startDate, endDate, start, end) = (range.StartDate, range.EndDate, range.Start, range.End);
    return tasks.Where(t => (t.DueDate >= startDate && t.DueDate < endDate) || (t.DueAt >= start && t.DueAt < end));
  }

  /// <summary>
  /// Tasks due before the range's first day: <c>DueDate &lt; range.StartDate</c> or <c>DueAt &lt; range.Start</c>.
  /// Combined with <see cref="OverdueFor"/> it limits an overdue list to what no day of the range already shows.
  /// </summary>
  public static IQueryable<TodoTask> DueBefore(this IQueryable<TodoTask> tasks, DateRangeWindow range)
  {
    ArgumentNullException.ThrowIfNull(tasks);
    ArgumentNullException.ThrowIfNull(range);
    var (startDate, start) = (range.StartDate, range.Start);
    return tasks.Where(t => t.DueDate < startDate || t.DueAt < start);
  }

  private static IQueryable<CalendarEvent> TimedWithin(this IQueryable<CalendarEvent> events, DateTimeOffset start, DateTimeOffset end)
  {
    if (end <= start)
    {
      return events.Where(_ => false);
    }

    var windowRange = new NpgsqlRange<DateTimeOffset>(start, true, end, false);
    return events.Where(e =>
        !e.IsAllDay
        && NpgsqlRangeDbFunctionsExtensions.Overlaps(EF.Property<NpgsqlRange<DateTimeOffset>?>(e, CalendarEventConfiguration.SpanProperty)!.Value, windowRange));
  }
}
