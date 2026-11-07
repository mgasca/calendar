using Microsoft.EntityFrameworkCore;

namespace Calendar.Infrastructure;

/// <summary>
/// The optimistic-concurrency version of an event or task row (ADR-0015). It is PostgreSQL's <c>xmin</c>, kept
/// inside Infrastructure (ADR-0014): callers only read it and hand it back.
/// </summary>
public static class RowVersion
{
  /// <summary>The shadow property that holds the version.</summary>
  internal const string PropertyName = "xmin";

  /// <summary>The version of a tracked <paramref name="entity"/> as last loaded or saved.</summary>
  public static uint VersionOf<TEntity>(this DbContext db, TEntity entity)
    where TEntity : class
  {
    ArgumentNullException.ThrowIfNull(db);
    return db.Entry(entity).Property<uint>(PropertyName).CurrentValue;
  }

  /// <summary>
  /// Makes the next save of the tracked <paramref name="entity"/> succeed only if the row still has
  /// <paramref name="version"/>; otherwise <see cref="DbContext.SaveChangesAsync(CancellationToken)"/> throws
  /// <see cref="DbUpdateConcurrencyException"/> and nothing is written.
  /// </summary>
  public static void ExpectVersion<TEntity>(this DbContext db, TEntity entity, uint version)
    where TEntity : class
  {
    ArgumentNullException.ThrowIfNull(db);
    db.Entry(entity).Property<uint>(PropertyName).OriginalValue = version;
  }
}
