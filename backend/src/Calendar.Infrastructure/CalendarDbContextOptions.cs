using Microsoft.EntityFrameworkCore;

namespace Calendar.Infrastructure;

/// <summary>The one place the provider and naming convention are configured (ADR-0014, ADR-0015).</summary>
public static class CalendarDbContextOptions
{
    public static DbContextOptionsBuilder<CalendarDbContext> Create(string connectionString)
    {
        var builder = new DbContextOptionsBuilder<CalendarDbContext>();
        Configure(builder, connectionString);
        return builder;
    }

    public static DbContextOptionsBuilder Configure(DbContextOptionsBuilder options, string connectionString) =>
        options.UseNpgsql(connectionString).UseSnakeCaseNamingConvention();
}
