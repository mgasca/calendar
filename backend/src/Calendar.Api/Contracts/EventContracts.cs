using System.ComponentModel;
using System.Text.Json.Serialization;

namespace Calendar.Api.Contracts;

/// <summary>
/// Create an event. Discriminated by <see cref="AllDay"/>: a timed event needs <c>start</c>, <c>end</c> and
/// <c>timeZone</c>; an all-day event needs <c>startDate</c> and <c>endDate</c> (end exclusive) and no timed fields.
/// </summary>
public sealed record CreateEventRequest
{
  [Description("Required, at most 200 characters after trimming.")]
  public required string Title { get; init; }

  [Description("True for an all-day event (startDate/endDate), false for a timed one (start/end/timeZone).")]
  public bool AllDay { get; init; }

  [Description("Timed events: inclusive start instant, RFC 3339 with an explicit offset (e.g. 2026-10-26T14:00:00Z).")]
  [JsonConverter(typeof(ExplicitOffsetConverter))]
  public DateTimeOffset? Start { get; init; }

  [Description("Timed events: exclusive end instant, after start.")]
  [JsonConverter(typeof(ExplicitOffsetConverter))]
  public DateTimeOffset? End { get; init; }

  [Description("Timed events: IANA time zone the event was created in, e.g. America/New_York.")]
  public string? TimeZone { get; init; }

  [Description("All-day events: first date (YYYY-MM-DD).")]
  public DateOnly? StartDate { get; init; }

  [Description("All-day events: exclusive end date (YYYY-MM-DD), after startDate; a one-day event on the 26th ends on the 27th.")]
  public DateOnly? EndDate { get; init; }

  [Description("Optional, at most 200 characters.")]
  public string? Location { get; init; }

  [Description("Optional, at most 4000 characters.")]
  public string? Notes { get; init; }
}

/// <summary>An event as stored. Fields of the other kind are <c>null</c>.</summary>
public sealed record EventResponse
{
  public required Guid Id { get; init; }

  public required string Title { get; init; }

  public required bool AllDay { get; init; }

  public string? Location { get; init; }

  public string? Notes { get; init; }

  public DateTimeOffset? Start { get; init; }

  public DateTimeOffset? End { get; init; }

  public string? TimeZone { get; init; }

  public DateOnly? StartDate { get; init; }

  public DateOnly? EndDate { get; init; }
}

/// <summary>An all-day event in the day agenda (floating dates, end exclusive).</summary>
public sealed record AllDayEventItem
{
  public required Guid Id { get; init; }

  public required string Title { get; init; }

  public string? Location { get; init; }

  public string? Notes { get; init; }

  public required DateOnly StartDate { get; init; }

  public required DateOnly EndDate { get; init; }
}

/// <summary>A timed event in the day agenda.</summary>
public sealed record TimedEventItem
{
  public required Guid Id { get; init; }

  public required string Title { get; init; }

  public string? Location { get; init; }

  public string? Notes { get; init; }

  public required DateTimeOffset Start { get; init; }

  public required DateTimeOffset End { get; init; }

  public required string TimeZone { get; init; }

  [Description("The event began before the day's window (it continues from an earlier day).")]
  public required bool StartsBeforeDay { get; init; }

  [Description("The event ends after the day's window (it continues into a later day).")]
  public required bool EndsAfterDay { get; init; }
}
