namespace Calendar.Domain.Events;

/// <summary>A scheduled occurrence on a calendar.</summary>
public sealed record CalendarEvent
{
    private CalendarEvent(Guid id, string title, DateTimeOffset start, DateTimeOffset end)
    {
        Id = id;
        Title = title;
        Start = start;
        End = end;
    }

    public Guid Id { get; }

    public string Title { get; }

    public DateTimeOffset Start { get; }

    public DateTimeOffset End { get; }

    public TimeSpan Duration => End - Start;

    public static CalendarEvent Create(string title, DateTimeOffset start, DateTimeOffset end)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(title);
        if (end <= start)
        {
            throw new ArgumentException("Event end must be after its start.", nameof(end));
        }

        return new CalendarEvent(Guid.NewGuid(), title.Trim(), start, end);
    }

    public bool Overlaps(CalendarEvent other)
    {
        ArgumentNullException.ThrowIfNull(other);
        return Start < other.End && other.Start < End;
    }
}
