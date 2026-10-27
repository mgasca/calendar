using System.ComponentModel;
using System.Linq.Expressions;
using System.Text.Json.Serialization;
using Calendar.Domain.Tasks;

namespace Calendar.Api.Contracts;

/// <summary>Create a task, optionally due on a floating date or at an instant (not both).</summary>
public sealed record CreateTaskRequest
{
  [Description("Required, at most 200 characters after trimming.")]
  public required string Title { get; init; }

  [Description("low, medium or high; defaults to medium.")]
  public string Priority { get; init; } = "medium";

  [Description("Optional notes, at most 4000 characters after trimming.")]
  public string? Notes { get; init; }

  [Description("Floating due date (YYYY-MM-DD); mutually exclusive with dueAt.")]
  public DateOnly? DueDate { get; init; }

  [Description("Due instant, RFC 3339 with an explicit offset; mutually exclusive with dueDate.")]
  [JsonConverter(typeof(ExplicitOffsetConverter))]
  public DateTimeOffset? DueAt { get; init; }
}

public sealed record TaskResponse
{
  public required Guid Id { get; init; }

  public required string Title { get; init; }

  public string Priority { get; init; } = "medium";

  public string? Notes { get; init; }

  public DateOnly? DueDate { get; init; }

  public DateTimeOffset? DueAt { get; init; }

  [Description("When the task was completed; null while it is open.")]
  public DateTimeOffset? CompletedAt { get; init; }

  public required bool IsCompleted { get; init; }

  /// <summary>Translatable to SQL, for query projections.</summary>
  public static readonly Expression<Func<TodoTask, TaskResponse>> Projection = t => new TaskResponse
  {
    Id = t.Id,
    Title = t.Title,
    Priority = t.Priority,
    Notes = t.Notes,
    DueDate = t.DueDate,
    DueAt = t.DueAt,
    CompletedAt = t.CompletedAt,
    IsCompleted = t.CompletedAt != null,
  };

  private static readonly Func<TodoTask, TaskResponse> Compiled = Projection.Compile();

  public static TaskResponse From(TodoTask task) => Compiled(task);
}
