using System.Linq.Expressions;
using System.Text.Json.Serialization;
using Calendar.Domain.Tasks;

namespace Calendar.Api.Contracts;

/// <summary>Create a task, optionally due on a floating date or at an instant (not both).</summary>
public sealed record CreateTaskRequest
{
  /// <summary>Task title; required, at most 200 characters after trimming.</summary>
  public required string Title { get; init; }

  /// <summary>Priority level; defaults to medium. Allowed values: low, medium, high.</summary>
  public string Priority { get; init; } = "medium";

  /// <summary>Optional notes, at most 4000 characters after trimming.</summary>
  public string? Notes { get; init; }

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

  /// <summary>Priority level: low, medium, or high.</summary>
  public string Priority { get; init; } = "medium";

  /// <summary>Optional task notes.</summary>
  public string? Notes { get; init; }

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
    Priority = t.Priority,
    Notes = t.Notes,
    DueDate = t.DueDate,
    DueAt = t.DueAt,
    CompletedAt = t.CompletedAt,
    IsCompleted = t.CompletedAt != null,
  };

  private static readonly Func<TodoTask, TaskResponse> Compiled = Projection.Compile();

  /// <summary>Maps a <see cref="TodoTask"/> to its response.</summary>
  public static TaskResponse From(TodoTask task) => Compiled(task);
}

/// <summary>A task in an agenda.</summary>
public sealed record AgendaTaskItem
{
  /// <summary>Unique task id.</summary>
  public required Guid Id { get; init; }

  /// <summary>Task title.</summary>
  public required string Title { get; init; }

  /// <summary>Priority level: low, medium, or high.</summary>
  public string Priority { get; init; } = "medium";

  /// <summary>Whether the task has notes.</summary>
  public required bool HasNotes { get; init; }

  /// <summary>Floating due date, or <c>null</c> if the task has no date-only due.</summary>
  public DateOnly? DueDate { get; init; }

  /// <summary>Due instant, or <c>null</c> if the task has no timed due.</summary>
  public DateTimeOffset? DueAt { get; init; }

  /// <summary>When the task was completed; <c>null</c> while it is open.</summary>
  public DateTimeOffset? CompletedAt { get; init; }

  /// <summary><c>true</c> once the task has been completed.</summary>
  public required bool IsCompleted { get; init; }

  /// <summary>Translatable to SQL, for query projections.</summary>
  public static readonly Expression<Func<TodoTask, AgendaTaskItem>> Projection = t => new AgendaTaskItem
  {
    Id = t.Id,
    Title = t.Title,
    Priority = t.Priority,
    HasNotes = t.Notes != null,
    DueDate = t.DueDate,
    DueAt = t.DueAt,
    CompletedAt = t.CompletedAt,
    IsCompleted = t.CompletedAt != null,
  };

}

/// <summary>One page of a task list view.</summary>
public sealed record TaskPage
{
  /// <summary>The page's tasks, in the view's order.</summary>
  public required IReadOnlyList<TaskResponse> Items { get; init; }

  /// <summary>Pass as <c>cursor</c> for the next page; <c>null</c> on the last page.</summary>
  public string? NextCursor { get; init; }
}

/// <summary>Apply one action to explicit task ids or a guarded overdue filter.</summary>
public sealed record BulkTaskRequest
{
  /// <summary>Action to apply.</summary>
  public required BulkTaskAction Action { get; init; }

  /// <summary>Explicit task ids; mutually exclusive with <see cref="Filter"/>.</summary>
  public IReadOnlyList<Guid>? Ids { get; init; }

  /// <summary>Overdue filter target; mutually exclusive with <see cref="Ids"/>.</summary>
  public OverdueTaskFilter? Filter { get; init; }

  /// <summary>New floating deadline, required for setDueDate.</summary>
  public DateOnly? DueDate { get; init; }

  /// <summary>New deadline instant, required for setDueInstant.</summary>
  [JsonConverter(typeof(ExplicitOffsetConverter))]
  public DateTimeOffset? DueAt { get; init; }
}

/// <summary>Supported bulk task actions.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<BulkTaskAction>))]
public enum BulkTaskAction
{
  /// <summary>Complete an open task.</summary>
  [JsonStringEnumMemberName("complete")]
  Complete,

  /// <summary>Set a floating due date.</summary>
  [JsonStringEnumMemberName("setDueDate")]
  SetDueDate,

  /// <summary>Set a due instant.</summary>
  [JsonStringEnumMemberName("setDueInstant")]
  SetDueInstant,

  /// <summary>Clear the task deadline.</summary>
  [JsonStringEnumMemberName("clearDeadline")]
  ClearDeadline,

  /// <summary>Delete the task.</summary>
  [JsonStringEnumMemberName("delete")]
  Delete,
}

/// <summary>Guarded overdue query and the count the client observed.</summary>
public sealed record OverdueTaskFilter
{
  /// <summary>The only supported filtered view.</summary>
  public required string View { get; init; }

  /// <summary>Client's current date.</summary>
  public required DateOnly Today { get; init; }

  /// <summary>Client's IANA time zone.</summary>
  public required string TimeZone { get; init; }

  /// <summary>Expected number of matching overdue tasks.</summary>
  public required int ExpectedTotal { get; init; }
}

/// <summary>Outcome for one requested task.</summary>
public sealed record BulkTaskItemResult
{
  /// <summary>Task id.</summary>
  public required Guid Id { get; init; }

  /// <summary>applied, skipped or notFound.</summary>
  public required string Outcome { get; init; }
}

/// <summary>Per-task outcomes and totals for a bulk action.</summary>
public sealed record BulkTaskResponse
{
  /// <summary>One outcome per distinct requested id.</summary>
  public required IReadOnlyList<BulkTaskItemResult> Results { get; init; }

  /// <summary>Number of applied actions.</summary>
  public required int Applied { get; init; }

  /// <summary>Number of skipped actions.</summary>
  public required int Skipped { get; init; }

  /// <summary>Number of ids that were not found.</summary>
  public required int NotFound { get; init; }
}
