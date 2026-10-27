using Calendar.Domain.Time;

namespace Calendar.Api.Endpoints;

/// <summary>Collects field errors for a <c>400</c> validation problem.</summary>
internal sealed class FieldErrors
{
  // Dates outside this range are rejected so extreme values (DateOnly.MaxValue, ...) never reach date arithmetic.
  public static readonly DateOnly MinDate = new(1900, 1, 1);
  public static readonly DateOnly MaxDate = new(2200, 12, 31);

  private readonly Dictionary<string, string[]> _errors = new(StringComparer.Ordinal);

  public bool Any => _errors.Count > 0;

  public IDictionary<string, string[]> ToDictionary() => _errors;

  public void Add(string field, string message) =>
      _errors[field] = _errors.TryGetValue(field, out var existing) ? [.. existing, message] : [message];

  public void Require(bool present, string field, string message)
  {
    if (!present)
    {
      Add(field, message);
    }
  }

  public void Forbid(bool present, string field, string message)
  {
    if (present)
    {
      Add(field, message);
    }
  }

  public void CheckDate(DateOnly? date, string field)
  {
    if (date is { } d && (d < MinDate || d > MaxDate))
    {
      Add(field, $"Date must be between {MinDate:yyyy-MM-dd} and {MaxDate:yyyy-MM-dd}.");
    }
  }

  /// <summary>Requires a date (YYYY-MM-DD) within the supported range; returns it, or <c>null</c> when missing.</summary>
  public DateOnly? RequireDate(DateOnly? date, string field)
  {
    if (date is null)
    {
      Add(field, $"{field} is required (YYYY-MM-DD).");
    }
    else
    {
      CheckDate(date, field);
    }

    return date;
  }

  /// <summary>Requires an IANA time zone id; returns the resolved zone, or <c>null</c> when missing or unknown.</summary>
  public TimeZoneInfo? RequireTimeZone(string? timeZone, string field)
  {
    if (string.IsNullOrWhiteSpace(timeZone))
    {
      Add(field, $"{field} is required (IANA id, e.g. America/New_York).");
      return null;
    }

    if (TimeZones.TryFindIana(timeZone, out var zone))
    {
      return zone;
    }

    Add(field, $"'{timeZone}' is not a valid IANA time zone id.");
    return null;
  }

  /// <summary>Maps a domain <see cref="ArgumentException"/> parameter name to the API field it came from.</summary>
  public void AddDomainError(ArgumentException ex)
  {
    var field = ex.ParamName switch
    {
      "timeZoneId" => "timeZone",
      { Length: > 0 } name => name,
      _ => "request",
    };
    var message = ex.Message;
    var paramSuffix = message.IndexOf(" (Parameter", StringComparison.Ordinal);
    Add(field, paramSuffix > 0 ? message[..paramSuffix] : message);
  }
}
