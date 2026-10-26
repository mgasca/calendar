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
    public void Event_Timed_InsideWindow_Included()
    {
        DayInclusion.EventOccursOn(Timed(At(0, 14), At(0, 15)), Window).ShouldBeTrue();
    }

    [Fact]
    public void Event_Timed_OvernightFromYesterday_Included()
    {
        DayInclusion.EventOccursOn(Timed(At(-1, 23), At(0, 6)), Window).ShouldBeTrue();
    }

    [Fact]
    public void Event_Timed_ContinuingIntoTomorrow_Included()
    {
        DayInclusion.EventOccursOn(Timed(At(0, 22), At(1, 6)), Window).ShouldBeTrue();
    }

    [Fact]
    public void Event_Timed_SpanningWholeDay_Included()
    {
        DayInclusion.EventOccursOn(Timed(At(-2, 0), At(3, 0)), Window).ShouldBeTrue();
    }

    [Fact]
    public void Event_Timed_EndingExactlyAtWindowStart_Excluded()
    {
        DayInclusion.EventOccursOn(Timed(At(0, 2), Window.Start), Window).ShouldBeFalse();
    }

    [Fact]
    public void Event_Timed_StartingExactlyAtWindowEnd_Excluded()
    {
        DayInclusion.EventOccursOn(Timed(Window.End, Window.End.AddHours(1)), Window).ShouldBeFalse();
    }

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
    public void Event_AllDay_UsesDatesWithExclusiveEnd(int startOffset, int endOffset, bool expected)
    {
        DayInclusion.EventOccursOn(AllDay(startOffset, endOffset), Window).ShouldBe(expected);
    }

    [Fact]
    public void Event_AllDay_IsFloating_IgnoresWindowInstants()
    {
        // Same date in a zone far east: window starts on the previous UTC day, but the all-day date matches by date only.
        var tokyo = DayWindow.Create(Today, TimeZones.FindIana("Asia/Tokyo"));

        DayInclusion.EventOccursOn(AllDay(0, 1), tokyo).ShouldBeTrue();
        DayInclusion.EventOccursOn(AllDay(-1, 0), tokyo).ShouldBeFalse();
    }

    [Fact]
    public void Event_Null_Throws()
    {
        Should.Throw<ArgumentNullException>(() => DayInclusion.EventOccursOn(null!, Window));
    }

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
    public void Task_DueDateOtherDay_IsNotDueToday(int offset, bool expected)
    {
        DayInclusion.IsDueToday(TodoTask.Create("T", dueDate: Today.AddDays(offset)), Window).ShouldBe(expected);
    }

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
    public void Task_DueAtBeforeWindowStart_IsOverdue()
    {
        DayInclusion.IsOverdue(TodoTask.Create("T", dueAt: Window.Start.AddTicks(-1)), Window).ShouldBeTrue();
    }

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
}
