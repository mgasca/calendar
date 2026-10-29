using Calendar.Api.Contracts;
using Calendar.Domain.Tasks;
using Calendar.Domain.Time;
using Calendar.Infrastructure;
using Calendar.Infrastructure.Queries;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Calendar.Api.Endpoints;

internal static class TaskEndpoints
{
  private const string GetTaskName = "GetTask";

  private const int DefaultPageSize = 50;
  private const int MaxPageSize = 200;

  private static readonly Dictionary<string, TaskListView> Views = new(StringComparer.Ordinal)
  {
    ["upcoming"] = TaskListView.Upcoming,
    ["overdue"] = TaskListView.Overdue,
    ["completed"] = TaskListView.Completed,
    ["no-deadline"] = TaskListView.NoDeadline,
  };

  public static IEndpointRouteBuilder MapTaskEndpoints(this IEndpointRouteBuilder app)
  {
    RouteGroupBuilder group = app.MapGroup("/api/tasks").WithTags("Tasks");

    group.MapGet("/", ListAsync).WithName("ListTasks").RequireQueryParameters("view");
    group.MapPost("/", CreateAsync).WithName("CreateTask");
    group.MapGet("/{id:guid}", GetAsync).WithName(GetTaskName).ProducesProblem(StatusCodes.Status404NotFound);
    group.MapPost("/{id:guid}/complete", CompleteAsync)
      .WithName("CompleteTask")
      .ProducesProblem(StatusCodes.Status404NotFound)
      .ProducesProblem(StatusCodes.Status409Conflict);
    group.MapPost("/{id:guid}/reopen", ReopenAsync)
      .WithName("ReopenTask")
      .ProducesProblem(StatusCodes.Status404NotFound)
      .ProducesProblem(StatusCodes.Status409Conflict);

    return app;
  }

  private static async Task<Results<CreatedAtRoute<TaskResponse>, ValidationProblem>> CreateAsync(
      CreateTaskRequest request,
      CalendarDbContext db,
      CancellationToken cancellationToken)
  {
    var errors = new FieldErrors();
    errors.CheckDate(request.DueDate, "dueDate");

    TodoTask? created = null;
    if (!errors.Any)
    {
      try
      {
        created = TodoTask.Create(request.Title, request.DueDate, request.DueAt, request.Priority, request.Notes);
      }
      catch (ArgumentException ex)
      {
        errors.AddDomainError(ex);
      }
    }

    if (created is null)
    {
      return TypedResults.ValidationProblem(errors.ToDictionary());
    }

    db.Tasks.Add(created);
    await db.SaveChangesAsync(cancellationToken);
    return TypedResults.CreatedAtRoute(TaskResponse.From(created), GetTaskName, new { id = created.Id });
  }

  /// <summary>
  /// One page of a task list view. The dated views take the client's <paramref name="today"/> and
  /// <paramref name="timeZone"/>, since the server never decides what day it is (ADR-0021).
  /// </summary>
  private static async Task<Results<Ok<TaskPage>, ValidationProblem>> ListAsync(
      string? view,
      DateOnly? today,
      string? timeZone,
      int? limit,
      string? cursor,
      CalendarDbContext db,
      CancellationToken cancellationToken)
  {
    var errors = new FieldErrors();
    TaskListView? listView = view is not null && Views.TryGetValue(view, out TaskListView known) ? known : null;
    errors.Require(listView is not null, "view", "view is required: upcoming, overdue, completed or no-deadline.");

    DateOnly? todayDate = null;
    TimeZoneInfo? zone = null;
    if (listView is TaskListView.Upcoming or TaskListView.Overdue)
    {
      todayDate = errors.RequireDate(today, "today");
      zone = errors.RequireTimeZone(timeZone, "timeZone");
    }

    var pageSize = limit ?? DefaultPageSize;
    errors.Require(pageSize is >= 1 and <= MaxPageSize, "limit", $"limit must be between 1 and {MaxPageSize}.");

    TaskListKey? after = null;
    if (cursor is not null && listView is { } cursorView)
    {
      errors.Require(TaskListCursor.TryDecode(cursor, cursorView, out TaskListKey? key), "cursor", "cursor is not valid for this view.");
      after = key;
    }

    if (errors.Any || listView is not { } selected)
    {
      return TypedResults.ValidationProblem(errors.ToDictionary());
    }

    DayWindow? window = todayDate is { } date && zone is not null ? DayWindow.Create(date, zone) : null;
    List<TaskResponse> items = await db.Tasks.AsNoTracking()
        .ForView(selected, window, zone, after)
        .Take(pageSize + 1)
        .Select(TaskResponse.Projection)
        .ToListAsync(cancellationToken);

    // One extra row tells whether another page follows; the cursor is the key of the last row returned.
    string? next = null;
    if (items.Count > pageSize)
    {
      items.RemoveAt(pageSize);
      TaskResponse last = items[^1];
      next = TaskListCursor.Encode(selected, TaskListQueries.KeyOf(selected, last.Id, last.DueDate, last.DueAt, last.CompletedAt, zone));
    }

    return TypedResults.Ok(new TaskPage { Items = items, NextCursor = next });
  }

  private static async Task<Results<Ok<TaskResponse>, ProblemHttpResult>> GetAsync(
      Guid id,
      CalendarDbContext db,
      CancellationToken cancellationToken)
  {
    TaskResponse? found = await db.Tasks.AsNoTracking()
      .Where(t => t.Id == id)
      .Select(TaskResponse.Projection)
      .FirstOrDefaultAsync(cancellationToken);
    return found is null ? NotFound() : TypedResults.Ok(found);
  }

  private static Task<Results<Ok<TaskResponse>, ProblemHttpResult>> CompleteAsync(
      Guid id,
      CalendarDbContext db,
      TimeProvider time,
      CancellationToken cancellationToken) =>
      ChangeAsync(id, db, task => task.Complete(time.GetUtcNow()), cancellationToken);

  private static Task<Results<Ok<TaskResponse>, ProblemHttpResult>> ReopenAsync(
      Guid id,
      CalendarDbContext db,
      CancellationToken cancellationToken) =>
      ChangeAsync(id, db, task => task.Reopen(), cancellationToken);

  /// <summary>Loads, applies an idempotent change and saves only when something changed.</summary>
  private static async Task<Results<Ok<TaskResponse>, ProblemHttpResult>> ChangeAsync(
      Guid id,
      CalendarDbContext db,
      Action<TodoTask> change,
      CancellationToken cancellationToken)
  {
    TodoTask? task = await db.Tasks.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
    if (task is null)
    {
      return NotFound();
    }

    change(task);
    try
    {
      await db.SaveChangesAsync(cancellationToken);
    }
    catch (DbUpdateConcurrencyException)
    {
      return TypedResults.Problem(
          statusCode: StatusCodes.Status409Conflict,
          title: "The task was changed by another request. Try again.");
    }

    return TypedResults.Ok(TaskResponse.From(task));
  }

  private static ProblemHttpResult NotFound() =>
      TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Task not found.");
}
