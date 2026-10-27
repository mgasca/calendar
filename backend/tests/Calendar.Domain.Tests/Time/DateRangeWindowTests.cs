using System.Globalization;
using Calendar.Domain.Time;

namespace Calendar.Domain.Tests.Time;

public sealed class DateRangeWindowTests
{
  private static DateOnly Date(int y, int mo, int d) => new(y, mo, d);

  private static DateTimeOffset Utc(int y, int mo, int d, int h, int mi = 0) => new(y, mo, d, h, mi, 0, TimeSpan.Zero);

  private static void ShouldTile(DateRangeWindow range)
  {
    range.Start.ShouldBe(range.Days[0].Start);
    range.End.ShouldBe(range.Days[^1].End);
    for (var i = 0; i < range.Days.Count; i++)
    {
      range.Days[i].Date.ShouldBe(range.StartDate.AddDays(i));
      range.Days[i].ShouldBe(DayWindow.Create(range.Days[i].Date, range.Zone));
      if (i > 0)
      {
        range.Days[i].Start.ShouldBe(range.Days[i - 1].End);
      }
    }
  }

  // ---- ranges of any length ----

  [Fact]
  public void Create_OneDay_IsThatDaysWindow()
  {
    var zone = TimeZones.FindIana("America/New_York");

    var range = DateRangeWindow.Create(Date(2026, 10, 26), 1, zone);

    range.Days.ShouldHaveSingleItem().ShouldBe(DayWindow.Create(Date(2026, 10, 26), zone));
    range.StartDate.ShouldBe(Date(2026, 10, 26));
    range.EndDate.ShouldBe(Date(2026, 10, 27));
    range.Start.ShouldBe(Utc(2026, 10, 26, 4));
    range.End.ShouldBe(Utc(2026, 10, 27, 4));
    range.Zone.ShouldBe(zone);
  }

  [Fact]
  public void Create_SevenDays_TilesConsecutiveDays()
  {
    var range = DateRangeWindow.Create(Date(2026, 10, 28), 7, TimeZones.FindIana("Asia/Kolkata"));

    range.Days.Count.ShouldBe(7);
    range.StartDate.ShouldBe(Date(2026, 10, 28));
    range.EndDate.ShouldBe(Date(2026, 11, 4));
    range.Start.ShouldBe(Utc(2026, 10, 27, 18, 30));
    (range.End - range.Start).ShouldBe(TimeSpan.FromDays(7));
    ShouldTile(range);
  }

  [Fact]
  public void Create_FortyTwoDays_CoversAMonthGridAcrossADstChange()
  {
    // A six-week month grid for October 2026 in Berlin, which falls back on 2026-10-25.
    var range = DateRangeWindow.Create(Date(2026, 9, 28), 42, TimeZones.FindIana("Europe/Berlin"));

    range.Days.Count.ShouldBe(42);
    range.EndDate.ShouldBe(Date(2026, 11, 9));
    range.Start.ShouldBe(Utc(2026, 9, 27, 22));
    range.End.ShouldBe(Utc(2026, 11, 8, 23));
    (range.End - range.Start).ShouldBe(TimeSpan.FromHours((42 * 24) + 1));
    ShouldTile(range);
  }

  [Theory]
  [InlineData(0)]
  [InlineData(-1)]
  public void Create_WithoutDays_Throws(int dayCount) =>
      Should.Throw<ArgumentOutOfRangeException>(() => DateRangeWindow.Create(Date(2026, 10, 26), dayCount, TimeZoneInfo.Utc));

  [Fact]
  public void Create_WithoutZone_Throws() =>
      Should.Throw<ArgumentNullException>(() => DateRangeWindow.Create(Date(2026, 10, 26), 1, null!));

  // ---- ISO weeks ----

  [Theory]
  [InlineData("2026-10-26", "2026-10-26")] // Monday
  [InlineData("2026-10-28", "2026-10-26")] // Wednesday
  [InlineData("2026-11-01", "2026-10-26")] // Sunday
  [InlineData("2027-01-01", "2026-12-28")] // Friday; the week starts in the previous year (ISO 2026-W53)
  [InlineData("2027-01-03", "2026-12-28")] // Sunday of that week
  [InlineData("2026-01-01", "2025-12-29")] // ISO 2026-W01 starts in December 2025
  [InlineData("2024-12-31", "2024-12-30")] // ISO 2025-W01 starts in December 2024
  [InlineData("2024-02-29", "2024-02-26")] // leap day
  public void IsoWeek_SnapsAnyDateToItsMonday(string date, string monday)
  {
    var range = DateRangeWindow.IsoWeek(DateOnly.Parse(date, CultureInfo.InvariantCulture), TimeZoneInfo.Utc);

    range.StartDate.ShouldBe(DateOnly.Parse(monday, CultureInfo.InvariantCulture));
    range.StartDate.DayOfWeek.ShouldBe(DayOfWeek.Monday);
    range.Days.Count.ShouldBe(7);
    range.Days[^1].Date.DayOfWeek.ShouldBe(DayOfWeek.Sunday);
  }

  [Fact]
  public void IsoWeek_WeekOneCanStartInDecember()
  {
    var monday = DateRangeWindow.IsoWeekStart(Date(2026, 1, 1));

    monday.ShouldBe(Date(2025, 12, 29));
    ISOWeek.GetYear(monday.ToDateTime(TimeOnly.MinValue)).ShouldBe(2026);
    ISOWeek.GetWeekOfYear(monday.ToDateTime(TimeOnly.MinValue)).ShouldBe(1);
  }

  [Fact]
  public void IsoWeekStart_AgreesWithTheBclIsoCalendar_AcrossYearBoundaries()
  {
    for (var date = Date(2019, 12, 1); date <= Date(2032, 1, 31); date = date.AddDays(1))
    {
      var dateTime = date.ToDateTime(TimeOnly.MinValue);
      var expected = ISOWeek.ToDateTime(ISOWeek.GetYear(dateTime), ISOWeek.GetWeekOfYear(dateTime), DayOfWeek.Monday);

      DateRangeWindow.IsoWeekStart(date).ShouldBe(DateOnly.FromDateTime(expected), date.ToString("O", CultureInfo.InvariantCulture));
    }
  }

  [Fact]
  public void IsoWeek_BerlinFallBackWeek_Has169Hours()
  {
    // Berlin falls back on Sunday 2026-10-25 at 03:00 CEST: that day is 25 hours long.
    var range = DateRangeWindow.IsoWeek(Date(2026, 10, 25), TimeZones.FindIana("Europe/Berlin"));

    range.StartDate.ShouldBe(Date(2026, 10, 19));
    range.Start.ShouldBe(Utc(2026, 10, 18, 22));
    range.End.ShouldBe(Utc(2026, 10, 25, 23));
    (range.End - range.Start).ShouldBe(TimeSpan.FromHours(169));
    range.Days[6].Length.ShouldBe(TimeSpan.FromHours(25));
    range.Days.Take(6).ShouldAllBe(d => d.Length == TimeSpan.FromHours(24));
    ShouldTile(range);
  }

  [Fact]
  public void IsoWeek_SantiagoSpringForwardWeek_Has167Hours_AndTheSkippedMidnightStartsAtTheTransition()
  {
    // Santiago skips local midnight on Sunday 2026-09-06 (00:00 -04 becomes 01:00 -03).
    var range = DateRangeWindow.IsoWeek(Date(2026, 9, 2), TimeZones.FindIana("America/Santiago"));

    range.StartDate.ShouldBe(Date(2026, 8, 31));
    range.Start.ShouldBe(Utc(2026, 8, 31, 4));
    range.End.ShouldBe(Utc(2026, 9, 7, 3));
    (range.End - range.Start).ShouldBe(TimeSpan.FromHours(167));
    range.Days[6].Start.ShouldBe(Utc(2026, 9, 6, 4));
    range.Days[6].Length.ShouldBe(TimeSpan.FromHours(23));
    ShouldTile(range);
  }

  [Fact]
  public void IsoWeek_WithASkippedDate_HasAnEmptyDay()
  {
    // Pacific/Apia skipped Friday 2011-12-30 entirely when it moved across the date line.
    var range = DateRangeWindow.IsoWeek(Date(2011, 12, 30), TimeZones.FindIana("Pacific/Apia"));

    range.StartDate.ShouldBe(Date(2011, 12, 26));
    range.Days.Count.ShouldBe(7);
    var skipped = range.Days[4];
    skipped.Date.ShouldBe(Date(2011, 12, 30));
    skipped.Length.ShouldBe(TimeSpan.Zero);
    skipped.Start.ShouldBe(Utc(2011, 12, 30, 10));
    range.Start.ShouldBe(Utc(2011, 12, 26, 10));
    range.End.ShouldBe(Utc(2012, 1, 1, 10));
    (range.End - range.Start).ShouldBe(TimeSpan.FromHours(6 * 24));
    ShouldTile(range);
  }
}
