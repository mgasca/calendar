using Calendar.Domain.Events;

namespace Calendar.Domain.Tests.Events;

public sealed class CalendarEventTests
{
  private const string NewYork = "America/New_York";
  private static readonly Guid Owner = Guid.NewGuid();
  private static readonly DateTimeOffset Nine = new(2026, 1, 5, 9, 0, 0, TimeSpan.Zero);
  private static readonly DateOnly Day = new(2026, 10, 26);

  [Fact]
  public void Create_WithValidRange_SetsProperties()
  {
    var evt = CalendarEvent.Create(Owner, "  Standup ", Nine, Nine.AddMinutes(15), NewYork);

    evt.Title.ShouldBe("Standup");
    evt.Duration.ShouldBe(TimeSpan.FromMinutes(15));
    evt.Id.ShouldNotBe(Guid.Empty);
    evt.IsAllDay.ShouldBeFalse();
    evt.TimeZoneId.ShouldBe(NewYork);
    evt.StartDate.ShouldBeNull();
    evt.EndDate.ShouldBeNull();
  }

  [Fact]
  public void Create_SetsTheOwner_AndRejectsAnEmptyOne()
  {
    CalendarEvent.Create(Owner, "A", Nine, Nine.AddHours(1), NewYork).OwnerId.ShouldBe(Owner);
    CalendarEvent.CreateAllDay(Owner, "A", Day, Day.AddDays(1)).OwnerId.ShouldBe(Owner);

    Should.Throw<ArgumentException>(() => CalendarEvent.Create(Guid.Empty, "A", Nine, Nine.AddHours(1), NewYork))
      .ParamName.ShouldBe("ownerId");
    Should.Throw<ArgumentException>(() => CalendarEvent.CreateAllDay(Guid.Empty, "A", Day, Day.AddDays(1)))
      .ParamName.ShouldBe("ownerId");
  }

  [Fact]
  public void Create_NormalizesInstantsToUtc()
  {
    var start = new DateTimeOffset(2026, 1, 5, 4, 0, 0, TimeSpan.FromHours(-5));

    var evt = CalendarEvent.Create(Owner, "A", start, start.AddHours(1), NewYork);

    evt.Start.ShouldBe(Nine);
    evt.Start!.Value.Offset.ShouldBe(TimeSpan.Zero);
    evt.End!.Value.Offset.ShouldBe(TimeSpan.Zero);
  }

  [Fact]
  public void Create_TrimsOptionalTextAndTurnsBlankIntoNull()
  {
    var evt = CalendarEvent.Create(Owner, "A", Nine, Nine.AddHours(1), NewYork, " Room 4 ", "   ");

    evt.Location.ShouldBe("Room 4");
    evt.Notes.ShouldBeNull();
  }

  [Theory]
  [InlineData(0)]
  [InlineData(-30)]
  public void Create_WhenEndNotAfterStart_Throws(int offsetMinutes) =>
    Should.Throw<ArgumentException>(() => CalendarEvent.Create(Owner, "Bad", Nine, Nine.AddMinutes(offsetMinutes), NewYork));

  [Theory]
  [InlineData("")]
  [InlineData("   ")]
  public void Create_WithBlankTitle_Throws(string title) =>
    Should.Throw<ArgumentException>(() => CalendarEvent.Create(Owner, title, Nine, Nine.AddHours(1), NewYork));

  [Fact]
  public void Create_TitleLength_IsCappedAtTwoHundredAfterTrim()
  {
    CalendarEvent.Create(Owner, new string('a', 200) + "  ", Nine, Nine.AddHours(1), NewYork).Title.Length.ShouldBe(200);
    Should.Throw<ArgumentException>(() => CalendarEvent.Create(Owner, new string('a', 201), Nine, Nine.AddHours(1), NewYork));
  }

  [Fact]
  public void Create_LocationAndNotes_AreCappedAtTheirMaxLengths()
  {
    var ok = CalendarEvent.Create(Owner, "E", Nine, Nine.AddHours(1), NewYork, new string('l', 200), new string('n', 4000));
    ok.Location.ShouldNotBeNull().Length.ShouldBe(200);
    ok.Notes.ShouldNotBeNull().Length.ShouldBe(4000);

    Should.Throw<ArgumentException>(() => CalendarEvent.Create(Owner, "E", Nine, Nine.AddHours(1), NewYork, new string('l', 201)));
    Should.Throw<ArgumentException>(() => CalendarEvent.Create(Owner, "E", Nine, Nine.AddHours(1), NewYork, notes: new string('n', 4001)));
  }

  [Fact]
  public void Create_StoresTheCanonicalZoneId() =>
    CalendarEvent.Create(Owner, "E", Nine, Nine.AddHours(1), "utc").TimeZoneId.ShouldBe("UTC");

  [Theory]
  [InlineData("")]
  [InlineData("Nowhere/Land")]
  [InlineData("Eastern Standard Time")]
  public void Create_WithInvalidZone_Throws(string zone) =>
    Should.Throw<ArgumentException>(() => CalendarEvent.Create(Owner, "A", Nine, Nine.AddHours(1), zone));

  [Theory]
  [InlineData(30, 90, true)]
  [InlineData(60, 120, false)]
  [InlineData(-60, 0, false)]
  public void Overlaps_DetectsIntersection(int otherStartMinutes, int otherEndMinutes, bool expected)
  {
    var evt = CalendarEvent.Create(Owner, "A", Nine, Nine.AddHours(1), NewYork);
    var other = CalendarEvent.Create(Owner, "B", Nine.AddMinutes(otherStartMinutes), Nine.AddMinutes(otherEndMinutes), NewYork);

    evt.Overlaps(other).ShouldBe(expected);
  }

  [Fact]
  public void CreateAllDay_WithValidRange_SetsProperties()
  {
    var evt = CalendarEvent.CreateAllDay(Owner, " Holiday ", Day, Day.AddDays(1));

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
  public void CreateAllDay_WhenEndNotAfterStart_Throws(int offsetDays) =>
    Should.Throw<ArgumentException>(() => CalendarEvent.CreateAllDay(Owner, "Bad", Day, Day.AddDays(offsetDays)));

  [Theory]
  [InlineData("")]
  [InlineData(" ")]
  public void CreateAllDay_WithBlankTitle_Throws(string title) =>
    Should.Throw<ArgumentException>(() => CalendarEvent.CreateAllDay(Owner, title, Day, Day.AddDays(1)));

  [Fact]
  public void CreateAllDay_WithTooLongTitle_Throws() =>
    Should.Throw<ArgumentException>(() => CalendarEvent.CreateAllDay(Owner, new string('a', 201), Day, Day.AddDays(1)));

  [Theory]
  [InlineData(1, 3, true)]
  [InlineData(2, 4, false)]
  [InlineData(-2, 0, false)]
  public void Overlaps_AllDay_UsesExclusiveEnd(int otherStartDays, int otherEndDays, bool expected)
  {
    var evt = CalendarEvent.CreateAllDay(Owner, "A", Day, Day.AddDays(2));
    var other = CalendarEvent.CreateAllDay(Owner, "B", Day.AddDays(otherStartDays), Day.AddDays(otherEndDays));

    evt.Overlaps(other).ShouldBe(expected);
  }

  [Fact]
  public void Overlaps_TimedAndAllDay_IsFalse()
  {
    var timed = CalendarEvent.Create(Owner, "A", Nine, Nine.AddHours(1), NewYork);
    var allDay = CalendarEvent.CreateAllDay(Owner, "B", new DateOnly(2026, 1, 5), new DateOnly(2026, 1, 6));

    timed.Overlaps(allDay).ShouldBeFalse();
    allDay.Overlaps(timed).ShouldBeFalse();
  }

  [Fact]
  public void Update_ReplacesTheFields_AndKeepsIdAndOwner()
  {
    var evt = CalendarEvent.Create(Owner, "Standup", Nine, Nine.AddMinutes(15), NewYork, "Room 1", "Agenda");
    Guid id = evt.Id;

    evt.Update(" Retro ", Nine.AddHours(1).ToOffset(TimeSpan.FromHours(-5)), Nine.AddHours(2), "Europe/Madrid");

    evt.Id.ShouldBe(id);
    evt.OwnerId.ShouldBe(Owner);
    evt.Title.ShouldBe("Retro");
    evt.Start.ShouldBe(Nine.AddHours(1));
    evt.Start!.Value.Offset.ShouldBe(TimeSpan.Zero);
    evt.End.ShouldBe(Nine.AddHours(2));
    evt.TimeZoneId.ShouldBe("Europe/Madrid");
    evt.Location.ShouldBeNull();
    evt.Notes.ShouldBeNull();
  }

  [Fact]
  public void UpdateAllDay_TurnsATimedEventIntoAnAllDayOne_AndBack()
  {
    var evt = CalendarEvent.Create(Owner, "Standup", Nine, Nine.AddMinutes(15), NewYork);

    evt.UpdateAllDay("Offsite", Day, Day.AddDays(2), "Lodge", "Bring boots");

    evt.IsAllDay.ShouldBeTrue();
    evt.StartDate.ShouldBe(Day);
    evt.EndDate.ShouldBe(Day.AddDays(2));
    evt.Start.ShouldBeNull();
    evt.End.ShouldBeNull();
    evt.TimeZoneId.ShouldBeNull();
    evt.Location.ShouldBe("Lodge");
    evt.Notes.ShouldBe("Bring boots");

    evt.Update("Standup", Nine, Nine.AddHours(1), NewYork);

    evt.IsAllDay.ShouldBeFalse();
    evt.StartDate.ShouldBeNull();
    evt.EndDate.ShouldBeNull();
    evt.Start.ShouldBe(Nine);
  }

  [Fact]
  public void Update_WithInvalidValues_Throws_AndChangesNothing()
  {
    var evt = CalendarEvent.Create(Owner, "Standup", Nine, Nine.AddMinutes(15), NewYork, "Room 1");

    Should.Throw<ArgumentException>(() => evt.Update("Standup", Nine, Nine, NewYork)).ParamName.ShouldBe("end");
    Should.Throw<ArgumentException>(() => evt.Update("  ", Nine, Nine.AddHours(1), NewYork)).ParamName.ShouldBe("title");
    Should.Throw<ArgumentException>(() => evt.Update("A", Nine, Nine.AddHours(1), "Not/AZone")).ParamName.ShouldBe("timeZoneId");
    Should.Throw<ArgumentException>(() => evt.UpdateAllDay("A", Day, Day)).ParamName.ShouldBe("endDate");

    evt.Title.ShouldBe("Standup");
    evt.End.ShouldBe(Nine.AddMinutes(15));
    evt.Location.ShouldBe("Room 1");
    evt.IsAllDay.ShouldBeFalse();
  }
}
