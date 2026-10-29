using Calendar.Domain.Events;
using Calendar.Domain.Tasks;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Calendar.Infrastructure;

/// <summary>
/// EF Core context for the calendar database (ADR-0015). Entity mappings live in
/// <c>IEntityTypeConfiguration&lt;T&gt;</c> classes in this assembly and are picked up automatically.
/// </summary>
public sealed class CalendarDbContext(DbContextOptions<CalendarDbContext> options) : DbContext(options), IDataProtectionKeyContext
{
  /// <summary>Shared ASP.NET Data Protection keys.</summary>
  public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

  /// <summary>Calendar events.</summary>
  public DbSet<CalendarEvent> Events => Set<CalendarEvent>();

  /// <summary>To-do tasks.</summary>
  public DbSet<TodoTask> Tasks => Set<TodoTask>();

  /// <inheritdoc />
  protected override void OnModelCreating(ModelBuilder modelBuilder) => modelBuilder.ApplyConfigurationsFromAssembly(typeof(CalendarDbContext).Assembly);
}
