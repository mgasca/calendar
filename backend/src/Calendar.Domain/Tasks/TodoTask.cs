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

    public Guid Id { get; private set; }

    public string Title { get; private set; }

    /// <summary>Floating due date (no zone); mutually exclusive with <see cref="DueAt"/>.</summary>
    public DateOnly? DueDate { get; private set; }

    /// <summary>Due instant, UTC (offset zero); mutually exclusive with <see cref="DueDate"/>.</summary>
    public DateTimeOffset? DueAt { get; private set; }

    /// <summary>When the task was first completed (UTC); <c>null</c> while open.</summary>
    public DateTimeOffset? CompletedAt { get; private set; }

    public bool IsCompleted => CompletedAt is not null;

    public static TodoTask Create(string title, DateOnly? dueDate = null, DateTimeOffset? dueAt = null)
    {
        var normalizedTitle = Validation.NormalizeTitle(title, nameof(title));
        if (dueDate is not null && dueAt is not null)
        {
            throw new ArgumentException("A task can have a due date or a due instant, not both.", nameof(dueAt));
        }

        return new TodoTask
        {
            Id = Guid.NewGuid(),
            Title = normalizedTitle,
            DueDate = dueDate,
            DueAt = dueAt?.ToUniversalTime(),
        };
    }

    /// <summary>Marks the task complete. Idempotent: an already completed task keeps its first completion time.</summary>
    public void Complete(DateTimeOffset now)
    {
        CompletedAt ??= now.ToUniversalTime();
    }

    /// <summary>Marks the task open again. Idempotent.</summary>
    public void Reopen()
    {
        CompletedAt = null;
    }
}
