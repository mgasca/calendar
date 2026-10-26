using Calendar.Domain.Events;

namespace Calendar.Domain.Tests.Events;

public sealed class CalendarEventTests
{
    private const string NewYork = "America/New_York";
    private static readonly DateTimeOffset Nine = new(2026, 1, 5, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly Day = new(2026, 10, 26);

    [Fact]
    public void Create_WithValidRange_SetsProperties()
    {
        var evt = CalendarEvent.Create("  Standup ", Nine, Nine.AddMinutes(15), NewYork);

        evt.Title.ShouldBe("Standup");
        evt.Duration.ShouldBe(TimeSpan.FromMinutes(15));
        evt.Id.ShouldNotBe(Guid.Empty);
        evt.IsAllDay.ShouldBeFalse();
        evt.TimeZoneId.ShouldBe(NewYork);
        evt.StartDate.ShouldBeNull();
        evt.EndDate.ShouldBeNull();
    }

    [Fact]
    public void Create_NormalizesInstantsToUtc()
    {
        var start = new DateTimeOffset(2026, 1, 5, 4, 0, 0, TimeSpan.FromHours(-5));

        var evt = CalendarEvent.Create("A", start, start.AddHours(1), NewYork);

        evt.Start.ShouldBe(Nine);
        evt.Start!.Value.Offset.ShouldBe(TimeSpan.Zero);
        evt.End!.Value.Offset.ShouldBe(TimeSpan.Zero);
    }

    [Fact]
    public void Create_TrimsOptionalTextAndTurnsBlankIntoNull()
    {
        var evt = CalendarEvent.Create("A", Nine, Nine.AddHours(1), NewYork, " Room 4 ", "   ");

        evt.Location.ShouldBe("Room 4");
        evt.Notes.ShouldBeNull();
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-30)]
    public void Create_WhenEndNotAfterStart_Throws(int offsetMinutes)
    {
        Should.Throw<ArgumentException>(() => CalendarEvent.Create("Bad", Nine, Nine.AddMinutes(offsetMinutes), NewYork));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_WithBlankTitle_Throws(string title)
    {
        Should.Throw<ArgumentException>(() => CalendarEvent.Create(title, Nine, Nine.AddHours(1), NewYork));
    }

    [Fact]
    public void Create_TitleLength_IsCappedAtTwoHundredAfterTrim()
    {
        CalendarEvent.Create(new string('a', 200) + "  ", Nine, Nine.AddHours(1), NewYork).Title.Length.ShouldBe(200);
        Should.Throw<ArgumentException>(() => CalendarEvent.Create(new string('a', 201), Nine, Nine.AddHours(1), NewYork));
    }

    [Fact]
    public void Create_LocationAndNotes_AreCappedAtTheirMaxLengths()
    {
        var ok = CalendarEvent.Create("E", Nine, Nine.AddHours(1), NewYork, new string('l', 200), new string('n', 4000));
        ok.Location.ShouldNotBeNull().Length.ShouldBe(200);
        ok.Notes.ShouldNotBeNull().Length.ShouldBe(4000);

        Should.Throw<ArgumentException>(() => CalendarEvent.Create("E", Nine, Nine.AddHours(1), NewYork, new string('l', 201)));
        Should.Throw<ArgumentException>(() => CalendarEvent.Create("E", Nine, Nine.AddHours(1), NewYork, notes: new string('n', 4001)));
    }

    [Fact]
    public void Create_StoresTheCanonicalZoneId()
    {
        CalendarEvent.Create("E", Nine, Nine.AddHours(1), "utc").TimeZoneId.ShouldBe("UTC");
    }

    [Theory]
    [InlineData("")]
    [InlineData("Nowhere/Land")]
    [InlineData("Eastern Standard Time")]
    public void Create_WithInvalidZone_Throws(string zone)
    {
        Should.Throw<ArgumentException>(() => CalendarEvent.Create("A", Nine, Nine.AddHours(1), zone));
    }

    [Theory]
    [InlineData(30, 90, true)]
    [InlineData(60, 120, false)]
    [InlineData(-60, 0, false)]
    public void Overlaps_DetectsIntersection(int otherStartMinutes, int otherEndMinutes, bool expected)
    {
        var evt = CalendarEvent.Create("A", Nine, Nine.AddHours(1), NewYork);
        var other = CalendarEvent.Create("B", Nine.AddMinutes(otherStartMinutes), Nine.AddMinutes(otherEndMinutes), NewYork);

        evt.Overlaps(other).ShouldBe(expected);
    }

    [Fact]
    public void CreateAllDay_WithValidRange_SetsProperties()
    {
        var evt = CalendarEvent.CreateAllDay(" Holiday ", Day, Day.AddDays(1));

        evt.Title.ShouldBe("Holiday");
        evt.IsAllDay.ShouldBeTrue();
        evt.StartDate.ShouldBe(Day);
        evt.EndDate.ShouldBe(Day.AddDays(1));
        evt.Start.ShouldBeNull();
        evt.End.ShouldBeNull();
        evt.TimeZoneId.ShouldBeNull();
        evt.Duration.ShouldBeNull();
        evt.Id.ShouldNotBe(Guid.Empty);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void CreateAllDay_WhenEndNotAfterStart_Throws(int offsetDays)
    {
        Should.Throw<ArgumentException>(() => CalendarEvent.CreateAllDay("Bad", Day, Day.AddDays(offsetDays)));
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    public void CreateAllDay_WithBlankTitle_Throws(string title)
    {
        Should.Throw<ArgumentException>(() => CalendarEvent.CreateAllDay(title, Day, Day.AddDays(1)));
    }

    [Fact]
    public void CreateAllDay_WithTooLongTitle_Throws()
    {
        Should.Throw<ArgumentException>(() => CalendarEvent.CreateAllDay(new string('a', 201), Day, Day.AddDays(1)));
    }

    [Theory]
    [InlineData(1, 3, true)]
    [InlineData(2, 4, false)]
    [InlineData(-2, 0, false)]
    public void Overlaps_AllDay_UsesExclusiveEnd(int otherStartDays, int otherEndDays, bool expected)
    {
        var evt = CalendarEvent.CreateAllDay("A", Day, Day.AddDays(2));
        var other = CalendarEvent.CreateAllDay("B", Day.AddDays(otherStartDays), Day.AddDays(otherEndDays));

        evt.Overlaps(other).ShouldBe(expected);
    }

    [Fact]
    public void Overlaps_TimedAndAllDay_IsFalse()
    {
        var timed = CalendarEvent.Create("A", Nine, Nine.AddHours(1), NewYork);
        var allDay = CalendarEvent.CreateAllDay("B", new DateOnly(2026, 1, 5), new DateOnly(2026, 1, 6));

        timed.Overlaps(allDay).ShouldBeFalse();
        allDay.Overlaps(timed).ShouldBeFalse();
    }
}
