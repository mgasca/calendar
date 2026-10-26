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

    [Theory]
    [InlineData("Asia/Calcutta", "Asia/Kolkata")]
    [InlineData("Europe/Kiev", "Europe/Kyiv")]
    [InlineData("US/Eastern", "America/New_York")]
    [InlineData("US/Pacific", "America/Los_Angeles")]
    [InlineData("Australia/ACT", "Australia/Sydney")]
    [InlineData("Asia/Saigon", "Asia/Ho_Chi_Minh")]
    [InlineData("America/Buenos_Aires", "America/Argentina/Buenos_Aires")]
    [InlineData("Etc/Zulu", "Etc/UTC")]
    public void TryFindIana_MapsLegacyAliasesToTheCanonicalId(string alias, string canonical)
    {
        TimeZones.TryFindIana(alias, out var zone).ShouldBeTrue();
        zone.Id.ShouldBe(canonical);
    }

    [Fact]
    public void TryFindIana_ResolvesEveryAliasInTheTable()
    {
        foreach (var (alias, canonical) in IanaAliases.Canonical)
        {
            TimeZones.TryFindIana(alias, out var zone).ShouldBeTrue(alias);
            if (alias.Contains('/', StringComparison.Ordinal))
            {
                zone.Id.ShouldBe(canonical, alias);
            }
        }
    }

    [Theory]
    [InlineData("Etc/GMT+5", -5)]
    [InlineData("Etc/GMT-14", 14)]
    [InlineData("Etc/GMT", 0)]
    public void TryFindIana_AcceptsEtcGmtOffsetZones(string id, int hours)
    {
        TimeZones.TryFindIana(id, out var zone).ShouldBeTrue();
        zone.Id.ShouldBe(id);
        zone.BaseUtcOffset.ShouldBe(TimeSpan.FromHours(hours));
    }

    [Theory]
    [InlineData("Asia/Calcutta/")]
    [InlineData("asia/calcutta")]
    [InlineData("US//Eastern")]
    public void TryFindIana_StillRejectsMalformedOrWrongCaseAliases(string id)
    {
        TimeZones.IsValidIanaId(id).ShouldBeFalse();
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
