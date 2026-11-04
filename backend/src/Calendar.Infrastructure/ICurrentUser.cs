namespace Calendar.Infrastructure;

/// <summary>
/// The user whose rows <see cref="CalendarDbContext"/> reads and writes (ADR-0041). The API resolves it from the
/// session; tests and tooling pass a <see cref="FixedCurrentUser"/>. With no user the context sees no events or tasks.
/// </summary>
public interface ICurrentUser
{
  /// <summary>The signed-in user's id, or <c>null</c> when there is none.</summary>
  Guid? Id { get; }
}

/// <summary>A current user with a fixed id (or none), for contexts created outside a request.</summary>
public sealed class FixedCurrentUser(Guid? id) : ICurrentUser
{
  /// <summary>A current user with no id: the context matches no events or tasks.</summary>
  public static FixedCurrentUser None { get; } = new(null);

  /// <inheritdoc />
  public Guid? Id { get; } = id;
}
