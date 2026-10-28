using Calendar.Domain.Tasks;
using Calendar.Domain.Time;

namespace Calendar.Infrastructure.Queries;

/// <summary>The task list views: which tasks each shows and in which order.</summary>
public enum TaskListView
{
  /// <summary>Open tasks due today or later, by local due date, then due instant (date-only last), then id.</summary>
  Upcoming,

  /// <summary>Open tasks due before today, in the same order as <see cref="Upcoming"/>.</summary>
  Overdue,

  /// <summary>Completed tasks, most recently completed first, then id descending.</summary>
  Completed,

  /// <summary>Open tasks with no due date or instant, by id.</summary>
  NoDeadline,
}

/// <summary>
/// The last task of a page, from which the next page continues. <see cref="DueDate"/> is its local due date
/// (dated views), and <see cref="Instant"/> its due instant (dated views) or completion instant
/// (<see cref="TaskListView.Completed"/>).
/// </summary>
public sealed record TaskListKey(Guid Id, DateOnly? DueDate, DateTimeOffset? Instant);

/// <summary>
/// SQL filters and keyset orderings of the task list views. Every comparison runs in the database, so a page
/// continues exactly where the previous one ended, whatever the database's uuid or collation ordering.
/// </summary>
public static class TaskListQueries
{
  /// <summary>
  /// The tasks of <paramref name="view"/>, ordered, after <paramref name="after"/> when given. The dated views
  /// need <paramref name="today"/>, the client's day in <paramref name="zone"/>: a task is overdue when its due
  /// date is before it, or its due instant before the day starts (the split <c>AgendaQueries.OverdueFor</c>
  /// uses), and timed tasks sort on their local date in <paramref name="zone"/>.
  /// </summary>
  public static IQueryable<TodoTask> ForView(
      this IQueryable<TodoTask> tasks, TaskListView view, DayWindow? today, TimeZoneInfo? zone, TaskListKey? after)
  {
    ArgumentNullException.ThrowIfNull(tasks);
    return view switch
    {
      TaskListView.Completed => Completed(tasks, after),
      TaskListView.NoDeadline => NoDeadline(tasks, after),
      _ when today is { } day && zone is not null => Dated(tasks, view == TaskListView.Overdue, day, zone.Id, after),
      _ => throw new ArgumentException("The dated views need today's window and zone.", nameof(today)),
    };
  }

  /// <summary>The key of a task, from which the page after it continues in <paramref name="view"/>.</summary>
  public static TaskListKey KeyOf(TaskListView view, Guid id, DateOnly? dueDate, DateTimeOffset? dueAt, DateTimeOffset? completedAt, TimeZoneInfo? zone) =>
      view switch
      {
        TaskListView.Completed => new(id, null, completedAt),
        TaskListView.NoDeadline => new(id, null, null),
        _ => new(id, dueDate ?? DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(dueAt!.Value, zone!).DateTime), dueAt),
      };

  private static IQueryable<TodoTask> Completed(IQueryable<TodoTask> tasks, TaskListKey? after)
  {
    tasks = tasks.Where(t => t.CompletedAt != null);
    if (after is { Instant: { } at, Id: var id })
    {
      tasks = tasks.Where(t => t.CompletedAt < at || (t.CompletedAt == at && t.Id.CompareTo(id) < 0));
    }

    return tasks.OrderByDescending(t => t.CompletedAt).ThenByDescending(t => t.Id);
  }

  private static IQueryable<TodoTask> NoDeadline(IQueryable<TodoTask> tasks, TaskListKey? after)
  {
    tasks = tasks.Where(t => t.CompletedAt == null && t.DueDate == null && t.DueAt == null);
    if (after is { Id: var id })
    {
      tasks = tasks.Where(t => t.Id.CompareTo(id) > 0);
    }

    return tasks.OrderBy(t => t.Id);
  }

  private static IQueryable<TodoTask> Dated(IQueryable<TodoTask> tasks, bool overdue, DayWindow today, string zone, TaskListKey? after)
  {
    var (date, start) = (today.Date, today.Start);
    tasks = overdue
        ? tasks.Where(t => t.CompletedAt == null && (t.DueDate < date || t.DueAt < start))
        : tasks.Where(t => t.CompletedAt == null && (t.DueDate >= date || t.DueAt >= start));

    // The local due date (a date-only task's own date, or a timed task's instant AT TIME ZONE in SQL) leads both
    // the seek and the order; date-only tasks follow timed ones on the same date.
    if (after is { DueDate: { } afterDate, Instant: var afterAt, Id: var id })
    {
      tasks = afterAt is { } at
          ? tasks.Where(t =>
              (t.DueDate ?? DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(t.DueAt!.Value.UtcDateTime, zone))) > afterDate
              || ((t.DueDate ?? DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(t.DueAt!.Value.UtcDateTime, zone))) == afterDate
                  && (t.DueAt == null || t.DueAt > at || (t.DueAt == at && t.Id.CompareTo(id) > 0))))
          : tasks.Where(t =>
              (t.DueDate ?? DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(t.DueAt!.Value.UtcDateTime, zone))) > afterDate
              || ((t.DueDate ?? DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(t.DueAt!.Value.UtcDateTime, zone))) == afterDate
                  && t.DueAt == null && t.Id.CompareTo(id) > 0));
    }

    return tasks
        .OrderBy(t => t.DueDate ?? DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(t.DueAt!.Value.UtcDateTime, zone)))
        .ThenBy(t => t.DueAt == null)
        .ThenBy(t => t.DueAt)
        .ThenBy(t => t.Id);
  }
}
