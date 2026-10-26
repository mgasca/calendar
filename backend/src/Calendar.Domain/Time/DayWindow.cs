namespace Calendar.Domain.Time;

/// <summary>
/// The half-open UTC interval <c>[Start, End)</c> covered by a local calendar <see cref="Date"/> in a time zone.
/// </summary>
/// <remarks>
/// <para>
/// The window runs from the first instant of the local date to the first instant of the next local date, so it is
/// 24h on ordinary days, 23h/25h across DST transitions, and shorter/longer for other offset changes.
/// </para>
/// <para>
/// If local midnight does not exist (the clock jumps over it, e.g. America/Santiago 2026-09-06) the window starts
/// at the transition itself, i.e. the first valid local instant of that day. If local midnight occurs twice (the
/// clock falls back over it) the window starts at the first occurrence.
/// </para>
/// </remarks>
public readonly record struct DayWindow
{
    private DayWindow(DateOnly date, DateTimeOffset start, DateTimeOffset end)
    {
        Date = date;
        Start = start;
        End = end;
    }

    /// <summary>The local calendar date.</summary>
    public DateOnly Date { get; }

    /// <summary>Inclusive start, UTC (offset zero).</summary>
    public DateTimeOffset Start { get; }

    /// <summary>Exclusive end, UTC (offset zero).</summary>
    public DateTimeOffset End { get; }

    public TimeSpan Length => End - Start;

    public static DayWindow Create(DateOnly date, TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(zone);
        return new DayWindow(date, StartOfDay(date, zone), StartOfDay(date.AddDays(1), zone));
    }

    /// <summary>True when <paramref name="instant"/> is within <c>[Start, End)</c>.</summary>
    public bool Contains(DateTimeOffset instant) => instant >= Start && instant < End;

    private static DateTimeOffset StartOfDay(DateOnly date, TimeZoneInfo zone)
    {
        var midnight = date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);

        TimeSpan offset;
        if (zone.IsInvalidTime(midnight))
        {
            // Midnight is skipped: the offset in force just before the gap converts the gap's start (the
            // transition instant) to UTC, and that instant is the first valid local instant of the day.
            offset = zone.GetUtcOffset(midnight.AddTicks(-1));
        }
        else if (zone.IsAmbiguousTime(midnight))
        {
            // Midnight happens twice: take the first occurrence, which has the larger (earlier-UTC) offset.
            offset = zone.GetAmbiguousTimeOffsets(midnight).Max();
        }
        else
        {
            offset = zone.GetUtcOffset(midnight);
        }

        return new DateTimeOffset(DateTime.SpecifyKind(midnight - offset, DateTimeKind.Utc));
    }
}
