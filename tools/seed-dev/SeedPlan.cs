using System.Text.Json;
using System.Text.Json.Serialization;

namespace SeedDev;

/// <summary>A POST /api/events body. Timed events set Start/End/TimeZone; all-day events set AllDay/StartDate/EndDate.</summary>
public sealed record EventSeed(
    string Title,
    bool? AllDay = null,
    DateTimeOffset? Start = null,
    DateTimeOffset? End = null,
    string? TimeZone = null,
    DateOnly? StartDate = null,
    DateOnly? EndDate = null,
    string? Location = null,
    string? Notes = null);

/// <summary>A POST /api/tasks body, plus whether to complete it afterwards via POST /api/tasks/{id}/complete.</summary>
public sealed record TaskSeed(string Title, DateOnly? DueDate = null, DateTimeOffset? DueAt = null, bool CompleteAfterCreate = false);

/// <summary>Everything the seed creates for one day.</summary>
public sealed record SeedPlan(IReadOnlyList<EventSeed> Events, IReadOnlyList<TaskSeed> Tasks)
{
  /// <summary>Builds a realistic day of sample data around <paramref name="date"/> as seen in <paramref name="zone"/>.</summary>
  public static SeedPlan Build(DateOnly date, TimeZoneInfo zone)
  {
    var tz = zone.Id;
    EventSeed Timed(string title, int dayOffset, string start, int endDayOffset, string end, string? location = null) =>
        new(title, Start: At(date.AddDays(dayOffset), TimeOnly.Parse(start, System.Globalization.CultureInfo.InvariantCulture), zone),
            End: At(date.AddDays(endDayOffset), TimeOnly.Parse(end, System.Globalization.CultureInfo.InvariantCulture), zone),
            TimeZone: tz, Location: location);

    EventSeed[] events =
    [
        Timed("Team standup", 0, "09:30", 0, "10:00", "Zoom"),
            Timed("Design review", 0, "10:30", 0, "12:00", "Room 4B"),
            Timed("1:1 with Sam", 0, "11:00", 0, "11:45", "Cafe"),
            Timed("Dentist", 0, "15:30", 0, "16:30", "Smile Dental"),
            Timed("Overnight deploy window", -1, "22:00", 0, "02:00"),
            Timed("Late movie night", 0, "22:30", 1, "01:00", "Cinema"),
            new("Sam's birthday", AllDay: true, StartDate: date, EndDate: date.AddDays(1)),
            new("Product conference", AllDay: true, StartDate: date.AddDays(-1), EndDate: date.AddDays(3), Location: "Convention centre"),
        ];

    TaskSeed[] tasks =
    [
        new("Reply to landlord", DueDate: date),
            new("Book flights", DueDate: date),
            new("Send invoice", DueAt: At(date, new TimeOnly(17, 0), zone)),
            new("Submit expense report (overdue, completed)", DueDate: date.AddDays(-2), CompleteAfterCreate: true),
            new("Renew passport (overdue)", DueDate: date.AddDays(-1)),
            new("Read the architecture notes (undated)"),
            new("Plan next sprint (due tomorrow)", DueDate: date.AddDays(1)),
        ];

    return new SeedPlan(events, tasks);
  }

  /// <summary>The instant of a local wall-clock time; a time skipped by a DST gap moves to the first valid time after it.</summary>
  public static DateTimeOffset At(DateOnly date, TimeOnly time, TimeZoneInfo zone)
  {
    var local = date.ToDateTime(time, DateTimeKind.Unspecified);
    while (zone.IsInvalidTime(local))
    {
      local = local.AddMinutes(1);
    }
    return new DateTimeOffset(local, zone.GetUtcOffset(local));
  }

  /// <summary>The machine's IANA zone id, converting a Windows id when needed.</summary>
  public static string LocalIanaId()
  {
    var id = TimeZoneInfo.Local.Id;
    return TimeZoneInfo.TryConvertWindowsIdToIanaId(id, out var iana) ? iana : id;
  }
}

/// <summary>The id of a created resource, as returned by the API.</summary>
public sealed record Created(Guid Id);

/// <summary>Source-generated JSON (file-based apps are AOT-analysed): camelCase like the API, absent optional members omitted.</summary>
[JsonSourceGenerationOptions(JsonSerializerDefaults.Web, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(EventSeed))]
[JsonSerializable(typeof(TaskSeed))]
[JsonSerializable(typeof(Created))]
public sealed partial class SeedJson : JsonSerializerContext;
