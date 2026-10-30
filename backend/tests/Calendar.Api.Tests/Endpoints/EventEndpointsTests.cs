using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Calendar.Api.Contracts;
using Calendar.Infrastructure;

namespace Calendar.Api.Tests.Endpoints;

public sealed class EventEndpointsTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
  private static readonly Uri Events = new("/api/events", UriKind.Relative);

  [Fact]
  public async Task CreateTimedEvent_RoundTripsAndNormalizesToUtc()
  {
    using HttpResponseMessage created = await Client.PostAsJsonAsync(
      Events,
      new
      {
        title = "  Standup  ",
        start = "2026-10-26T10:00:00-04:00",
        end = "2026-10-26T10:30:00-04:00",
        timeZone = "America/New_York",
        location = "Room 1",
        notes = "Bring notes",
      },
      Ct);

    created.StatusCode.ShouldBe(HttpStatusCode.Created);
    EventResponse body = (await created.Content.ReadFromJsonAsync<EventResponse>(Ct))!;
    created.Headers.Location.ShouldNotBeNull().ToString().ShouldEndWith($"/api/events/{body.Id}");
    body.Title.ShouldBe("Standup");
    body.AllDay.ShouldBeFalse();
    body.Start.ShouldBe(Utc(2026, 10, 26, 14));
    body.End.ShouldBe(Utc(2026, 10, 26, 14, 30));
    body.TimeZone.ShouldBe("America/New_York");
    body.Location.ShouldBe("Room 1");
    body.Notes.ShouldBe("Bring notes");
    body.StartDate.ShouldBeNull();
    body.EndDate.ShouldBeNull();

    EventResponse? fetched = await Client.GetFromJsonAsync<EventResponse>(new Uri($"/api/events/{body.Id}", UriKind.Relative), Ct);
    fetched.ShouldBe(body);
  }

  [Fact]
  public async Task CreateAllDayEvent_RoundTrips()
  {
    using HttpResponseMessage created = await Client.PostAsJsonAsync(
      Events,
      new
      {
        title = "Offsite",
        allDay = true,
        startDate = "2026-10-26",
        endDate = "2026-10-28",
      },
      Ct);

    created.StatusCode.ShouldBe(HttpStatusCode.Created);
    EventResponse body = (await created.Content.ReadFromJsonAsync<EventResponse>(Ct))!;
    body.AllDay.ShouldBeTrue();
    body.StartDate.ShouldBe(new DateOnly(2026, 10, 26));
    body.EndDate.ShouldBe(new DateOnly(2026, 10, 28));
    body.Start.ShouldBeNull();
    body.TimeZone.ShouldBeNull();

    EventResponse? fetched = await Client.GetFromJsonAsync<EventResponse>(new Uri($"/api/events/{body.Id}", UriKind.Relative), Ct);
    fetched.ShouldBe(body);
  }

  [Fact]
  public async Task CreateEvent_CanonicalizesTheZoneId()
  {
    using HttpResponseMessage created = await Client.PostAsJsonAsync(
      Events,
      new
      {
        title = "E",
        start = "2026-10-26T10:00:00Z",
        end = "2026-10-26T11:00:00Z",
        timeZone = "utc",
      },
      Ct);

    created.StatusCode.ShouldBe(HttpStatusCode.Created);
    (await created.Content.ReadFromJsonAsync<EventResponse>(Ct))!.TimeZone.ShouldBe("UTC");
  }

  [Fact]
  public async Task CreateEvent_WithALegacyZoneAlias_StoresTheCanonicalId()
  {
    using HttpResponseMessage created = await Client.PostAsJsonAsync(
      Events,
      new
      {
        title = "E",
        start = "2026-10-26T10:00:00Z",
        end = "2026-10-26T11:00:00Z",
        timeZone = "Asia/Calcutta",
      },
      Ct);

    created.StatusCode.ShouldBe(HttpStatusCode.Created);
    (await created.Content.ReadFromJsonAsync<EventResponse>(Ct))!.TimeZone.ShouldBe("Asia/Kolkata");
  }

  [Fact]
  public async Task GetEvent_Unknown_Returns404Problem()
  {
    using HttpResponseMessage response = await Client.GetAsync(new Uri($"/api/events/{Guid.NewGuid()}", UriKind.Relative), Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
  }

  [Fact]
  public async Task GetEvent_WithNonGuidId_Returns404()
  {
    using HttpResponseMessage response = await Client.GetAsync(new Uri("/api/events/not-a-guid", UriKind.Relative), Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
  }

  public static TheoryData<string, string, object> InvalidRequests => new()
    {
        { "blank title", "title", new { title = "   ", start = "2026-10-26T10:00:00Z", end = "2026-10-26T11:00:00Z", timeZone = "UTC" } },
        {
          "title too long",
          "title",
          new { title = new string('a', 201), start = "2026-10-26T10:00:00Z", end = "2026-10-26T11:00:00Z", timeZone = "UTC" }
        },
        { "end equals start", "end", new { title = "E", start = "2026-10-26T10:00:00Z", end = "2026-10-26T10:00:00Z", timeZone = "UTC" } },
        { "end before start", "end", new { title = "E", start = "2026-10-26T10:00:00Z", end = "2026-10-26T09:00:00Z", timeZone = "UTC" } },
        {
          "bad zone",
          "timeZone",
          new { title = "E", start = "2026-10-26T10:00:00Z", end = "2026-10-26T11:00:00Z", timeZone = "Nowhere/Land" }
        },
        {
          "directory-like zone",
          "timeZone",
          new { title = "E", start = "2026-10-26T10:00:00Z", end = "2026-10-26T11:00:00Z", timeZone = "America" }
        },
        {
          "windows zone",
          "timeZone",
          new { title = "E", start = "2026-10-26T10:00:00Z", end = "2026-10-26T11:00:00Z", timeZone = "Eastern Standard Time" }
        },
        { "timed without zone", "timeZone", new { title = "E", start = "2026-10-26T10:00:00Z", end = "2026-10-26T11:00:00Z" } },
        { "timed without start", "start", new { title = "E", end = "2026-10-26T11:00:00Z", timeZone = "UTC" } },
        {
          "timed with dates",
          "startDate",
          new { title = "E", start = "2026-10-26T10:00:00Z", end = "2026-10-26T11:00:00Z", timeZone = "UTC", startDate = "2026-10-26" }
        },
        {
          "location too long",
          "location",
          new
          {
            title = "E",
            start = "2026-10-26T10:00:00Z",
            end = "2026-10-26T11:00:00Z",
            timeZone = "UTC",
            location = new string('l', 201),
          }
        },
        {
          "notes too long",
          "notes",
          new { title = "E", start = "2026-10-26T10:00:00Z", end = "2026-10-26T11:00:00Z", timeZone = "UTC", notes = new string('n', 4001) }
        },
        { "all-day without dates", "startDate", new { title = "E", allDay = true } },
        { "all-day end equals start", "endDate", new { title = "E", allDay = true, startDate = "2026-10-26", endDate = "2026-10-26" } },
        { "all-day end before start", "endDate", new { title = "E", allDay = true, startDate = "2026-10-26", endDate = "2026-10-25" } },
        {
          "all-day with timed fields",
          "start",
          new { title = "E", allDay = true, startDate = "2026-10-26", endDate = "2026-10-27", start = "2026-10-26T10:00:00Z" }
        },
        { "all-day date out of range", "endDate", new { title = "E", allDay = true, startDate = "2026-10-26", endDate = "9999-12-31" } },
    };

  [Theory]
  [MemberData(nameof(InvalidRequests))]
  public async Task CreateEvent_Invalid_Returns400ValidationProblem(string scenario, string field, object payload)
  {
    using HttpResponseMessage response = await Client.PostAsJsonAsync(Events, payload, Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, scenario);
    response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
    JsonObject errors = JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!["errors"]!.AsObject();
    errors.ContainsKey(field).ShouldBeTrue($"{scenario}: expected an error for '{field}' but got {errors.ToJsonString()}");

    await using CalendarDbContext db = Postgres.Database.CreateMigratorContext();
    db.Events.Count().ShouldBe(0);
  }

  [Theory]
  [InlineData("2026-10-26T10:00:00", "start")] // no offset: would be read in the server's local offset
  [InlineData("2026-10-26", "start")]
  [InlineData("2026-10-26T10:00:00+0400", "start")]
  [InlineData("not a time", "start")]
  public async Task CreateEvent_InstantWithoutExplicitOffset_Returns400NamingTheField(string value, string field)
  {
    using HttpResponseMessage response = await Client.PostAsJsonAsync(
      Events,
      new { title = "E", start = value, end = "2026-10-26T12:00:00Z", timeZone = "UTC" },
      Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
    JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!["errors"]!.AsObject().ContainsKey(field).ShouldBeTrue();
    await using CalendarDbContext db = Postgres.Database.CreateMigratorContext();
    db.Events.Count().ShouldBe(0);
  }

  [Fact]
  public async Task CreateEvent_EndWithoutOffset_NamesTheEndField()
  {
    using HttpResponseMessage response = await Client.PostAsJsonAsync(
      Events,
      new { title = "E", start = "2026-10-26T10:00:00Z", end = "2026-10-26T12:00:00", timeZone = "UTC" },
      Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!["errors"]!.AsObject().ContainsKey("end").ShouldBeTrue();
  }

  [Theory]
  [InlineData("2026-10-26T10:00:00Z")]
  [InlineData("2026-10-26T10:00:00.5+05:30")]
  [InlineData("2026-10-26T10:00-04:00")]
  [InlineData("2026-10-26T10:00:00z")]
  public async Task CreateEvent_InstantWithExplicitOffset_IsAccepted(string value)
  {
    using HttpResponseMessage response = await Client.PostAsJsonAsync(
      Events,
      new { title = "E", start = value, end = "2026-10-27T10:00:00Z", timeZone = "UTC" },
      Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.Created);
  }

  [Fact]
  public async Task CreateEvent_WithMalformedBody_Returns400()
  {
    using var content = new StringContent(
      """{"title":"E","allDay":true,"startDate":"nope"}""",
      System.Text.Encoding.UTF8,
      "application/json");

    using HttpResponseMessage response = await Client.PostAsync(Events, content, Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
  }
}
