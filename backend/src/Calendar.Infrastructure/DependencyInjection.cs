using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Calendar.Infrastructure;

public static class DependencyInjection
{
  /// <summary>Configuration key of the application's connection string (user-secrets or <c>ConnectionStrings__Calendar</c>).</summary>
  public const string ConnectionStringName = "Calendar";

  /// <summary>
  /// Registers <see cref="CalendarDbContext"/>. The connection string, which must belong to the
  /// least-privilege <c>calendar_app</c> role, is read from configuration when the context is first
  /// resolved, so a missing value fails the request that needs the database, not unrelated endpoints.
  /// Migrations are never applied here (ADR-0015).
  /// </summary>
  public static IServiceCollection AddCalendarInfrastructure(this IServiceCollection services, IConfiguration configuration)
  {
    ArgumentNullException.ThrowIfNull(configuration);

    services.AddDbContext<CalendarDbContext>(options =>
    {
      var connectionString = configuration.GetConnectionString(ConnectionStringName)
              ?? throw new InvalidOperationException(
                  $"Connection string 'ConnectionStrings:{ConnectionStringName}' is not configured. " +
                  "Set it with 'dotnet user-secrets' or the ConnectionStrings__Calendar environment variable (see README).");
      CalendarDbContextOptions.Configure(options, connectionString);
    });
    return services;
  }
}
