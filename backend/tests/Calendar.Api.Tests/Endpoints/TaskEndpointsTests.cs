using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Calendar.Api.Contracts;

namespace Calendar.Api.Tests.Endpoints;

public sealed class TaskEndpointsTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
  private static readonly Uri Tasks = new("/api/tasks", UriKind.Relative);

  private async Task<TaskResponse> CreateAsync(object payload)
  {
    using var response = await Client.PostAsJsonAsync(Tasks, payload, Ct);
    response.StatusCode.ShouldBe(HttpStatusCode.Created);
    return (await response.Content.ReadFromJsonAsync<TaskResponse>(Ct))!;
  }

  private async Task<TaskResponse> PostActionAsync(Guid id, string action)
  {
    using var response = await Client.PostAsync(new Uri($"/api/tasks/{id}/{action}", UriKind.Relative), content: null, Ct);
    response.StatusCode.ShouldBe(HttpStatusCode.OK);
    return (await response.Content.ReadFromJsonAsync<TaskResponse>(Ct))!;
  }

  [Fact]
  public async Task CreateTask_WithPriorityAndNotes_AppearsInListAndAgenda()
  {
    var created = await CreateAsync(new { title = "Plan trip", dueDate = "2026-10-26", priority = "high", notes = "  Book tickets  " });
    created.Priority.ShouldBe("high");
    created.Notes.ShouldBe("Book tickets");
    var listed = await Client.GetFromJsonAsync<List<TaskResponse>>(Tasks, Ct);
    listed.ShouldNotBeNull().ShouldContain(created);
    var agenda = await Client.GetFromJsonAsync<DayAgendaResponse>(new Uri("/api/agenda/day?date=2026-10-26&timeZone=Europe/London", UriKind.Relative), Ct);
    agenda.ShouldNotBeNull().Tasks.DueToday.ShouldContain(created);
  }

  [Fact]
  public async Task CreateTask_WithDueDate_RoundTrips()
  {
    var created = await CreateAsync(new { title = " Pay rent ", dueDate = "2026-10-26" });

    created.Title.ShouldBe("Pay rent");
    created.DueDate.ShouldBe(new DateOnly(2026, 10, 26));
    created.DueAt.ShouldBeNull();
    created.IsCompleted.ShouldBeFalse();
    created.CompletedAt.ShouldBeNull();

    var fetched = await Client.GetFromJsonAsync<TaskResponse>(new Uri($"/api/tasks/{created.Id}", UriKind.Relative), Ct);
    fetched.ShouldBe(created);
  }

  [Fact]
  public async Task CreateTask_WithDueAt_StoresUtc()
  {
    var created = await CreateAsync(new { title = "Call", dueAt = "2026-10-26T09:30:00-04:00" });

    created.DueAt.ShouldBe(Utc(2026, 10, 26, 13, 30));
    created.DueDate.ShouldBeNull();
  }

  [Fact]
  public async Task CreateTask_Undated_IsAllowed()
  {
    var created = await CreateAsync(new { title = "Someday" });

    created.DueDate.ShouldBeNull();
    created.DueAt.ShouldBeNull();
  }

  public static TheoryData<string, string, object> InvalidRequests => new()
    {
        { "invalid priority", "priority", new { title = "T", priority = "urgent" } },
        { "notes too long", "notes", new { title = "T", notes = new string('a', 4001) } },
        { "blank title", "title", new { title = " " } },
        { "title too long", "title", new { title = new string('a', 201) } },
        { "both due values", "dueAt", new { title = "T", dueDate = "2026-10-26", dueAt = "2026-10-26T10:00:00Z" } },
        { "dueAt without offset", "dueAt", new { title = "T", dueAt = "2026-10-26T10:00:00" } },
        { "due date out of range", "dueDate", new { title = "T", dueDate = "0001-01-01" } },
    };

  [Theory]
  [MemberData(nameof(InvalidRequests))]
  public async Task CreateTask_Invalid_Returns400ValidationProblem(string scenario, string field, object payload)
  {
    using var response = await Client.PostAsJsonAsync(Tasks, payload, Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, scenario);
    response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
    var errors = JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!["errors"]!.AsObject();
    errors.ContainsKey(field).ShouldBeTrue($"{scenario}: {errors.ToJsonString()}");
  }

  [Fact]
  public async Task Complete_SetsCompletedAtFromTheClock_AndIsIdempotent()
  {
    var created = await CreateAsync(new { title = "T", dueDate = "2026-10-26" });

    var first = await PostActionAsync(created.Id, "complete");
    first.IsCompleted.ShouldBeTrue();
    first.CompletedAt.ShouldBe(Clock.GetUtcNow());

    Clock.Advance(TimeSpan.FromHours(2));
    var second = await PostActionAsync(created.Id, "complete");

    second.ShouldBe(first); // keeps the first completion time
    var fetched = await Client.GetFromJsonAsync<TaskResponse>(new Uri($"/api/tasks/{created.Id}", UriKind.Relative), Ct);
    fetched.ShouldBe(first);
  }

  [Fact]
  public async Task Reopen_ClearsCompletion_AndIsIdempotent()
  {
    var created = await CreateAsync(new { title = "T" });
    await PostActionAsync(created.Id, "complete");

    var reopened = await PostActionAsync(created.Id, "reopen");
    var again = await PostActionAsync(created.Id, "reopen");

    reopened.IsCompleted.ShouldBeFalse();
    reopened.CompletedAt.ShouldBeNull();
    again.ShouldBe(reopened);
  }

  [Fact]
  public async Task Reopen_OfAnOpenTask_ReturnsItUnchanged()
  {
    var created = await CreateAsync(new { title = "T" });

    (await PostActionAsync(created.Id, "reopen")).ShouldBe(created);
  }

  [Theory]
  [InlineData("complete")]
  [InlineData("reopen")]
  public async Task Actions_OnUnknownTask_Return404Problem(string action)
  {
    using var response = await Client.PostAsync(new Uri($"/api/tasks/{Guid.NewGuid()}/{action}", UriKind.Relative), content: null, Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
  }

  [Fact]
  public async Task GetTask_Unknown_Returns404Problem()
  {
    using var response = await Client.GetAsync(new Uri($"/api/tasks/{Guid.NewGuid()}", UriKind.Relative), Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
  }
}
