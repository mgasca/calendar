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
    /// Timed: <c>Start &lt; window.End &amp;&amp; End &gt; window.Start</c>.
    /// All-day: <c>StartDate &lt;= window.Date &amp;&amp; EndDate &gt; window.Date</c> (end exclusive).
    /// </summary>
    public static bool EventOccursOn(CalendarEvent evt, DayWindow window)
    {
        ArgumentNullException.ThrowIfNull(evt);
        return evt.IsAllDay
            ? evt.StartDate <= window.Date && evt.EndDate > window.Date
            : evt.Start < window.End && evt.End > window.Start;
    }

    /// <summary>Due today: <c>DueDate == window.Date</c> or <c>DueAt</c> within <c>[window.Start, window.End)</c>.</summary>
    public static bool IsDueToday(TodoTask task, DayWindow window)
    {
        ArgumentNullException.ThrowIfNull(task);
        return task.DueDate == window.Date
            || (task.DueAt is { } dueAt && window.Contains(dueAt));
    }

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
