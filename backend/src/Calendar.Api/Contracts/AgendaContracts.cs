
namespace Calendar.Api.Contracts;

/// <summary>The day as UTC instants, <c>[start, end)</c>; may be shorter or longer than 24 hours across DST changes.</summary>
public sealed record AgendaWindow
{
  /// <summary>Inclusive start of the day, as a UTC instant.</summary>
  public required DateTimeOffset Start { get; init; }

  /// <summary>Exclusive end of the day, as a UTC instant.</summary>
  public required DateTimeOffset End { get; init; }
}

/// <summary>Tasks relevant to the day, split into overdue and due-today groups.</summary>
public sealed record AgendaTasks
{
  /// <summary>Up to 20 overdue tasks, open first then completed within the day; each group is ordered by local due date, instant and id.</summary>
  public required IReadOnlyList<AgendaTaskItem> Overdue { get; init; }

  /// <summary>Number of overdue tasks, including those completed today.</summary>
  public required int OverdueTotal { get; init; }

  /// <summary>Number of open overdue tasks.</summary>
  public required int OverdueOpenTotal { get; init; }

  /// <summary>Tasks due on the day (open or completed): timed ones by due instant, then date-only ones by title.</summary>
  public required IReadOnlyList<AgendaTaskItem> DueToday { get; init; }
}

/// <summary>Everything for one local day, from a single snapshot.</summary>
public sealed record DayAgendaResponse
{
  /// <summary>The local calendar date (YYYY-MM-DD) in <c>timeZone</c>.</summary>
  public required DateOnly Date { get; init; }

  /// <summary>Canonical IANA time zone id the day was resolved in.</summary>
  public required string TimeZone { get; init; }

  /// <summary>The UTC instants spanned by the local day.</summary>
  public required AgendaWindow Window { get; init; }

  /// <summary>All-day events covering the date, by start date then title.</summary>
  public required IReadOnlyList<AllDayEventItem> AllDayEvents { get; init; }

  /// <summary>Timed events overlapping the window, by start then title.</summary>
  public required IReadOnlyList<TimedEventItem> Events { get; init; }

  /// <summary>Overdue and due-today tasks.</summary>
  public required AgendaTasks Tasks { get; init; }
}

/// <summary>One local day of a multi-day agenda: its timed events and the tasks due on it.</summary>
public sealed record AgendaDay
{
  /// <summary>The local calendar date (YYYY-MM-DD).</summary>
  public required DateOnly Date { get; init; }

  /// <summary>The UTC instants spanned by the local day; empty for a date the zone skipped.</summary>
  public required AgendaWindow Window { get; init; }

  /// <summary>
  /// Timed events overlapping the day, by start then title, with flags relative to this day. An event that
  /// crosses midnight appears on every day it touches.
  /// </summary>
  public required IReadOnlyList<TimedEventItem> Events { get; init; }

  /// <summary>Tasks due on the day (open or completed): timed ones by due instant, then date-only ones by title.</summary>
  public required IReadOnlyList<AgendaTaskItem> Tasks { get; init; }
}

/// <summary>The ISO week (Monday to Sunday) containing the requested date, from a single snapshot.</summary>
public sealed record WeekAgendaResponse
{
  /// <summary>The Monday the week starts on (YYYY-MM-DD).</summary>
  public required DateOnly WeekStart { get; init; }

  /// <summary>Canonical IANA time zone id the week was resolved in.</summary>
  public required string TimeZone { get; init; }

  /// <summary>The UTC instants from local midnight on Monday to local midnight on the next Monday.</summary>
  public required AgendaWindow Window { get; init; }

  /// <summary>All-day events covering any date of the week, once each, by start date then title.</summary>
  public required IReadOnlyList<AllDayEventItem> AllDayEvents { get; init; }

  /// <summary>The seven days, Monday first.</summary>
  public required IReadOnlyList<AgendaDay> Days { get; init; }

  /// <summary>
  /// Tasks overdue as of <c>today</c> (still open, or completed within today) that were due before the week's
  /// Monday, capped at 20 and ordered open first, then completed today, by local due date, instant and id within
  /// each group. Tasks due within the week are in their day instead. <c>null</c> when the whole
  /// week is before <c>today</c>.
  /// </summary>
  public required IReadOnlyList<AgendaTaskItem>? Overdue { get; init; }

  /// <summary>Number of overdue tasks, including those completed today.</summary>
  public required int OverdueTotal { get; init; }

  /// <summary>Number of open overdue tasks.</summary>
  public required int OverdueOpenTotal { get; init; }
}
