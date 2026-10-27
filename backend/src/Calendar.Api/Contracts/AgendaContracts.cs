
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
  /// <summary>Overdue tasks, oldest due first: still open, or completed within the day. Not due on the day itself.</summary>
  public required IReadOnlyList<TaskResponse> Overdue { get; init; }

  /// <summary>Tasks due on the day (open or completed): timed ones by due instant, then date-only ones by title.</summary>
  public required IReadOnlyList<TaskResponse> DueToday { get; init; }
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
