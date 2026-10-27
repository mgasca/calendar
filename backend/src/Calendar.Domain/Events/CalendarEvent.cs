using Calendar.Domain.Time;

namespace Calendar.Domain.Events;

/// <summary>
/// A scheduled occurrence on a calendar: either <b>timed</b> (UTC instants plus the IANA zone it was created in)
/// or <b>all-day</b> (floating dates, end exclusive, no zone).
/// </summary>
/// <remarks>
/// Properties that do not apply to the event's kind are <c>null</c>. The type is a plain class with a private
/// parameterless constructor and private setters so persistence can materialize it without leaking into Domain.
/// </remarks>
public sealed class CalendarEvent
{
  private CalendarEvent()
  {
    Title = string.Empty;
  }

  /// <summary>Unique id, generated on creation.</summary>
  public Guid Id { get; private set; }

  /// <summary>Normalized, non-empty title.</summary>
  public string Title { get; private set; }

  /// <summary>Optional location; <c>null</c> when not set.</summary>
  public string? Location { get; private set; }

  /// <summary>Optional free-form notes; <c>null</c> when not set.</summary>
  public string? Notes { get; private set; }

  /// <summary>True for an all-day event (floating dates), false for a timed event.</summary>
  public bool IsAllDay { get; private set; }

  /// <summary>Timed events only: inclusive start, UTC (offset zero).</summary>
  public DateTimeOffset? Start { get; private set; }

  /// <summary>Timed events only: exclusive end, UTC (offset zero), after <see cref="Start"/>.</summary>
  public DateTimeOffset? End { get; private set; }

  /// <summary>Timed events only: IANA zone id the event was created in.</summary>
  public string? TimeZoneId { get; private set; }

  /// <summary>All-day events only: first date (floating).</summary>
  public DateOnly? StartDate { get; private set; }

  /// <summary>All-day events only: exclusive end date, after <see cref="StartDate"/>.</summary>
  public DateOnly? EndDate { get; private set; }

  /// <summary>Length of a timed event; <c>null</c> for all-day events.</summary>
  public TimeSpan? Duration => End - Start;

  /// <summary>Creates a timed event. Instants are normalized to UTC; <paramref name="timeZoneId"/> must be IANA.</summary>
  public static CalendarEvent Create(
      string title,
      DateTimeOffset start,
      DateTimeOffset end,
      string timeZoneId,
      string? location = null,
      string? notes = null)
  {
    var normalizedTitle = Validation.NormalizeTitle(title, nameof(title));
    if (end <= start)
    {
      throw new ArgumentException("Event end must be after its start.", nameof(end));
    }

    var zone = TimeZones.FindIana(timeZoneId);

    return new CalendarEvent
    {
      Id = Guid.NewGuid(),
      Title = normalizedTitle,
      Location = Validation.NormalizeOptional(location, Validation.MaxLocationLength, nameof(location)),
      Notes = Validation.NormalizeOptional(notes, Validation.MaxNotesLength, nameof(notes)),
      IsAllDay = false,
      Start = start.ToUniversalTime(),
      End = end.ToUniversalTime(),
      TimeZoneId = zone.Id,
    };
  }

  /// <summary>Creates an all-day event covering <c>[startDate, endDate)</c> (end exclusive).</summary>
  public static CalendarEvent CreateAllDay(
      string title,
      DateOnly startDate,
      DateOnly endDate,
      string? location = null,
      string? notes = null)
  {
    var normalizedTitle = Validation.NormalizeTitle(title, nameof(title));
    if (endDate <= startDate)
    {
      throw new ArgumentException("All-day event end date must be after its start date (end is exclusive).", nameof(endDate));
    }

    return new CalendarEvent
    {
      Id = Guid.NewGuid(),
      Title = normalizedTitle,
      Location = Validation.NormalizeOptional(location, Validation.MaxLocationLength, nameof(location)),
      Notes = Validation.NormalizeOptional(notes, Validation.MaxNotesLength, nameof(notes)),
      IsAllDay = true,
      StartDate = startDate,
      EndDate = endDate,
    };
  }

  /// <summary>
  /// True when both events are of the same kind and their spans intersect (half-open, so back-to-back events do
  /// not overlap). A timed and an all-day event never overlap here: all-day dates are floating and have no
  /// instant range without picking a zone.
  /// </summary>
  public bool Overlaps(CalendarEvent other)
  {
    ArgumentNullException.ThrowIfNull(other);
    if (IsAllDay != other.IsAllDay)
    {
      return false;
    }

    return IsAllDay
        ? StartDate < other.EndDate && other.StartDate < EndDate
        : Start < other.End && other.Start < End;
  }
}
