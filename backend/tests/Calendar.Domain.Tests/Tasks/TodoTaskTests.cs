using Calendar.Domain.Tasks;

namespace Calendar.Domain.Tests.Tasks;

public sealed class TodoTaskTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 26, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Create_Undated_HasNoDueValue()
    {
        var task = TodoTask.Create("  Buy milk ");

        task.Title.ShouldBe("Buy milk");
        task.Id.ShouldNotBe(Guid.Empty);
        task.DueDate.ShouldBeNull();
        task.DueAt.ShouldBeNull();
        task.IsCompleted.ShouldBeFalse();
    }

    [Fact]
    public void Create_WithDueDate_SetsDueDate()
    {
        var task = TodoTask.Create("A", dueDate: new DateOnly(2026, 10, 26));

        task.DueDate.ShouldBe(new DateOnly(2026, 10, 26));
        task.DueAt.ShouldBeNull();
    }

    [Fact]
    public void Create_WithDueAt_NormalizesToUtc()
    {
        var task = TodoTask.Create("A", dueAt: new DateTimeOffset(2026, 10, 26, 9, 0, 0, TimeSpan.FromHours(-4)));

        task.DueAt.ShouldBe(new DateTimeOffset(2026, 10, 26, 13, 0, 0, TimeSpan.Zero));
        task.DueAt!.Value.Offset.ShouldBe(TimeSpan.Zero);
        task.DueDate.ShouldBeNull();
    }

    [Fact]
    public void Create_WithBothDueValues_Throws()
    {
        Should.Throw<ArgumentException>(() => TodoTask.Create("A", new DateOnly(2026, 10, 26), Now));
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    public void Create_WithBlankTitle_Throws(string title)
    {
        Should.Throw<ArgumentException>(() => TodoTask.Create(title));
    }

    [Fact]
    public void Create_TitleLength_IsCappedAtTwoHundredAfterTrim()
    {
        TodoTask.Create(" " + new string('a', 200)).Title.Length.ShouldBe(200);
        Should.Throw<ArgumentException>(() => TodoTask.Create(new string('a', 201)));
    }

    [Fact]
    public void Complete_SetsCompletedAtInUtc()
    {
        var task = TodoTask.Create("A");

        task.Complete(new DateTimeOffset(2026, 10, 26, 8, 0, 0, TimeSpan.FromHours(-4)));

        task.IsCompleted.ShouldBeTrue();
        task.CompletedAt.ShouldBe(Now);
        task.CompletedAt!.Value.Offset.ShouldBe(TimeSpan.Zero);
    }

    [Fact]
    public void Complete_WhenAlreadyCompleted_KeepsFirstCompletionTime()
    {
        var task = TodoTask.Create("A");
        task.Complete(Now);

        task.Complete(Now.AddHours(5));

        task.CompletedAt.ShouldBe(Now);
    }

    [Fact]
    public void Reopen_ClearsCompletion_AndIsIdempotent()
    {
        var task = TodoTask.Create("A");
        task.Complete(Now);

        task.Reopen();
        task.Reopen();

        task.IsCompleted.ShouldBeFalse();
        task.CompletedAt.ShouldBeNull();
    }

    [Fact]
    public void Complete_AfterReopen_RecordsNewTime()
    {
        var task = TodoTask.Create("A");
        task.Complete(Now);
        task.Reopen();

        task.Complete(Now.AddHours(1));

        task.CompletedAt.ShouldBe(Now.AddHours(1));
    }
}
