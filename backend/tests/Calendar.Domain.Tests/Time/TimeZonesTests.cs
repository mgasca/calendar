using Calendar.Domain.Time;

namespace Calendar.Domain.Tests.Time;

public sealed class TimeZonesTests
{
    [Theory]
    [InlineData("America/New_York")]
    [InlineData("Europe/London")]
    [InlineData("Asia/Kolkata")]
    [InlineData("UTC")]
    public void IsValidIanaId_AcceptsIanaIds(string id)
    {
        TimeZones.IsValidIanaId(id).ShouldBeTrue();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("Nowhere/Land")]
    [InlineData("Eastern Standard Time")]
    [InlineData("W. Europe Standard Time")]
    [InlineData(" America/New_York")]
    [InlineData("../etc/passwd")]
    public void IsValidIanaId_RejectsBlankUnknownAndWindowsIds(string? id)
    {
        TimeZones.IsValidIanaId(id).ShouldBeFalse();
    }

    [Fact]
    public void FindIana_ReturnsZone()
    {
        TimeZones.FindIana("Europe/London").Id.ShouldBe("Europe/London");
    }

    [Fact]
    public void FindIana_WithInvalidId_Throws()
    {
        Should.Throw<ArgumentException>(() => TimeZones.FindIana("Nope"));
    }
}
