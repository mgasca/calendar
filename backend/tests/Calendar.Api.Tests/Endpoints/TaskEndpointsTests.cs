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

  private async Task<TaskPage> ListAsync(string query)
  {
    var page = await Client.GetFromJsonAsync<TaskPage>(new Uri($"/api/tasks?view={query}", UriKind.Relative), Ct);
    return page.ShouldNotBeNull();
  }

  /// <summary>Reads a whole view page by page, following each cursor.</summary>
  private async Task<List<TaskResponse>> ListAllAsync(string query, int limit)
  {
    var all = new List<TaskResponse>();
    string? cursor = null;
    do
    {
      var page = await ListAsync($"{query}&limit={limit}" + (cursor is null ? "" : $"&cursor={cursor}"));
      page.Items.Count.ShouldBeLessThanOrEqualTo(limit);
      all.AddRange(page.Items);
      cursor = page.NextCursor;
    }
    while (cursor is not null);

    return all;
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
    var listed = await ListAsync("upcoming&today=2026-10-26&timeZone=Europe/London");
    listed.Items.ShouldContain(created);
    var agenda = await Client.GetFromJsonAsync<DayAgendaResponse>(new Uri("/api/agenda/day?date=2026-10-26&timeZone=Europe/London", UriKind.Relative), Ct);
    agenda.ShouldNotBeNull().Tasks.DueToday.ShouldContain(t => t.Id == created.Id && t.HasNotes);
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

  private const string NewYorkToday = "today=2026-10-26&timeZone=America/New_York";

  [Fact]
  public async Task ListTasks_DatedViews_SplitOnTheClientsDay_AndOrderByLocalDueDate()
  {
    // In New York on 2026-10-26 (UTC-4). Instants whose UTC date differs from their local date land on the local one.
    var dateOnlyYesterday = await CreateAsync(new { title = "A", dueDate = "2026-10-25" });
    var lateYesterdayLocal = await CreateAsync(new { title = "B", dueAt = "2026-10-26T03:00:00Z" });
    var lateTodayLocal = await CreateAsync(new { title = "C", dueAt = "2026-10-27T02:00:00Z" });
    var dateOnlyToday = await CreateAsync(new { title = "D", dueDate = "2026-10-26" });
    var morningToday = await CreateAsync(new { title = "E", dueAt = "2026-10-26T14:00:00Z" });
    var tomorrow = await CreateAsync(new { title = "F", dueDate = "2026-10-27" });
    var done = await CreateAsync(new { title = "G", dueDate = "2026-10-20" });
    await PostActionAsync(done.Id, "complete");
    var undated = await CreateAsync(new { title = "H" });

    (await ListAsync($"overdue&{NewYorkToday}")).Items.ShouldBe([lateYesterdayLocal, dateOnlyYesterday]);
    (await ListAsync($"upcoming&{NewYorkToday}")).Items.ShouldBe([morningToday, lateTodayLocal, dateOnlyToday, tomorrow]);
    (await ListAsync("no-deadline")).Items.ShouldBe([undated]);
    (await ListAsync("completed")).Items.Select(t => t.Id).ShouldBe([done.Id]);
  }

  [Fact]
  public async Task ListTasks_Completed_MostRecentFirst()
  {
    var first = await CreateAsync(new { title = "First" });
    var second = await CreateAsync(new { title = "Second" });
    await PostActionAsync(first.Id, "complete");
    Clock.Advance(TimeSpan.FromMinutes(5));
    await PostActionAsync(second.Id, "complete");

    (await ListAsync("completed")).Items.Select(t => t.Id).ShouldBe([second.Id, first.Id]);
  }

  [Theory]
  [InlineData("upcoming&" + NewYorkToday)]
  [InlineData("overdue&" + NewYorkToday)]
  [InlineData("completed")]
  [InlineData("no-deadline")]
  public async Task ListTasks_PagedWithCursors_ReturnsEveryTaskOnceInOrder(string query)
  {
    // Ties at every level: several tasks per local date, shared due instants, shared completion times.
    string[] dueDates = ["2026-10-20", "2026-10-20", "2026-10-26", "2026-10-26", "2026-10-30"];
    string[] dueAts = ["2026-10-20T15:00:00Z", "2026-10-20T15:00:00Z", "2026-10-26T15:00:00Z", "2026-10-30T15:00:00Z"];
    foreach (var dueDate in dueDates)
    {
      await CreateAsync(new { title = "date", dueDate });
      await PostActionAsync((await CreateAsync(new { title = "done", dueDate })).Id, "complete");
    }

    foreach (var dueAt in dueAts)
    {
      await CreateAsync(new { title = "timed", dueAt });
      Clock.Advance(TimeSpan.FromMinutes(1));
      await PostActionAsync((await CreateAsync(new { title = "done", dueAt })).Id, "complete");
    }

    for (var i = 0; i < 5; i++)
    {
      await CreateAsync(new { title = "undated" });
    }

    var whole = (await ListAsync($"{query}&limit=200")).Items;
    whole.ShouldNotBeEmpty();

    foreach (var limit in new[] { 1, 2, 3 })
    {
      (await ListAllAsync(query, limit)).ShouldBe(whole, $"limit {limit}");
    }
  }

  [Fact]
  public async Task ListTasks_LastPage_HasNoCursor()
  {
    await CreateAsync(new { title = "Only" });

    var page = await ListAsync("no-deadline&limit=1");

    page.Items.Count.ShouldBe(1);
    page.NextCursor.ShouldBeNull();
  }

  public static TheoryData<string, string, string> InvalidListQueries => new()
    {
        { "missing view", "", "view" },
        { "unknown view", "?view=soon", "view" },
        { "upcoming without today", "?view=upcoming&timeZone=America/New_York", "today" },
        { "overdue without time zone", "?view=overdue&today=2026-10-26", "timeZone" },
        { "unknown time zone", "?view=overdue&today=2026-10-26&timeZone=Mars/Base", "timeZone" },
        { "limit zero", "?view=completed&limit=0", "limit" },
        { "limit too large", "?view=completed&limit=201", "limit" },
        { "malformed cursor", "?view=completed&cursor=not-a-cursor", "cursor" },
    };

  [Theory]
  [MemberData(nameof(InvalidListQueries))]
  public async Task ListTasks_Invalid_Returns400ValidationProblem(string scenario, string query, string field)
  {
    using var response = await Client.GetAsync(new Uri($"/api/tasks{query}", UriKind.Relative), Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, scenario);
    var errors = JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!["errors"]!.AsObject();
    errors.ContainsKey(field).ShouldBeTrue($"{scenario}: {errors.ToJsonString()}");
  }

  [Fact]
  public async Task ListTasks_CursorFromAnotherView_Returns400()
  {
    await CreateAsync(new { title = "One" });
    await CreateAsync(new { title = "Two" });
    var cursor = (await ListAsync("no-deadline&limit=1")).NextCursor.ShouldNotBeNull();

    using var response = await Client.GetAsync(new Uri($"/api/tasks?view=completed&cursor={cursor}", UriKind.Relative), Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
  }
}
