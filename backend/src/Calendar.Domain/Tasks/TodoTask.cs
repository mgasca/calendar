namespace Calendar.Domain.Tasks;

/// <summary>
/// A to-do item with an optional due value: a floating <see cref="DueDate"/> (date only) <b>or</b> a
/// <see cref="DueAt"/> instant, never both. Tasks with neither are undated.
/// </summary>
public sealed class TodoTask
{
  private TodoTask()
  {
    Title = string.Empty;
  }

  /// <summary>Unique id, generated on creation.</summary>
  public Guid Id { get; private set; }

  /// <summary>Normalized, non-empty title.</summary>
  public string Title { get; private set; }

  /// <summary>Priority level, one of low, medium, or high.</summary>
  public string Priority { get; private set; } = "medium";

  /// <summary>Optional task notes.</summary>
  public string? Notes { get; private set; }

  /// <summary>Floating due date (no zone); mutually exclusive with <see cref="DueAt"/>.</summary>
  public DateOnly? DueDate { get; private set; }

  /// <summary>Due instant, UTC (offset zero); mutually exclusive with <see cref="DueDate"/>.</summary>
  public DateTimeOffset? DueAt { get; private set; }

  /// <summary>When the task was first completed (UTC); <c>null</c> while open.</summary>
  public DateTimeOffset? CompletedAt { get; private set; }

  /// <summary>True once the task has been completed.</summary>
  public bool IsCompleted => CompletedAt is not null;

  /// <summary>Creates an open task with an optional due date or due instant, but not both.</summary>
  /// <param name="title">The task title.</param>
  /// <param name="dueDate">Floating due date, or <c>null</c>.</param>
  /// <param name="dueAt">Due instant (normalized to UTC), or <c>null</c>.</param>
  /// <param name="priority">Priority level; defaults to medium.</param>
  /// <param name="notes">Optional task notes.</param>
  public static TodoTask Create(
    string title,
    DateOnly? dueDate = null,
    DateTimeOffset? dueAt = null,
    string priority = "medium",
    string? notes = null)
  {
    var normalizedTitle = Validation.NormalizeTitle(title, nameof(title));
    if (dueDate is not null && dueAt is not null)
    {
      throw new ArgumentException("A task can have a due date or a due instant, not both.", nameof(dueAt));
    }

    if (priority is not ("low" or "medium" or "high"))
    {
      throw new ArgumentException("Priority must be low, medium or high.", nameof(priority));
    }

    var normalizedNotes = Validation.NormalizeOptional(notes, Validation.MaxNotesLength, nameof(notes));

    return new TodoTask
    {
      Id = Guid.NewGuid(),
      Title = normalizedTitle,
      Priority = priority,
      Notes = normalizedNotes,
      DueDate = dueDate,
      DueAt = dueAt?.ToUniversalTime(),
    };
  }

  /// <summary>Marks the task complete. Idempotent: an already completed task keeps its first completion time.</summary>
  public void Complete(DateTimeOffset now) => CompletedAt ??= now.ToUniversalTime();

  /// <summary>Marks the task open again. Idempotent.</summary>
  public void Reopen() => CompletedAt = null;
}
