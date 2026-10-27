using System.Linq.Expressions;
using System.Text.Json.Serialization;
using Calendar.Domain.Tasks;

namespace Calendar.Api.Contracts;

/// <summary>Create a task, optionally due on a floating date or at an instant (not both).</summary>
public sealed record CreateTaskRequest
{
  /// <summary>Task title; required, at most 200 characters after trimming.</summary>
  public required string Title { get; init; }

  /// <summary>Floating due date (YYYY-MM-DD); mutually exclusive with <c>dueAt</c>.</summary>
  public DateOnly? DueDate { get; init; }

  /// <summary>Due instant, RFC 3339 with an explicit offset; mutually exclusive with <c>dueDate</c>.</summary>
  [JsonConverter(typeof(ExplicitOffsetConverter))]
  public DateTimeOffset? DueAt { get; init; }
}

/// <summary>A task as stored.</summary>
public sealed record TaskResponse
{
  /// <summary>Unique task id.</summary>
  public required Guid Id { get; init; }

  /// <summary>Task title.</summary>
  public required string Title { get; init; }

  /// <summary>Floating due date, or <c>null</c> if the task has no date-only due.</summary>
  public DateOnly? DueDate { get; init; }

  /// <summary>Due instant, or <c>null</c> if the task has no timed due.</summary>
  public DateTimeOffset? DueAt { get; init; }

  /// <summary>When the task was completed; <c>null</c> while it is open.</summary>
  public DateTimeOffset? CompletedAt { get; init; }

  /// <summary><c>true</c> once the task has been completed.</summary>
  public required bool IsCompleted { get; init; }

  /// <summary>Translatable to SQL, for query projections.</summary>
  public static readonly Expression<Func<TodoTask, TaskResponse>> Projection = t => new TaskResponse
  {
    Id = t.Id,
    Title = t.Title,
    DueDate = t.DueDate,
    DueAt = t.DueAt,
    CompletedAt = t.CompletedAt,
    IsCompleted = t.CompletedAt != null,
  };

  private static readonly Func<TodoTask, TaskResponse> Compiled = Projection.Compile();

  /// <summary>Maps a <see cref="TodoTask"/> to its response.</summary>
  public static TaskResponse From(TodoTask task) => Compiled(task);
}
