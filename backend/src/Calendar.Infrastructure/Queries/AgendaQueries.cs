using Calendar.Domain.Events;
using Calendar.Domain.Tasks;
using Calendar.Domain.Time;
using Calendar.Infrastructure.Configurations;
using Microsoft.EntityFrameworkCore;
using NpgsqlTypes;

namespace Calendar.Infrastructure.Queries;

/// <summary>
/// SQL translations of the pure rules in <c>Calendar.Domain.Agenda.DayInclusion</c>. Keep each predicate in step
/// with its counterpart there; integration tests assert the two agree.
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
        if (window.Length <= TimeSpan.Zero)
        {
            return events.Where(_ => false);
        }

        var windowRange = new NpgsqlRange<DateTimeOffset>(window.Start, true, window.End, false);
        return events.Where(e =>
            !e.IsAllDay
            && NpgsqlRangeDbFunctionsExtensions.Overlaps(EF.Property<NpgsqlRange<DateTimeOffset>?>(e, CalendarEventConfiguration.SpanProperty)!.Value, windowRange));
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
}
