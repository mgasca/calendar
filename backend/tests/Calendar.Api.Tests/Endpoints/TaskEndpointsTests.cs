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
    using HttpResponseMessage response = await Client.PostAsJsonAsync(Tasks, payload, Ct);
    response.StatusCode.ShouldBe(HttpStatusCode.Created);
    return (await response.Content.ReadFromJsonAsync<TaskResponse>(Ct))!;
  }

  private async Task<TaskPage> ListAsync(string query)
  {
    TaskPage? page = await Client.GetFromJsonAsync<TaskPage>(new Uri($"/api/tasks?view={query}", UriKind.Relative), Ct);
    return page.ShouldNotBeNull();
  }

  /// <summary>Reads a whole view page by page, following each cursor.</summary>
  private async Task<List<TaskResponse>> ListAllAsync(string query, int limit)
  {
    var all = new List<TaskResponse>();
    string? cursor = null;
    do
    {
      TaskPage page = await ListAsync($"{query}&limit={limit}" + (cursor is null ? "" : $"&cursor={cursor}"));
      page.Items.Count.ShouldBeLessThanOrEqualTo(limit);
      all.AddRange(page.Items);
      cursor = page.NextCursor;
    }
    while (cursor is not null);

    return all;
  }

  private async Task<TaskResponse> PostActionAsync(Guid id, string action)
  {
    using HttpResponseMessage response = await Client.PostAsync(new Uri($"/api/tasks/{id}/{action}", UriKind.Relative), content: null, Ct);
    response.StatusCode.ShouldBe(HttpStatusCode.OK);
    return (await response.Content.ReadFromJsonAsync<TaskResponse>(Ct))!;
  }

  [Fact]
  public async Task CreateTask_WithPriorityAndNotes_AppearsInListAndAgenda()
  {
    TaskResponse created = await CreateAsync(
      new { title = "Plan trip", dueDate = "2026-10-26", priority = "high", notes = "  Book tickets  " });
    created.Priority.ShouldBe("high");
    created.Notes.ShouldBe("Book tickets");
    TaskPage listed = await ListAsync("upcoming&today=2026-10-26&timeZone=Europe/London");
    listed.Items.ShouldContain(created);
    DayAgendaResponse? agenda = await Client.GetFromJsonAsync<DayAgendaResponse>(
      new Uri("/api/agenda/day?date=2026-10-26&timeZone=Europe/London", UriKind.Relative),
      Ct);
    agenda.ShouldNotBeNull().Tasks.DueToday.ShouldContain(t => t.Id == created.Id && t.HasNotes);
  }

  [Fact]
  public async Task CreateTask_WithDueDate_RoundTrips()
  {
    TaskResponse created = await CreateAsync(new { title = " Pay rent ", dueDate = "2026-10-26" });

    created.Title.ShouldBe("Pay rent");
    created.DueDate.ShouldBe(new DateOnly(2026, 10, 26));
    created.DueAt.ShouldBeNull();
    created.IsCompleted.ShouldBeFalse();
    created.CompletedAt.ShouldBeNull();

    TaskResponse? fetched = await Client.GetFromJsonAsync<TaskResponse>(new Uri($"/api/tasks/{created.Id}", UriKind.Relative), Ct);
    fetched.ShouldBe(created);
  }

  [Fact]
  public async Task CreateTask_WithDueAt_StoresUtc()
  {
    TaskResponse created = await CreateAsync(new { title = "Call", dueAt = "2026-10-26T09:30:00-04:00" });

    created.DueAt.ShouldBe(Utc(2026, 10, 26, 13, 30));
    created.DueDate.ShouldBeNull();
  }

  [Fact]
  public async Task CreateTask_Undated_IsAllowed()
  {
    TaskResponse created = await CreateAsync(new { title = "Someday" });

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
    using HttpResponseMessage response = await Client.PostAsJsonAsync(Tasks, payload, Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, scenario);
    response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
    JsonObject errors = JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!["errors"]!.AsObject();
    errors.ContainsKey(field).ShouldBeTrue($"{scenario}: {errors.ToJsonString()}");
  }

  [Fact]
  public async Task Complete_SetsCompletedAtFromTheClock_AndIsIdempotent()
  {
    TaskResponse created = await CreateAsync(new { title = "T", dueDate = "2026-10-26" });

    TaskResponse first = await PostActionAsync(created.Id, "complete");
    first.IsCompleted.ShouldBeTrue();
    first.CompletedAt.ShouldBe(Clock.GetUtcNow());

    Clock.Advance(TimeSpan.FromHours(2));
    TaskResponse second = await PostActionAsync(created.Id, "complete");

    second.ShouldBe(first); // keeps the first completion time
    TaskResponse? fetched = await Client.GetFromJsonAsync<TaskResponse>(new Uri($"/api/tasks/{created.Id}", UriKind.Relative), Ct);
    fetched.ShouldBe(first);
  }

  [Fact]
  public async Task Reopen_ClearsCompletion_AndIsIdempotent()
  {
    TaskResponse created = await CreateAsync(new { title = "T" });
    await PostActionAsync(created.Id, "complete");

    TaskResponse reopened = await PostActionAsync(created.Id, "reopen");
    TaskResponse again = await PostActionAsync(created.Id, "reopen");

    reopened.IsCompleted.ShouldBeFalse();
    reopened.CompletedAt.ShouldBeNull();
    again.ShouldBe(reopened);
  }

  [Fact]
  public async Task Reopen_OfAnOpenTask_ReturnsItUnchanged()
  {
    TaskResponse created = await CreateAsync(new { title = "T" });

    (await PostActionAsync(created.Id, "reopen")).ShouldBe(created);
  }

  [Theory]
  [InlineData("complete")]
  [InlineData("reopen")]
  public async Task Actions_OnUnknownTask_Return404Problem(string action)
  {
    using HttpResponseMessage response = await Client.PostAsync(
      new Uri($"/api/tasks/{Guid.NewGuid()}/{action}", UriKind.Relative),
      content: null,
      Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
  }

  [Fact]
  public async Task GetTask_Unknown_Returns404Problem()
  {
    using HttpResponseMessage response = await Client.GetAsync(new Uri($"/api/tasks/{Guid.NewGuid()}", UriKind.Relative), Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
  }

  private const string NewYorkToday = "today=2026-10-26&timeZone=America/New_York";

  [Fact]
  public async Task ListTasks_DatedViews_SplitOnTheClientsDay_AndOrderByLocalDueDate()
  {
    // In New York on 2026-10-26 (UTC-4). Instants whose UTC date differs from their local date land on the local one.
    TaskResponse dateOnlyYesterday = await CreateAsync(new { title = "A", dueDate = "2026-10-25" });
    TaskResponse lateYesterdayLocal = await CreateAsync(new { title = "B", dueAt = "2026-10-26T03:00:00Z" });
    TaskResponse lateTodayLocal = await CreateAsync(new { title = "C", dueAt = "2026-10-27T02:00:00Z" });
    TaskResponse dateOnlyToday = await CreateAsync(new { title = "D", dueDate = "2026-10-26" });
    TaskResponse morningToday = await CreateAsync(new { title = "E", dueAt = "2026-10-26T14:00:00Z" });
    TaskResponse tomorrow = await CreateAsync(new { title = "F", dueDate = "2026-10-27" });
    TaskResponse done = await CreateAsync(new { title = "G", dueDate = "2026-10-20" });
    await PostActionAsync(done.Id, "complete");
    TaskResponse undated = await CreateAsync(new { title = "H" });

    (await ListAsync($"overdue&{NewYorkToday}")).Items.ShouldBe([lateYesterdayLocal, dateOnlyYesterday]);
    (await ListAsync($"upcoming&{NewYorkToday}")).Items.ShouldBe([morningToday, lateTodayLocal, dateOnlyToday, tomorrow]);
    (await ListAsync("no-deadline")).Items.ShouldBe([undated]);
    (await ListAsync("completed")).Items.Select(t => t.Id).ShouldBe([done.Id]);
  }

  [Fact]
  public async Task ListTasks_Completed_MostRecentFirst()
  {
    TaskResponse first = await CreateAsync(new { title = "First" });
    TaskResponse second = await CreateAsync(new { title = "Second" });
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

    IReadOnlyList<TaskResponse> whole = (await ListAsync($"{query}&limit=200")).Items;
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

    TaskPage page = await ListAsync("no-deadline&limit=1");

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
    using HttpResponseMessage response = await Client.GetAsync(new Uri($"/api/tasks{query}", UriKind.Relative), Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, scenario);
    JsonObject errors = JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!["errors"]!.AsObject();
    errors.ContainsKey(field).ShouldBeTrue($"{scenario}: {errors.ToJsonString()}");
  }

  [Fact]
  public async Task ListTasks_CursorFromAnotherView_Returns400()
  {
    await CreateAsync(new { title = "One" });
    await CreateAsync(new { title = "Two" });
    var cursor = (await ListAsync("no-deadline&limit=1")).NextCursor.ShouldNotBeNull();

    using HttpResponseMessage response = await Client.GetAsync(new Uri($"/api/tasks?view=completed&cursor={cursor}", UriKind.Relative), Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
  }

  [Fact]
  public async Task BulkTasks_AppliesActionsAndReportsSkippedAndMissingIds()
  {
    TaskResponse open = await CreateAsync(new { title = "Open", dueDate = "2026-10-20" });
    TaskResponse completed = await CreateAsync(new { title = "Done" });
    await PostActionAsync(completed.Id, "complete");
    var missing = Guid.NewGuid();

    using HttpResponseMessage response = await Client.PostAsJsonAsync(
      new Uri("/api/tasks/bulk", UriKind.Relative),
      new { action = "setDueDate", ids = new[] { open.Id, completed.Id, missing }, dueDate = "2026-10-27" },
      Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.OK);
    BulkTaskResponse result = (await response.Content.ReadFromJsonAsync<BulkTaskResponse>(Ct))!;
    result.Applied.ShouldBe(1);
    result.Skipped.ShouldBe(1);
    result.NotFound.ShouldBe(1);
    result.Results.Select(item => item.Outcome).ShouldBe(["applied", "skipped", "notFound"]);
    (await Client.GetFromJsonAsync<TaskResponse>(new Uri($"/api/tasks/{open.Id}", UriKind.Relative), Ct))!
      .DueDate.ShouldBe(new DateOnly(2026, 10, 27));
  }

  [Fact]
  public async Task BulkTasks_CompleteIsIdempotentAndFilterCountGuardsChanges()
  {
    TaskResponse overdue = await CreateAsync(new { title = "Overdue", dueDate = "2026-10-20" });
    await PostActionAsync(overdue.Id, "complete");
    using HttpResponseMessage completeResponse = await Client.PostAsJsonAsync(
      new Uri("/api/tasks/bulk", UriKind.Relative),
      new { action = "complete", ids = new[] { overdue.Id } },
      Ct);
    completeResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
    (await completeResponse.Content.ReadFromJsonAsync<BulkTaskResponse>(Ct))!.Applied.ShouldBe(1);

    using HttpResponseMessage conflict = await Client.PostAsJsonAsync(
      new Uri("/api/tasks/bulk", UriKind.Relative),
      new
      {
        action = "delete",
        filter = new { view = "overdue", today = "2026-10-26", timeZone = "Europe/London", expectedTotal = 1 },
      },
      Ct);
    conflict.StatusCode.ShouldBe(HttpStatusCode.Conflict);
    (await Client.GetAsync(new Uri($"/api/tasks/{overdue.Id}", UriKind.Relative), Ct)).StatusCode.ShouldBe(HttpStatusCode.OK);
  }

  [Fact]
  public async Task BulkTasks_IdTarget_CanSetInstantClearDeadlineAndDelete()
  {
    TaskResponse task = await CreateAsync(new { title = "Edit", dueDate = "2026-10-20" });
    using HttpResponseMessage setInstant = await Client.PostAsJsonAsync(
      new Uri("/api/tasks/bulk", UriKind.Relative),
      new { action = "setDueInstant", ids = new[] { task.Id }, dueAt = "2026-10-27T09:30:00-04:00" },
      Ct);
    setInstant.StatusCode.ShouldBe(HttpStatusCode.OK);
    (await Client.GetFromJsonAsync<TaskResponse>(new Uri($"/api/tasks/{task.Id}", UriKind.Relative), Ct))!
      .DueAt.ShouldBe(Utc(2026, 10, 27, 13, 30));

    using HttpResponseMessage clear = await Client.PostAsJsonAsync(
      new Uri("/api/tasks/bulk", UriKind.Relative),
      new { action = "clearDeadline", ids = new[] { task.Id } },
      Ct);
    clear.StatusCode.ShouldBe(HttpStatusCode.OK);
    (await Client.GetFromJsonAsync<TaskResponse>(new Uri($"/api/tasks/{task.Id}", UriKind.Relative), Ct))!
      .DueDate.ShouldBeNull();
    (await Client.GetFromJsonAsync<TaskResponse>(new Uri($"/api/tasks/{task.Id}", UriKind.Relative), Ct))!
      .DueAt.ShouldBeNull();

    using HttpResponseMessage delete = await Client.PostAsJsonAsync(
      new Uri("/api/tasks/bulk", UriKind.Relative),
      new { action = "delete", ids = new[] { task.Id } },
      Ct);
    delete.StatusCode.ShouldBe(HttpStatusCode.OK);
    (await Client.GetAsync(new Uri($"/api/tasks/{task.Id}", UriKind.Relative), Ct)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
  }

  [Fact]
  public async Task BulkTasks_FilterTarget_AppliesActionsAndUpdatesAgendaOverdueCounts()
  {
    TaskResponse completed = await CreateAsync(new { title = "Complete", dueDate = "2026-10-20" });
    await ApplyToOverdueAsync("complete", completed.Id);
    TaskResponse dateTask = await CreateAsync(new { title = "Date", dueDate = "2026-10-20" });
    await ApplyToOverdueAsync("setDueDate", dateTask.Id, dueDate: "2026-10-27");
    TaskResponse instantTask = await CreateAsync(new { title = "Instant", dueDate = "2026-10-20" });
    await ApplyToOverdueAsync("setDueInstant", instantTask.Id, dueAt: "2026-10-27T12:00:00Z");
    TaskResponse cleared = await CreateAsync(new { title = "Clear", dueDate = "2026-10-20" });
    await ApplyToOverdueAsync("clearDeadline", cleared.Id);
    TaskResponse deleted = await CreateAsync(new { title = "Delete", dueDate = "2026-10-20" });
    await ApplyToOverdueAsync("delete", deleted.Id);

    (await ListAsync("overdue&today=2026-10-26&timeZone=Europe/London")).Items.ShouldBeEmpty();
    DayAgendaResponse? agenda = await Client.GetFromJsonAsync<DayAgendaResponse>(
      new Uri("/api/agenda/day?date=2026-10-26&timeZone=Europe/London", UriKind.Relative),
      Ct);
    agenda.ShouldNotBeNull().Tasks.OverdueOpenTotal.ShouldBe(0);
    agenda.Tasks.OverdueTotal.ShouldBe(1);
    agenda.Tasks.Overdue.Select(item => item.Id).ShouldBe([completed.Id]);

    async Task ApplyToOverdueAsync(string action, Guid id, string? dueDate = null, string? dueAt = null)
    {
      var payload = new Dictionary<string, object?>
      {
        ["action"] = action,
        ["filter"] = new { view = "overdue", today = "2026-10-26", timeZone = "Europe/London", expectedTotal = 1 },
      };
      if (dueDate is not null)
      {
        payload["dueDate"] = dueDate;
      }

      if (dueAt is not null)
      {
        payload["dueAt"] = dueAt;
      }

      using HttpResponseMessage response = await Client.PostAsJsonAsync(new Uri("/api/tasks/bulk", UriKind.Relative), payload, Ct);
      response.StatusCode.ShouldBe(HttpStatusCode.OK);
      BulkTaskResponse result = (await response.Content.ReadFromJsonAsync<BulkTaskResponse>(Ct))!;
      result.Applied.ShouldBe(1);
      result.Results.Single().Id.ShouldBe(id);
      result.Results.Single().Outcome.ShouldBe("applied");
    }
  }

  public static TheoryData<object, string> InvalidBulkRequests => new()
  {
    { new { action = "delete" }, "target" },
    {
      new
      {
        action = "delete",
        ids = Array.Empty<Guid>(),
        filter = new
        {
          view = "overdue",
          today = "2026-10-26",
          timeZone = "Europe/London",
          expectedTotal = 0,
        },
      },
      "target"
    },
    { new { action = "delete", ids = Array.Empty<Guid>() }, "ids" },
    { new { action = "setDueDate", ids = new[] { Guid.NewGuid() } }, "dueDate" },
    { new { action = "complete", ids = new[] { Guid.NewGuid() }, dueDate = "2026-10-27" }, "dueDate" },
    {
      new
      {
        action = "delete",
        filter = new
        {
          view = "overdue",
          today = "2026-10-26",
          timeZone = "Mars/Base",
          expectedTotal = -1,
        },
      },
      "filter.timeZone"
    },
  };

  [Theory]
  [MemberData(nameof(InvalidBulkRequests))]
  public async Task BulkTasks_InvalidRequest_ReturnsValidationProblem(object payload, string field)
  {
    using HttpResponseMessage response = await Client.PostAsJsonAsync(new Uri("/api/tasks/bulk", UriKind.Relative), payload, Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
    JsonObject errors = JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!["errors"]!.AsObject();
    errors.ContainsKey(field).ShouldBeTrue(errors.ToJsonString());
  }

  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public async Task Delete_RemovesOpenAndCompletedTasks(bool completed)
  {
    TaskResponse task = await CreateAsync(new { title = "Remove" });
    if (completed)
    {
      await PostActionAsync(task.Id, "complete");
    }

    using HttpResponseMessage response = await Client.DeleteAsync(new Uri($"/api/tasks/{task.Id}", UriKind.Relative), Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.NoContent);
    (await Client.GetAsync(new Uri($"/api/tasks/{task.Id}", UriKind.Relative), Ct)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
  }
}
