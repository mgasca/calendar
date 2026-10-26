using System.Text.RegularExpressions;

namespace Calendar.Domain.Time;

/// <summary>Helpers for IANA time zone ids (e.g. <c>America/New_York</c>).</summary>
public static class TimeZones
{
    private const int MaxIdLength = 64;

    // Letters, digits, '_', '+', '-' in segments separated by single slashes: no '..', no empty segments, no
    // leading/trailing slash, no whitespace or dots (which also rules out tzdata files such as zone.tab).
    private static readonly Regex IanaShape = new(
        @"^[A-Za-z0-9_+\-]+(/[A-Za-z0-9_+\-]+)*$",
        RegexOptions.CultureInvariant | RegexOptions.ExplicitCapture,
        TimeSpan.FromMilliseconds(100));

    // Entries of the host's zoneinfo directory that are not zones (or are alternate rule sets of one).
    private static readonly HashSet<string> NotZones = new(StringComparer.OrdinalIgnoreCase)
    {
        "localtime", "posixrules", "Factory", "posix", "right", "SystemV", "leapseconds", "tzdata", "zone", "zone1970", "iso3166", "leap-seconds",
    };

    /// <summary>
    /// Resolves an IANA zone id and never throws for any input. Windows display ids (e.g. "Eastern Standard
    /// Time"), directory-like ids ("America", "America/Indiana"), pseudo entries ("localtime", "Factory") and
    /// non-canonical paths ("America//New_York", "../x") are rejected, as are ids the host cannot resolve.
    /// Legacy IANA ids without a slash (<c>UTC</c>, <c>CET</c>) are accepted. Legacy aliases (<c>Asia/Calcutta</c>,
    /// <c>US/Eastern</c>) are mapped to their canonical id through <see cref="IanaAliases"/>. The returned zone's
    /// <see cref="TimeZoneInfo.Id"/> is the canonical id to store and echo.
    /// </summary>
    public static bool TryFindIana(string? id, out TimeZoneInfo zone)
    {
        zone = TimeZoneInfo.Utc;
        if (string.IsNullOrWhiteSpace(id) || id.Length > MaxIdLength || !IsWellFormed(id))
        {
            return false;
        }

        var firstSegment = id.Split('/')[0];
        if (NotZones.Contains(firstSegment))
        {
            return false;
        }

        // Geographic aliases (Asia/Calcutta, US/Eastern) resolve to their canonical zone on every host, so the stored
        // id does not depend on whether the host ships the legacy links. Slashless ids (CET, EST, UTC) are real
        // files on any tzdata, whose rules can differ from the zone they link to today, so the host is tried first.
        var canonical = IanaAliases.Canonical.GetValueOrDefault(id);
        if (canonical is not null && id.Contains('/', StringComparison.Ordinal))
        {
            return TryLoad(canonical, out zone);
        }

        return TryLoad(id, out zone) || (canonical is not null && TryLoad(canonical, out zone));
    }

    private static bool TryLoad(string id, out TimeZoneInfo zone)
    {
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(id);
            return true;
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            // Not found, invalid data, a directory (SecurityException), I/O errors: all just "not a zone".
            zone = TimeZoneInfo.Utc;
            return false;
        }
    }

    private static bool IsWellFormed(string id)
    {
        try
        {
            return IanaShape.IsMatch(id);
        }
        catch (RegexMatchTimeoutException)
        {
            return false;
        }
    }

    public static bool IsValidIanaId(string? id) => TryFindIana(id, out _);

    /// <summary>Resolves an IANA zone id (see <see cref="TryFindIana"/>) or throws <see cref="ArgumentException"/>.</summary>
    public static TimeZoneInfo FindIana(string? id, string paramName = "timeZoneId") =>
        TryFindIana(id, out var zone)
            ? zone
            : throw new ArgumentException($"'{id}' is not a valid IANA time zone id.", paramName);
}
