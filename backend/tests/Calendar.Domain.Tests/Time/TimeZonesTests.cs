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
    [InlineData("America")]
    [InlineData("Etc")]
    [InlineData("America/Indiana")]
    [InlineData("localtime")]
    [InlineData("posixrules")]
    [InlineData("Factory")]
    [InlineData("posix/America/New_York")]
    [InlineData("America//New_York")]
    [InlineData("/America/New_York")]
    [InlineData("America/New_York/")]
    [InlineData("America/../America/New_York")]
    [InlineData("zone.tab")]
    public void IsValidIanaId_RejectsBlankUnknownAndWindowsIds(string? id)
    {
        TimeZones.IsValidIanaId(id).ShouldBeFalse();
    }

    [Theory]
    [InlineData("utc", "UTC")]
    [InlineData("America/New_York", "America/New_York")]
    public void TryFindIana_ReturnsCanonicalId(string input, string canonical)
    {
        TimeZones.TryFindIana(input, out var zone).ShouldBeTrue();
        zone.Id.ShouldBe(canonical);
    }

    [Fact]
    public void TryFindIana_WithVeryLongOrOddInput_ReturnsFalseWithoutThrowing()
    {
        TimeZones.IsValidIanaId(new string('a', 5000)).ShouldBeFalse();
        TimeZones.IsValidIanaId("America/New_York\0").ShouldBeFalse();
        TimeZones.IsValidIanaId("\u00c5/\u00d6").ShouldBeFalse();
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
