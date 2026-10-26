using Calendar.Api.Contracts;
using Calendar.Domain.Tasks;
using Calendar.Infrastructure;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Calendar.Api.Endpoints;

internal static class TaskEndpoints
{
    private const string GetTaskName = "GetTask";

    public static IEndpointRouteBuilder MapTaskEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/tasks").WithTags("Tasks");

        group.MapPost("/", CreateAsync).WithName("CreateTask");
        group.MapGet("/{id:guid}", GetAsync).WithName(GetTaskName).ProducesProblem(StatusCodes.Status404NotFound);
        group.MapPost("/{id:guid}/complete", CompleteAsync).WithName("CompleteTask").ProducesProblem(StatusCodes.Status404NotFound).ProducesProblem(StatusCodes.Status409Conflict);
        group.MapPost("/{id:guid}/reopen", ReopenAsync).WithName("ReopenTask").ProducesProblem(StatusCodes.Status404NotFound).ProducesProblem(StatusCodes.Status409Conflict);

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
                created = TodoTask.Create(request.Title, request.DueDate, request.DueAt);
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

    private static async Task<Results<Ok<TaskResponse>, ProblemHttpResult>> GetAsync(
        Guid id,
        CalendarDbContext db,
        CancellationToken cancellationToken)
    {
        var found = await db.Tasks.AsNoTracking().Where(t => t.Id == id).Select(TaskResponse.Projection).FirstOrDefaultAsync(cancellationToken);
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
        var task = await db.Tasks.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
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
