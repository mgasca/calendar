using Microsoft.EntityFrameworkCore;

namespace Calendar.Infrastructure;

/// <summary>The one place the provider and naming convention are configured (ADR-0014, ADR-0015).</summary>
public static class CalendarDbContextOptions
{
  /// <summary>Creates a typed options builder for <see cref="CalendarDbContext"/> using <paramref name="connectionString"/>.</summary>
  public static DbContextOptionsBuilder<CalendarDbContext> Create(string connectionString)
  {
    var builder = new DbContextOptionsBuilder<CalendarDbContext>();
    Configure(builder, connectionString);
    return builder;
  }

  /// <summary>Applies the Npgsql provider and snake_case naming convention to an existing options builder.</summary>
  public static DbContextOptionsBuilder Configure(DbContextOptionsBuilder options, string connectionString) =>
      options.UseNpgsql(connectionString).UseSnakeCaseNamingConvention();
}
