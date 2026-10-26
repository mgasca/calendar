using Calendar.Domain.Events;

namespace Calendar.Domain.Tests.Events;

public sealed class CalendarEventTests
{
    private static readonly DateTimeOffset Nine = new(2026, 1, 5, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Create_WithValidRange_SetsProperties()
    {
        var evt = CalendarEvent.Create("  Standup ", Nine, Nine.AddMinutes(15));

        evt.Title.ShouldBe("Standup");
        evt.Duration.ShouldBe(TimeSpan.FromMinutes(15));
        evt.Id.ShouldNotBe(Guid.Empty);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-30)]
    public void Create_WhenEndNotAfterStart_Throws(int offsetMinutes)
    {
        Should.Throw<ArgumentException>(() => CalendarEvent.Create("Bad", Nine, Nine.AddMinutes(offsetMinutes)));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_WithBlankTitle_Throws(string title)
    {
        Should.Throw<ArgumentException>(() => CalendarEvent.Create(title, Nine, Nine.AddHours(1)));
    }

    [Theory]
    [InlineData(30, 90, true)]
    [InlineData(60, 120, false)]
    [InlineData(-60, 0, false)]
    public void Overlaps_DetectsIntersection(int otherStartMinutes, int otherEndMinutes, bool expected)
    {
        var evt = CalendarEvent.Create("A", Nine, Nine.AddHours(1));
        var other = CalendarEvent.Create("B", Nine.AddMinutes(otherStartMinutes), Nine.AddMinutes(otherEndMinutes));

        evt.Overlaps(other).ShouldBe(expected);
    }
}
