namespace Calendar.Domain.Time;

/// <summary>Helpers for IANA time zone ids (e.g. <c>America/New_York</c>).</summary>
public static class TimeZones
{
    /// <summary>
    /// Resolves an IANA zone id. Windows display ids (e.g. "Eastern Standard Time") are rejected so that stored
    /// and exchanged ids are portable: any id containing whitespace is refused, as are blank ids and ids the
    /// host cannot resolve. Legacy IANA ids without a slash (<c>UTC</c>, <c>CET</c>) are accepted.
    /// </summary>
    public static bool TryFindIana(string? id, out TimeZoneInfo zone)
    {
        zone = TimeZoneInfo.Utc;
        if (string.IsNullOrWhiteSpace(id) || id.Any(char.IsWhiteSpace))
        {
            return false;
        }

        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(id);
            return true;
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException or ArgumentException)
        {
            return false;
        }
    }

    public static bool IsValidIanaId(string? id) => TryFindIana(id, out _);

    /// <summary>Resolves an IANA zone id or throws <see cref="ArgumentException"/>.</summary>
    public static TimeZoneInfo FindIana(string? id, string paramName = "timeZoneId") =>
        TryFindIana(id, out var zone)
            ? zone
            : throw new ArgumentException($"'{id}' is not a valid IANA time zone id.", paramName);
}
