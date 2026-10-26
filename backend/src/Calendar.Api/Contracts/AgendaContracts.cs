using System.ComponentModel;

namespace Calendar.Api.Contracts;

[Description("The day as UTC instants: [start, end).")]
public sealed record AgendaWindow
{
    public required DateTimeOffset Start { get; init; }

    public required DateTimeOffset End { get; init; }
}

public sealed record AgendaTasks
{
    [Description("Overdue tasks, oldest due first: still open, or completed within the day. Not due on the day itself.")]
    public required IReadOnlyList<TaskResponse> Overdue { get; init; }

    [Description("Tasks due on the day (open or completed): timed ones by due instant, then date-only ones by title.")]
    public required IReadOnlyList<TaskResponse> DueToday { get; init; }
}

/// <summary>Everything for one local day, from a single snapshot.</summary>
public sealed record DayAgendaResponse
{
    public required DateOnly Date { get; init; }

    [Description("Canonical IANA time zone id the day was resolved in.")]
    public required string TimeZone { get; init; }

    public required AgendaWindow Window { get; init; }

    [Description("All-day events covering the date, by start date then title.")]
    public required IReadOnlyList<AllDayEventItem> AllDayEvents { get; init; }

    [Description("Timed events overlapping the window, by start then title.")]
    public required IReadOnlyList<TimedEventItem> Events { get; init; }

    public required AgendaTasks Tasks { get; init; }
}
