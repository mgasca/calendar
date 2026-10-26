using Microsoft.EntityFrameworkCore.Design;

namespace Calendar.Infrastructure;

/// <summary>
/// Used by <c>dotnet ef</c>. <c>migrations add</c> and <c>has-pending-model-changes</c> never connect, so the
/// placeholder is enough; commands that do (<c>database update</c>, <c>migrations bundle</c>) take
/// <c>CALENDAR_MIGRATOR_CONNECTION</c> (a <c>calendar_migrator</c> connection string, see <c>make db-migrate</c>).
/// </summary>
internal sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<CalendarDbContext>
{
    public const string ConnectionVariable = "CALENDAR_MIGRATOR_CONNECTION";

    private const string Placeholder = "Host=localhost;Database=calendar;Username=calendar_migrator";

    public CalendarDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable(ConnectionVariable) ?? Placeholder;
        return new CalendarDbContext(CalendarDbContextOptions.Create(connectionString).Options);
    }
}
