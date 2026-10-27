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
/// clock falls back over it) the window starts at the first occurrence. If the whole date is skipped (e.g.
/// Pacific/Apia 2011-12-30) the window is empty, with <see cref="Start"/> equal to <see cref="End"/> at the transition.
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

  /// <summary>Duration of the window: 24h on ordinary days, shorter or longer across offset changes.</summary>
  public TimeSpan Length => End - Start;

  /// <summary>Builds the window covered by local <paramref name="date"/> in <paramref name="zone"/>.</summary>
  public static DayWindow Create(DateOnly date, TimeZoneInfo zone)
  {
    ArgumentNullException.ThrowIfNull(zone);
    return new DayWindow(date, StartOfDay(date, zone), StartOfDay(date.AddDays(1), zone));
  }

  /// <summary>True when <paramref name="instant"/> is within <c>[Start, End)</c>.</summary>
  public bool Contains(DateTimeOffset instant) => instant >= Start && instant < End;

  // The largest UTC offset is +14h and the smallest -12h, so a local date's first instant lies within
  // [midnight - 15h, midnight + 13h] when midnight is read as a UTC clock time.
  private static readonly TimeSpan SearchBefore = TimeSpan.FromHours(15);
  private static readonly TimeSpan SearchAfter = TimeSpan.FromHours(13);
  private static readonly TimeSpan SampleStep = TimeSpan.FromMinutes(30);

  /// <summary>
  /// The earliest instant whose local date in <paramref name="zone"/> is on or after <paramref name="date"/>.
  /// That is local midnight when it exists (its first occurrence if it repeats), the transition instant when the
  /// clock jumps over midnight (including a jump that skips the whole date, which gives an empty window), and it
  /// never depends on <c>IsInvalidTime</c>, which misses gaps that begin exactly at 00:00 in some zones.
  /// </summary>
  private static DateTimeOffset StartOfDay(DateOnly date, TimeZoneInfo zone)
  {
    var midnight = DateTime.SpecifyKind(date.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc);
    var first = new DateTimeOffset(midnight - SearchBefore);
    var last = new DateTimeOffset(midnight + SearchAfter);

    var firstOffset = zone.GetUtcOffset(first);
    if (firstOffset == zone.GetUtcOffset(last))
    {
      // No transition in the window (the overwhelmingly common case): local midnight is unambiguous.
      return new DateTimeOffset(midnight - firstOffset, TimeSpan.Zero);
    }

    // Boundaries of "local date >= date" are local midnight under some offset in force, or a transition instant.
    var candidates = new List<DateTimeOffset>();
    var previous = first;
    var previousOffset = firstOffset;
    candidates.Add(new DateTimeOffset(midnight - previousOffset, TimeSpan.Zero));
    while (previous < last)
    {
      var t = previous + SampleStep > last ? last : previous + SampleStep;
      var offset = zone.GetUtcOffset(t);
      if (offset != previousOffset)
      {
        candidates.Add(new DateTimeOffset(midnight - offset, TimeSpan.Zero));
        candidates.Add(FindTransition(zone, previous, t, previousOffset));
      }

      (previous, previousOffset) = (t, offset);
    }

    return candidates.Where(c => LocalDate(c, zone) >= date).Min();
  }

  private static DateOnly LocalDate(DateTimeOffset instant, TimeZoneInfo zone) =>
      DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, zone).DateTime);

  /// <summary>First instant in <c>(before, after]</c> whose offset differs from <paramref name="offsetBefore"/>.</summary>
  private static DateTimeOffset FindTransition(TimeZoneInfo zone, DateTimeOffset before, DateTimeOffset after, TimeSpan offsetBefore)
  {
    var low = before.UtcTicks;
    var high = after.UtcTicks;
    while (high - low > 1)
    {
      var mid = low + ((high - low) / 2);
      if (zone.GetUtcOffset(new DateTimeOffset(mid, TimeSpan.Zero)) == offsetBefore)
      {
        low = mid;
      }
      else
      {
        high = mid;
      }
    }

    return new DateTimeOffset(high, TimeSpan.Zero);
  }
}
