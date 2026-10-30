using Calendar.Api.Contracts;
using Calendar.Domain.Tasks;
using Calendar.Domain.Time;
using Calendar.Infrastructure;
using Calendar.Infrastructure.Queries;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Calendar.Api.Endpoints;

internal static class TaskEndpoints
{
  private const string GetTaskName = "GetTask";

  private const int DefaultPageSize = 50;
  private const int MaxPageSize = 200;
  private const int MaxBulkIds = 500;

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
    group.MapDelete("/{id:guid}", DeleteAsync).WithName("DeleteTask")
      .Produces(StatusCodes.Status204NoContent).ProducesProblem(StatusCodes.Status404NotFound);
    group.MapPost("/bulk", BulkAsync).WithName("BulkTasks")
      .ProducesProblem(StatusCodes.Status400BadRequest).ProducesProblem(StatusCodes.Status409Conflict);
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

  private static async Task<Results<NoContent, ProblemHttpResult>> DeleteAsync(
      Guid id,
      CalendarDbContext db,
      CancellationToken cancellationToken)
  {
    TodoTask? task = await db.Tasks.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
    if (task is null)
    {
      return NotFound();
    }

    db.Tasks.Remove(task);
    await db.SaveChangesAsync(cancellationToken);
    return TypedResults.NoContent();
  }

  private static async Task<Results<Ok<BulkTaskResponse>, ValidationProblem, ProblemHttpResult>> BulkAsync(
      BulkTaskRequest request,
      CalendarDbContext db,
      TimeProvider time,
      CancellationToken cancellationToken)
  {
    var errors = new FieldErrors();
    errors.Require((request.Ids is null) != (request.Filter is null), "target", "Provide exactly one of ids or filter.");
    errors.Forbid(
      request.DueDate is not null && request.Action != BulkTaskAction.SetDueDate,
      "dueDate",
      "dueDate is only valid for setDueDate.");
    errors.Forbid(
      request.DueAt is not null && request.Action != BulkTaskAction.SetDueInstant,
      "dueAt",
      "dueAt is only valid for setDueInstant.");
    if (request.Action == BulkTaskAction.SetDueDate)
    {
      errors.Require(request.DueDate is not null, "dueDate", "dueDate is required for setDueDate.");
      errors.CheckDate(request.DueDate, "dueDate");
    }

    if (request.Action == BulkTaskAction.SetDueInstant)
    {
      errors.Require(request.DueAt is not null, "dueAt", "dueAt is required for setDueInstant.");
    }

    List<Guid> ids = [];
    if (request.Ids is { } requestedIds)
    {
      errors.Require(requestedIds.Count > 0, "ids", "At least one id is required.");
      errors.Require(requestedIds.Count <= MaxBulkIds, "ids", $"At most {MaxBulkIds} ids are allowed.");
      ids = [.. requestedIds.Distinct()];
    }

    if (request.Filter is { } filter)
    {
      errors.Require(filter.View == "overdue", "filter.view", "Only the overdue view is supported.");
      errors.CheckDate(filter.Today, "filter.today");
      TimeZoneInfo? zone = errors.RequireTimeZone(filter.TimeZone, "filter.timeZone");
      errors.Require(filter.ExpectedTotal >= 0, "filter.expectedTotal", "expectedTotal cannot be negative.");
      if (!errors.Any && zone is not null)
      {
        IDbContextTransaction transaction = await db.Database.BeginTransactionAsync(
          System.Data.IsolationLevel.Serializable,
          cancellationToken);
        var window = DayWindow.Create(filter.Today, zone);
        ids = await db.Tasks.AsNoTracking()
          .OpenOverdueFor(window)
          .Select(task => task.Id)
          .ToListAsync(cancellationToken);
        if (ids.Count != filter.ExpectedTotal)
        {
          await transaction.RollbackAsync(cancellationToken);
          return TypedResults.Problem(
              statusCode: StatusCodes.Status409Conflict,
              title: "The overdue task count changed. Review the updated count and try again.");
        }

        BulkTaskResponse result = await ApplyBulkAsync(ids, request, db, time, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return TypedResults.Ok(result);
      }
    }

    if (errors.Any)
    {
      return TypedResults.ValidationProblem(errors.ToDictionary());
    }

    return TypedResults.Ok(await ApplyBulkAsync(ids, request, db, time, cancellationToken));
  }

  private static async Task<BulkTaskResponse> ApplyBulkAsync(
      IReadOnlyList<Guid> ids,
      BulkTaskRequest request,
      CalendarDbContext db,
      TimeProvider time,
      CancellationToken cancellationToken)
  {
    var results = ids.ToDictionary(
      id => id,
      id => new BulkTaskItemResult { Id = id, Outcome = "notFound" });
    Dictionary<Guid, TodoTask> found = await db.Tasks
      .Where(task => ids.Contains(task.Id))
      .ToDictionaryAsync(task => task.Id, cancellationToken);
    List<Guid> pending = [];
    foreach ((Guid id, TodoTask task) in found)
    {
      try
      {
        switch (request.Action)
        {
          case BulkTaskAction.Complete:
            task.Complete(time.GetUtcNow());
            break;
          case BulkTaskAction.SetDueDate:
            task.SetDueDate(request.DueDate!.Value);
            break;
          case BulkTaskAction.SetDueInstant:
            task.SetDueAt(request.DueAt!.Value);
            break;
          case BulkTaskAction.ClearDeadline:
            task.ClearDeadline();
            break;
          case BulkTaskAction.Delete:
            db.Tasks.Remove(task);
            break;
        }

        pending.Add(id);
        results[id] = new BulkTaskItemResult { Id = id, Outcome = "applied" };
      }
      catch (InvalidOperationException)
      {
        db.Entry(task).State = EntityState.Detached;
        results[id] = new BulkTaskItemResult { Id = id, Outcome = "skipped" };
      }
    }

    while (pending.Count > 0)
    {
      try
      {
        await db.SaveChangesAsync(cancellationToken);
        break;
      }
      catch (DbUpdateConcurrencyException exception)
      {
        List<Guid> conflicted = [.. exception.Entries.Select(entry => ((TodoTask)entry.Entity).Id)];
        foreach (Guid conflictedId in conflicted)
        {
          pending.Remove(conflictedId);
          results[conflictedId] = new BulkTaskItemResult { Id = conflictedId, Outcome = "skipped" };
          db.Entry(found[conflictedId]).State = EntityState.Detached;
        }

        if (conflicted.Count == 0)
        {
          foreach (Guid pendingId in pending)
          {
            results[pendingId] = new BulkTaskItemResult { Id = pendingId, Outcome = "skipped" };
          }

          break;
        }
      }
    }

    IReadOnlyList<BulkTaskItemResult> orderedResults = [.. ids.Select(id => results[id])];
    return new BulkTaskResponse
    {
      Results = orderedResults,
      Applied = orderedResults.Count(result => result.Outcome == "applied"),
      Skipped = orderedResults.Count(result => result.Outcome == "skipped"),
      NotFound = orderedResults.Count(result => result.Outcome == "notFound"),
    };
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
