using Calendar.Domain.Events;
using Calendar.Domain.Tasks;
using Calendar.Domain.Users;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace Calendar.Infrastructure;

/// <summary>
/// EF Core context for the calendar database (ADR-0015). Entity mappings live in
/// <c>IEntityTypeConfiguration&lt;T&gt;</c> classes in this assembly and are picked up automatically.
/// Events and tasks are scoped to <see cref="ICurrentUser"/> by global query filters, so every read, count,
/// set-based update and delete only ever sees that user's rows (ADR-0041); with no user they see nothing.
/// </summary>
public sealed class CalendarDbContext(DbContextOptions<CalendarDbContext> options, ICurrentUser currentUser)
  : DbContext(options), IDataProtectionKeyContext
{
  private readonly ICurrentUser _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));

  /// <summary>A context with no current user: it matches no events or tasks. For migrations and tooling.</summary>
  public CalendarDbContext(DbContextOptions<CalendarDbContext> options)
    : this(options, FixedCurrentUser.None)
  {
  }

  /// <summary>Shared ASP.NET Data Protection keys.</summary>
  public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

  /// <summary>People who own events and tasks. Not scoped: sign-in looks users up before there is a current user.</summary>
  public DbSet<User> Users => Set<User>();

  /// <summary>The current user's calendar events.</summary>
  public DbSet<CalendarEvent> Events => Set<CalendarEvent>();

  /// <summary>The current user's to-do tasks.</summary>
  public DbSet<TodoTask> Tasks => Set<TodoTask>();

  /// <summary>The id the query filters compare <c>owner_id</c> with; <c>null</c> matches no row.</summary>
  private Guid? CurrentUserId => _currentUser.Id;

  /// <inheritdoc />
  public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
  {
    RequireOwnedByCurrentUser();
    return base.SaveChangesAsync(cancellationToken);
  }

  /// <inheritdoc />
  public override int SaveChanges()
  {
    RequireOwnedByCurrentUser();
    return base.SaveChanges();
  }

  /// <inheritdoc />
  protected override void OnModelCreating(ModelBuilder modelBuilder)
  {
    modelBuilder.ApplyConfigurationsFromAssembly(typeof(CalendarDbContext).Assembly);

    // The filters capture this context, so each instance compares with its own user. EF Core evaluates
    // CurrentUserId once per query as a parameter.
    modelBuilder.Entity<CalendarEvent>().HasQueryFilter(e => e.OwnerId == CurrentUserId);
    modelBuilder.Entity<TodoTask>().HasQueryFilter(t => t.OwnerId == CurrentUserId);
  }

  /// <summary>
  /// A context with a current user may only add rows that user owns. A context without one (migrations, tests
  /// arranging data) is not checked: it already cannot read anything.
  /// </summary>
  private void RequireOwnedByCurrentUser()
  {
    if (CurrentUserId is not { } userId)
    {
      return;
    }

    foreach (EntityEntry entry in ChangeTracker.Entries().Where(e => e.State == EntityState.Added))
    {
      Guid? owner = entry.Entity switch
      {
        CalendarEvent e => e.OwnerId,
        TodoTask t => t.OwnerId,
        _ => null,
      };
      if (owner is { } ownerId && ownerId != userId)
      {
        throw new InvalidOperationException("A row can only be added for the signed-in user.");
      }
    }
  }
}
