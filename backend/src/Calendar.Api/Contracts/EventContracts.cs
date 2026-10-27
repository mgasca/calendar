using System.Text.Json.Serialization;

namespace Calendar.Api.Contracts;

/// <summary>
/// Create an event. Discriminated by <c>allDay</c>: a timed event needs <c>start</c>, <c>end</c> and
/// <c>timeZone</c>; an all-day event needs <c>startDate</c> and <c>endDate</c> (end exclusive) and no timed fields.
/// </summary>
public sealed record CreateEventRequest
{
  /// <summary>Event title; required, at most 200 characters after trimming.</summary>
  public required string Title { get; init; }

  /// <summary><c>true</c> for an all-day event (<c>startDate</c>/<c>endDate</c>), <c>false</c> for a timed one (<c>start</c>/<c>end</c>/<c>timeZone</c>).</summary>
  public bool AllDay { get; init; }

  /// <summary>Timed events: inclusive start instant, RFC 3339 with an explicit offset (e.g. 2026-10-26T14:00:00Z); <c>null</c> for all-day events.</summary>
  [JsonConverter(typeof(ExplicitOffsetConverter))]
  public DateTimeOffset? Start { get; init; }

  /// <summary>Timed events: exclusive end instant, after <c>start</c>; <c>null</c> for all-day events.</summary>
  [JsonConverter(typeof(ExplicitOffsetConverter))]
  public DateTimeOffset? End { get; init; }

  /// <summary>Timed events: IANA time zone the event was created in, e.g. America/New_York; <c>null</c> for all-day events.</summary>
  public string? TimeZone { get; init; }

  /// <summary>All-day events: first date (YYYY-MM-DD); <c>null</c> for timed events.</summary>
  public DateOnly? StartDate { get; init; }

  /// <summary>All-day events: exclusive end date (YYYY-MM-DD), after <c>startDate</c>; a one-day event on the 26th ends on the 27th. <c>null</c> for timed events.</summary>
  public DateOnly? EndDate { get; init; }

  /// <summary>Optional location, at most 200 characters.</summary>
  public string? Location { get; init; }

  /// <summary>Optional notes, at most 4000 characters.</summary>
  public string? Notes { get; init; }
}

/// <summary>An event as stored. Fields of the other kind are <c>null</c>.</summary>
public sealed record EventResponse
{
  /// <summary>Unique event id.</summary>
  public required Guid Id { get; init; }

  /// <summary>Event title.</summary>
  public required string Title { get; init; }

  /// <summary><c>true</c> for an all-day event, <c>false</c> for a timed one.</summary>
  public required bool AllDay { get; init; }

  /// <summary>Location, or <c>null</c> if none.</summary>
  public string? Location { get; init; }

  /// <summary>Notes, or <c>null</c> if none.</summary>
  public string? Notes { get; init; }

  /// <summary>Timed events: inclusive start instant; <c>null</c> for all-day events.</summary>
  public DateTimeOffset? Start { get; init; }

  /// <summary>Timed events: exclusive end instant; <c>null</c> for all-day events.</summary>
  public DateTimeOffset? End { get; init; }

  /// <summary>Timed events: IANA time zone id; <c>null</c> for all-day events.</summary>
  public string? TimeZone { get; init; }

  /// <summary>All-day events: first date; <c>null</c> for timed events.</summary>
  public DateOnly? StartDate { get; init; }

  /// <summary>All-day events: exclusive end date; <c>null</c> for timed events.</summary>
  public DateOnly? EndDate { get; init; }
}

/// <summary>An all-day event in the day agenda (floating dates, end exclusive).</summary>
public sealed record AllDayEventItem
{
  /// <summary>Unique event id.</summary>
  public required Guid Id { get; init; }

  /// <summary>Event title.</summary>
  public required string Title { get; init; }

  /// <summary>Location, or <c>null</c> if none.</summary>
  public string? Location { get; init; }

  /// <summary>Notes, or <c>null</c> if none.</summary>
  public string? Notes { get; init; }

  /// <summary>First date of the event.</summary>
  public required DateOnly StartDate { get; init; }

  /// <summary>Exclusive end date of the event.</summary>
  public required DateOnly EndDate { get; init; }
}

/// <summary>A timed event in the day agenda.</summary>
public sealed record TimedEventItem
{
  /// <summary>Unique event id.</summary>
  public required Guid Id { get; init; }

  /// <summary>Event title.</summary>
  public required string Title { get; init; }

  /// <summary>Location, or <c>null</c> if none.</summary>
  public string? Location { get; init; }

  /// <summary>Notes, or <c>null</c> if none.</summary>
  public string? Notes { get; init; }

  /// <summary>Inclusive start instant.</summary>
  public required DateTimeOffset Start { get; init; }

  /// <summary>Exclusive end instant.</summary>
  public required DateTimeOffset End { get; init; }

  /// <summary>IANA time zone id the event was created in.</summary>
  public required string TimeZone { get; init; }

  /// <summary>The event began before the day's window (it continues from an earlier day).</summary>
  public required bool StartsBeforeDay { get; init; }

  /// <summary>The event ends after the day's window (it continues into a later day).</summary>
  public required bool EndsAfterDay { get; init; }
}
