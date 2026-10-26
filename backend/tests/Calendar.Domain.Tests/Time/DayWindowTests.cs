using Calendar.Domain.Time;

namespace Calendar.Domain.Tests.Time;

public sealed class DayWindowTests
{
  private static DayWindow Window(int year, int month, int day, string zone) =>
      DayWindow.Create(new DateOnly(year, month, day), TimeZones.FindIana(zone));

  private static DateTime Local(int y, int mo, int d) => new(y, mo, d, 0, 0, 0, DateTimeKind.Unspecified);

  private static DateTimeOffset Utc(int y, int mo, int d, int h, int mi = 0) => new(y, mo, d, h, mi, 0, TimeSpan.Zero);

  [Fact]
  public void Create_OrdinaryDay_Is24Hours()
  {
    var w = Window(2026, 10, 26, "America/New_York");

    w.Start.ShouldBe(Utc(2026, 10, 26, 4));
    w.End.ShouldBe(Utc(2026, 10, 27, 4));
    w.Length.ShouldBe(TimeSpan.FromHours(24));
    w.Date.ShouldBe(new DateOnly(2026, 10, 26));
  }

  [Fact]
  public void Create_InUtc_MatchesCalendarDay()
  {
    var w = Window(2026, 10, 26, "UTC");

    w.Start.ShouldBe(Utc(2026, 10, 26, 0));
    w.End.ShouldBe(Utc(2026, 10, 27, 0));
  }

  [Fact]
  public void Create_EastOfUtc_StartsOnPreviousUtcDay()
  {
    var w = Window(2026, 10, 26, "Asia/Kolkata");

    w.Start.ShouldBe(Utc(2026, 10, 25, 18, 30));
    w.Length.ShouldBe(TimeSpan.FromHours(24));
  }

  [Fact]
  public void Create_NewYorkSpringForward_Is23Hours()
  {
    var w = Window(2026, 3, 8, "America/New_York");

    w.Start.ShouldBe(Utc(2026, 3, 8, 5));
    w.End.ShouldBe(Utc(2026, 3, 9, 4));
    w.Length.ShouldBe(TimeSpan.FromHours(23));
  }

  [Fact]
  public void Create_NewYorkFallBack_Is25Hours()
  {
    var w = Window(2026, 11, 1, "America/New_York");

    w.Start.ShouldBe(Utc(2026, 11, 1, 4));
    w.End.ShouldBe(Utc(2026, 11, 2, 5));
    w.Length.ShouldBe(TimeSpan.FromHours(25));
  }

  [Fact]
  public void Create_LondonSpringForward_Is23Hours()
  {
    var w = Window(2026, 3, 29, "Europe/London");

    w.Start.ShouldBe(Utc(2026, 3, 29, 0));
    w.End.ShouldBe(Utc(2026, 3, 29, 23));
    w.Length.ShouldBe(TimeSpan.FromHours(23));
  }

  [Fact]
  public void Create_LondonFallBack_Is25Hours()
  {
    var w = Window(2026, 10, 25, "Europe/London");

    w.Start.ShouldBe(Utc(2026, 10, 24, 23));
    w.End.ShouldBe(Utc(2026, 10, 26, 0));
    w.Length.ShouldBe(TimeSpan.FromHours(25));
  }

  [Fact]
  public void Create_SantiagoSkippedMidnight_StartsAtFirstValidInstant()
  {
    // 2026-09-06 00:00 -04:00 jumps to 01:00 -03:00; local midnight does not exist.
    var zone = TimeZones.FindIana("America/Santiago");
    zone.IsInvalidTime(Local(2026, 9, 6)).ShouldBeTrue();

    var w = DayWindow.Create(new DateOnly(2026, 9, 6), zone);

    w.Start.ShouldBe(Utc(2026, 9, 6, 4));
    TimeZoneInfo.ConvertTime(w.Start, zone).TimeOfDay.ShouldBe(TimeSpan.FromHours(1));
    w.End.ShouldBe(Utc(2026, 9, 7, 3));
    w.Length.ShouldBe(TimeSpan.FromHours(23));
  }

  [Fact]
  public void Create_SantiagoSkippedMidnight_PreviousDayEndsAtSameInstant()
  {
    var prev = Window(2026, 9, 5, "America/Santiago");
    var skipped = Window(2026, 9, 6, "America/Santiago");

    prev.End.ShouldBe(skipped.Start);
  }

  [Theory]
  [InlineData("America/Havana", 2026, 3, 8)]
  [InlineData("Asia/Beirut", 2026, 3, 29)]
  public void Create_OtherSkippedMidnightZones_StartAtTransition(string id, int y, int mo, int d)
  {
    var zone = TimeZones.FindIana(id);
    zone.IsInvalidTime(Local(y, mo, d)).ShouldBeTrue();

    var w = DayWindow.Create(new DateOnly(y, mo, d), zone);

    zone.IsInvalidTime(TimeZoneInfo.ConvertTime(w.Start, zone).DateTime).ShouldBeFalse();
    TimeZoneInfo.ConvertTime(w.Start, zone).Date.ShouldBe(Local(y, mo, d));
    TimeZoneInfo.ConvertTime(w.Start.AddTicks(-1), zone).Date.ShouldBe(Local(y, mo, d).AddDays(-1));
    w.Length.ShouldBe(TimeSpan.FromHours(23));
  }

  [Fact]
  public void Create_AmbiguousMidnight_StartsAtFirstOccurrence()
  {
    // Havana falls back 01:00 -> 00:00 on 2026-11-01, so local midnight happens twice.
    var zone = TimeZones.FindIana("America/Havana");
    zone.IsAmbiguousTime(Local(2026, 11, 1)).ShouldBeTrue();

    var w = DayWindow.Create(new DateOnly(2026, 11, 1), zone);

    w.Start.ShouldBe(Utc(2026, 11, 1, 4)); // 00:00 CDT (-04:00), the first occurrence
    w.Length.ShouldBe(TimeSpan.FromHours(25));
  }

  [Fact]
  public void Create_ConsecutiveDays_TileWithoutGapsAcrossDstChange()
  {
    var zone = TimeZones.FindIana("America/New_York");
    var date = new DateOnly(2026, 11, 1);

    for (var i = -3; i <= 3; i++)
    {
      var a = DayWindow.Create(date.AddDays(i), zone);
      var b = DayWindow.Create(date.AddDays(i + 1), zone);
      a.End.ShouldBe(b.Start);
    }
  }

  [Fact]
  public void Contains_IsHalfOpen()
  {
    var w = Window(2026, 10, 26, "UTC");

    w.Contains(w.Start).ShouldBeTrue();
    w.Contains(w.End.AddTicks(-1)).ShouldBeTrue();
    w.Contains(w.End).ShouldBeFalse();
    w.Contains(w.Start.AddTicks(-1)).ShouldBeFalse();
  }

  [Fact]
  public void Create_WithNullZone_Throws()
  {
    Should.Throw<ArgumentNullException>(() => DayWindow.Create(new DateOnly(2026, 10, 26), null!));
  }

  [Theory]
  [InlineData("America/Asuncion", 2024, 10, 6, 4)]
  [InlineData("America/Coyhaique", 2024, 9, 8, 4)]
  public void Create_GapStartingAtMidnightNotReportedInvalid_StartsAtTransition(string id, int y, int mo, int d, int expectedUtcHour)
  {
    // The BCL does not flag 00:00 as invalid here although the clock jumps 00:00 -> 01:00; the previous
    // local date must not leak into the window.
    var zone = TimeZones.FindIana(id);

    var w = DayWindow.Create(new DateOnly(y, mo, d), zone);

    w.Start.ShouldBe(Utc(y, mo, d, expectedUtcHour));
    DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(w.Start, zone).DateTime).ShouldBe(new DateOnly(y, mo, d));
    DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(w.Start.AddTicks(-1), zone).DateTime).ShouldBe(new DateOnly(y, mo, d).AddDays(-1));
  }

  [Fact]
  public void Create_DateSkippedEntirely_IsEmptyAtTheTransition()
  {
    // Pacific/Apia jumped from 2011-12-29 23:59:59 (-10) to 2011-12-31 00:00 (+14).
    var zone = TimeZones.FindIana("Pacific/Apia");
    var skipped = DayWindow.Create(new DateOnly(2011, 12, 30), zone);
    var before = DayWindow.Create(new DateOnly(2011, 12, 29), zone);
    var after = DayWindow.Create(new DateOnly(2011, 12, 31), zone);

    skipped.Length.ShouldBe(TimeSpan.Zero);
    skipped.Start.ShouldBe(Utc(2011, 12, 30, 10));
    before.End.ShouldBe(skipped.Start);
    after.Start.ShouldBe(skipped.End);
    skipped.Contains(skipped.Start).ShouldBeFalse();
  }

  [Fact]
  public void Create_ConsecutiveDays_TileInEverySystemZoneAcrossYears()
  {
    var failures = new List<string>();
    foreach (var zone in TimeZoneInfo.GetSystemTimeZones())
    {
      var date = new DateOnly(2023, 12, 25);
      var previous = DayWindow.Create(date, zone);
      for (var i = 1; i <= 800; i++)
      {
        var current = DayWindow.Create(date.AddDays(i), zone);
        var firstLocal = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(current.Start, zone).DateTime);
        var lastBefore = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(current.Start.AddTicks(-1), zone).DateTime);
        if (previous.End != current.Start
            || current.Length < TimeSpan.Zero
            || (current.Length > TimeSpan.Zero && (firstLocal < current.Date || lastBefore >= current.Date)))
        {
          failures.Add($"{zone.Id} {current.Date}");
        }

        previous = current;
      }
    }

    failures.ShouldBeEmpty();
  }
}
