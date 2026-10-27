namespace Calendar.Domain.Time;

/// <summary>
/// Consecutive local calendar days in a time zone, from <see cref="StartDate"/> up to (not including)
/// <see cref="EndDate"/>, each as its <see cref="DayWindow"/>. The whole range is the half-open UTC interval
/// <c>[Start, End)</c>.
/// </summary>
/// <remarks>
/// The days tile without gaps or overlaps: each day's <see cref="DayWindow.End"/> is the next day's
/// <see cref="DayWindow.Start"/>. Days keep their <see cref="DayWindow"/> behaviour, so a range can hold 23- and
/// 25-hour days, and an empty day for a date the zone skipped entirely. Nothing here assumes a range length: a
/// week is the <see cref="IsoWeek"/> factory, and a month or any other run of days is <see cref="Create"/>.
/// </remarks>
public sealed class DateRangeWindow
{
  /// <summary>Days in an ISO week.</summary>
  public const int DaysInWeek = 7;

  private DateRangeWindow(TimeZoneInfo zone, IReadOnlyList<DayWindow> days)
  {
    Zone = zone;
    Days = days;
  }

  /// <summary>The zone the local days are resolved in.</summary>
  public TimeZoneInfo Zone { get; }

  /// <summary>The days in date order; never empty.</summary>
  public IReadOnlyList<DayWindow> Days { get; }

  /// <summary>The first local date in the range.</summary>
  public DateOnly StartDate => Days[0].Date;

  /// <summary>The exclusive end date: the day after the last date in the range.</summary>
  public DateOnly EndDate => Days[^1].Date.AddDays(1);

  /// <summary>Inclusive start of the first day, UTC.</summary>
  public DateTimeOffset Start => Days[0].Start;

  /// <summary>Exclusive end of the last day, UTC.</summary>
  public DateTimeOffset End => Days[^1].End;

  /// <summary>Builds the <paramref name="dayCount"/> consecutive days from <paramref name="startDate"/> in <paramref name="zone"/>.</summary>
  /// <param name="startDate">The first local date.</param>
  /// <param name="dayCount">The number of days; at least one.</param>
  /// <param name="zone">The zone the days are resolved in.</param>
  public static DateRangeWindow Create(DateOnly startDate, int dayCount, TimeZoneInfo zone)
  {
    ArgumentNullException.ThrowIfNull(zone);
    ArgumentOutOfRangeException.ThrowIfLessThan(dayCount, 1);
    var days = new DayWindow[dayCount];
    for (var i = 0; i < dayCount; i++)
    {
      days[i] = DayWindow.Create(startDate.AddDays(i), zone);
    }

    return new DateRangeWindow(zone, days);
  }

  /// <summary>The ISO week (Monday to Sunday) that contains <paramref name="anyDate"/>, in <paramref name="zone"/>.</summary>
  public static DateRangeWindow IsoWeek(DateOnly anyDate, TimeZoneInfo zone) => Create(IsoWeekStart(anyDate), DaysInWeek, zone);

  /// <summary>The Monday of the ISO week that contains <paramref name="date"/>.</summary>
  public static DateOnly IsoWeekStart(DateOnly date) => date.AddDays(-(((int)date.DayOfWeek + 6) % DaysInWeek));
}
