using Microsoft.EntityFrameworkCore;

namespace Calendar.Infrastructure;

/// <summary>
/// EF Core context for the calendar database (ADR-0015). Entity mappings live in
/// <c>IEntityTypeConfiguration&lt;T&gt;</c> classes in this assembly and are picked up automatically.
/// </summary>
public sealed class CalendarDbContext(DbContextOptions<CalendarDbContext> options) : DbContext(options)
{
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(CalendarDbContext).Assembly);
    }
}
