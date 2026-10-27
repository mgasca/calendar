using Calendar.Domain.Agenda;
using Calendar.Domain.Events;
using Calendar.Domain.Tasks;
using Calendar.Domain.Time;

namespace Calendar.Domain.Tests.Agenda;

public sealed class DayInclusionTests
{
  private const string Zone = "America/New_York";
  private static readonly DateOnly Today = new(2026, 10, 26);

  // New York, 2026-10-26: [04:00Z, 2026-10-27T04:00Z).
  private static readonly DayWindow Window = DayWindow.Create(Today, TimeZones.FindIana(Zone));

  private static DateTimeOffset At(int dayOffset, int hour, int minute = 0) =>
      new DateTimeOffset(2026, 10, 26, hour, minute, 0, TimeSpan.Zero).AddDays(dayOffset);

  private static CalendarEvent Timed(DateTimeOffset start, DateTimeOffset end) => CalendarEvent.Create("E", start, end, Zone);

  private static CalendarEvent AllDay(int startOffset, int endOffset) =>
      CalendarEvent.CreateAllDay("E", Today.AddDays(startOffset), Today.AddDays(endOffset));

  // ---- events ----

  [Fact]
  public void Event_Timed_InsideWindow_Included() => DayInclusion.EventOccursOn(Timed(At(0, 14), At(0, 15)), Window).ShouldBeTrue();

  [Fact]
  public void Event_Timed_OvernightFromYesterday_Included() => DayInclusion.EventOccursOn(Timed(At(-1, 23), At(0, 6)), Window).ShouldBeTrue();

  [Fact]
  public void Event_Timed_ContinuingIntoTomorrow_Included() => DayInclusion.EventOccursOn(Timed(At(0, 22), At(1, 6)), Window).ShouldBeTrue();

  [Fact]
  public void Event_Timed_SpanningWholeDay_Included() => DayInclusion.EventOccursOn(Timed(At(-2, 0), At(3, 0)), Window).ShouldBeTrue();

  [Fact]
  public void Event_Timed_EndingExactlyAtWindowStart_Excluded() => DayInclusion.EventOccursOn(Timed(At(0, 2), Window.Start), Window).ShouldBeFalse();

  [Fact]
  public void Event_Timed_StartingExactlyAtWindowEnd_Excluded() => DayInclusion.EventOccursOn(Timed(Window.End, Window.End.AddHours(1)), Window).ShouldBeFalse();

  [Fact]
  public void Event_Timed_OneTickInsideEdges_Included()
  {
    DayInclusion.EventOccursOn(Timed(Window.Start.AddHours(-1), Window.Start.AddTicks(1)), Window).ShouldBeTrue();
    DayInclusion.EventOccursOn(Timed(Window.End.AddTicks(-1), Window.End.AddHours(1)), Window).ShouldBeTrue();
  }

  [Fact]
  public void Event_Timed_IsEvaluatedInTheViewersZone_NotUtcDate()
  {
    // 02:00Z on the 26th is still the 25th in New York.
    DayInclusion.EventOccursOn(Timed(At(0, 2), At(0, 3)), Window).ShouldBeFalse();
    // 02:00Z on the 27th is the evening of the 26th in New York.
    DayInclusion.EventOccursOn(Timed(At(1, 2), At(1, 3)), Window).ShouldBeTrue();
  }

  [Theory]
  [InlineData(0, 1, true)]
  [InlineData(-2, 1, true)]
  [InlineData(-1, 2, true)]
  [InlineData(0, 3, true)]
  [InlineData(-3, 0, false)] // ends (exclusive) on today
  [InlineData(1, 2, false)]
  [InlineData(-1, 0, false)]
  public void Event_AllDay_UsesDatesWithExclusiveEnd(int startOffset, int endOffset, bool expected) => DayInclusion.EventOccursOn(AllDay(startOffset, endOffset), Window).ShouldBe(expected);

  [Fact]
  public void Event_AllDay_IsFloating_IgnoresWindowInstants()
  {
    // Same date in a zone far east: window starts on the previous UTC day, but the all-day date matches by date only.
    var tokyo = DayWindow.Create(Today, TimeZones.FindIana("Asia/Tokyo"));

    DayInclusion.EventOccursOn(AllDay(0, 1), tokyo).ShouldBeTrue();
    DayInclusion.EventOccursOn(AllDay(-1, 0), tokyo).ShouldBeFalse();
  }

  [Fact]
  public void Event_Null_Throws() => Should.Throw<ArgumentNullException>(() => DayInclusion.EventOccursOn(null!, Window));

  // ---- tasks: due today ----

  [Fact]
  public void Task_DueDateToday_IsDueToday()
  {
    var task = TodoTask.Create("T", dueDate: Today);

    DayInclusion.IsDueToday(task, Window).ShouldBeTrue();
    DayInclusion.IsOverdue(task, Window).ShouldBeFalse();
  }

  [Theory]
  [InlineData(-1, false)]
  [InlineData(1, false)]
  public void Task_DueDateOtherDay_IsNotDueToday(int offset, bool expected) => DayInclusion.IsDueToday(TodoTask.Create("T", dueDate: Today.AddDays(offset)), Window).ShouldBe(expected);

  [Fact]
  public void Task_DueAt_InWindow_IsDueToday_EvenIfAlreadyPastLocalTime()
  {
    var early = TodoTask.Create("T", dueAt: Window.Start);
    var late = TodoTask.Create("T", dueAt: Window.End.AddTicks(-1));

    DayInclusion.IsDueToday(early, Window).ShouldBeTrue();
    DayInclusion.IsDueToday(late, Window).ShouldBeTrue();
    DayInclusion.IsOverdue(early, Window).ShouldBeFalse();
  }

  [Fact]
  public void Task_DueAt_OutsideWindow_IsNotDueToday()
  {
    DayInclusion.IsDueToday(TodoTask.Create("T", dueAt: Window.Start.AddTicks(-1)), Window).ShouldBeFalse();
    DayInclusion.IsDueToday(TodoTask.Create("T", dueAt: Window.End), Window).ShouldBeFalse();
  }

  // ---- tasks: overdue ----

  [Fact]
  public void Task_DueDateBeforeToday_IsOverdue()
  {
    var task = TodoTask.Create("T", dueDate: Today.AddDays(-1));

    DayInclusion.IsOverdue(task, Window).ShouldBeTrue();
    DayInclusion.IsDueToday(task, Window).ShouldBeFalse();
  }

  [Fact]
  public void Task_DueAtBeforeWindowStart_IsOverdue() => DayInclusion.IsOverdue(TodoTask.Create("T", dueAt: Window.Start.AddTicks(-1)), Window).ShouldBeTrue();

  [Fact]
  public void Task_DueInFuture_IsNeitherDueTodayNorOverdue()
  {
    var byDate = TodoTask.Create("T", dueDate: Today.AddDays(1));
    var byInstant = TodoTask.Create("T", dueAt: Window.End);

    DayInclusion.IsOverdue(byDate, Window).ShouldBeFalse();
    DayInclusion.IsOverdue(byInstant, Window).ShouldBeFalse();
    DayInclusion.IsIncludedInDay(byDate, Window).ShouldBeFalse();
    DayInclusion.IsIncludedInDay(byInstant, Window).ShouldBeFalse();
  }

  [Fact]
  public void Task_Undated_IsNeverIncluded_EvenWhenCompletedToday()
  {
    var open = TodoTask.Create("T");
    var done = TodoTask.Create("T");
    done.Complete(Window.Start.AddHours(1));

    DayInclusion.IsDueToday(open, Window).ShouldBeFalse();
    DayInclusion.IsOverdue(open, Window).ShouldBeFalse();
    DayInclusion.IsIncludedInDay(open, Window).ShouldBeFalse();
    DayInclusion.IsIncludedInDay(done, Window).ShouldBeFalse();
  }

  // ---- tasks: included in day ----

  [Fact]
  public void Task_IncompleteOverdue_Included()
  {
    DayInclusion.IsIncludedInDay(TodoTask.Create("T", dueDate: Today.AddDays(-5)), Window).ShouldBeTrue();
    DayInclusion.IsIncludedInDay(TodoTask.Create("T", dueAt: Window.Start.AddDays(-5)), Window).ShouldBeTrue();
  }

  [Fact]
  public void Task_OverdueCompletedWithinWindow_Included()
  {
    var byDate = TodoTask.Create("T", dueDate: Today.AddDays(-5));
    byDate.Complete(Window.Start);
    var byInstant = TodoTask.Create("T", dueAt: Window.Start.AddDays(-5));
    byInstant.Complete(Window.End.AddTicks(-1));

    DayInclusion.IsIncludedInDay(byDate, Window).ShouldBeTrue();
    DayInclusion.IsIncludedInDay(byInstant, Window).ShouldBeTrue();
  }

  [Fact]
  public void Task_OverdueCompletedBeforeWindow_Excluded()
  {
    var task = TodoTask.Create("T", dueDate: Today.AddDays(-5));
    task.Complete(Window.Start.AddTicks(-1));

    DayInclusion.IsIncludedInDay(task, Window).ShouldBeFalse();
  }

  [Fact]
  public void Task_OverdueCompletedAfterWindow_Excluded()
  {
    var task = TodoTask.Create("T", dueDate: Today.AddDays(-5));
    task.Complete(Window.End);

    DayInclusion.IsIncludedInDay(task, Window).ShouldBeFalse();
  }

  [Fact]
  public void Task_DueTodayCompletedAnyTime_Included()
  {
    var earlier = TodoTask.Create("T", dueDate: Today);
    earlier.Complete(Window.Start.AddDays(-3));
    var later = TodoTask.Create("T", dueAt: Window.Start.AddHours(3));
    later.Complete(Window.End.AddDays(3));

    DayInclusion.IsIncludedInDay(earlier, Window).ShouldBeTrue();
    DayInclusion.IsIncludedInDay(later, Window).ShouldBeTrue();
  }

  [Fact]
  public void Task_ReopenedOverdue_ReturnsToToday()
  {
    var task = TodoTask.Create("T", dueDate: Today.AddDays(-2));
    task.Complete(Window.Start.AddDays(-1));
    DayInclusion.IsIncludedInDay(task, Window).ShouldBeFalse();

    task.Reopen();

    DayInclusion.IsIncludedInDay(task, Window).ShouldBeTrue();
  }

  [Fact]
  public void Task_Null_Throws()
  {
    Should.Throw<ArgumentNullException>(() => DayInclusion.IsDueToday(null!, Window));
    Should.Throw<ArgumentNullException>(() => DayInclusion.IsOverdue(null!, Window));
    Should.Throw<ArgumentNullException>(() => DayInclusion.IsIncludedInDay(null!, Window));
  }

  [Fact]
  public void Task_DueAt_OnDstFallBackDay_UsesTheLongWindow()
  {
    var longDay = DayWindow.Create(new DateOnly(2026, 11, 1), TimeZones.FindIana(Zone));
    var lateEvening = TodoTask.Create("T", dueAt: new DateTimeOffset(2026, 11, 2, 4, 30, 0, TimeSpan.Zero)); // 23:30 EST on the 1st

    DayInclusion.IsDueToday(lateEvening, longDay).ShouldBeTrue();
  }

  [Fact]
  public void Task_OverdueCompletedExactlyAtWindowEnd_Excluded()
  {
    var task = TodoTask.Create("T", Today.AddDays(-2));
    task.Complete(Window.End);

    DayInclusion.IsIncludedInDay(task, Window).ShouldBeFalse();
  }

  [Fact]
  public void Task_OverdueCompletedOneTickBeforeWindowEnd_Included()
  {
    var task = TodoTask.Create("T", Today.AddDays(-2));
    task.Complete(Window.End.AddTicks(-1));

    DayInclusion.IsIncludedInDay(task, Window).ShouldBeTrue();
  }

  [Fact]
  public void Task_DueAtExactlyWindowEnd_IsTomorrow_NotIncluded()
  {
    var task = TodoTask.Create("T", dueAt: Window.End);

    DayInclusion.IsDueToday(task, Window).ShouldBeFalse();
    DayInclusion.IsOverdue(task, Window).ShouldBeFalse();
    DayInclusion.IsIncludedInDay(task, Window).ShouldBeFalse();
  }

  [Fact]
  public void Task_DueAtExactlyWindowStart_IsDueTodayNotOverdue()
  {
    var task = TodoTask.Create("T", dueAt: Window.Start);

    DayInclusion.IsDueToday(task, Window).ShouldBeTrue();
    DayInclusion.IsOverdue(task, Window).ShouldBeFalse();
  }

  [Fact]
  public void Event_Timed_OnDateSkippedByClockChange_NeverOccurs()
  {
    var apia = TimeZones.FindIana("Pacific/Apia");
    var skipped = DayWindow.Create(new DateOnly(2011, 12, 30), apia);
    var spanning = CalendarEvent.Create("E", skipped.Start.AddDays(-1), skipped.Start.AddDays(1), "Pacific/Apia");

    skipped.Length.ShouldBe(TimeSpan.Zero);
    DayInclusion.EventOccursOn(spanning, skipped).ShouldBeFalse();
  }

  // ---- raw-value forms used by the agenda read models ----

  [Theory]
  [InlineData(-1, 23, 0, 6, true)]
  [InlineData(0, 14, 0, 15, true)]
  [InlineData(0, 2, 0, 4, false)] // ends at window start
  [InlineData(1, 4, 1, 5, false)] // starts at window end
  public void RawForms_AgreeWithTheEntityRules_ForTimedEvents(int startDay, int startHour, int endDay, int endHour, bool expected)
  {
    var evt = Timed(At(startDay, startHour), At(endDay, endHour));

    DayInclusion.EventOccursOn(evt, Window).ShouldBe(expected);
    DayInclusion.TimedEventOverlaps(evt.Start!.Value, evt.End!.Value, Window).ShouldBe(expected);
  }

  [Theory]
  [InlineData(-1, 0, false)]
  [InlineData(-1, 1, true)]
  [InlineData(0, 1, true)]
  [InlineData(1, 2, false)]
  public void RawForms_AgreeWithTheEntityRules_ForAllDayEvents(int startOffset, int endOffset, bool expected)
  {
    var evt = AllDay(startOffset, endOffset);

    DayInclusion.EventOccursOn(evt, Window).ShouldBe(expected);
    DayInclusion.AllDayEventCovers(evt.StartDate!.Value, evt.EndDate!.Value, Window).ShouldBe(expected);
  }

  [Fact]
  public void RawForms_AgreeWithTheEntityRules_ForDueTasks()
  {
    TodoTask[] tasks =
    [
        TodoTask.Create("date today", Today),
        TodoTask.Create("date yesterday", Today.AddDays(-1)),
        TodoTask.Create("at start", dueAt: Window.Start),
        TodoTask.Create("at end", dueAt: Window.End),
        TodoTask.Create("undated"),
    ];

    tasks.Select(t => DayInclusion.IsDueOn(t.DueDate, t.DueAt, Window)).ShouldBe(tasks.Select(t => DayInclusion.IsDueToday(t, Window)));
    tasks.Count(t => DayInclusion.IsDueOn(t.DueDate, t.DueAt, Window)).ShouldBe(2);
  }
}
