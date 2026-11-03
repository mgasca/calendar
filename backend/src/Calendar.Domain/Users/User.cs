namespace Calendar.Domain.Users;

/// <summary>
/// A person who may own events and tasks (ADR-0041). Identified by Google's stable <c>sub</c> claim; the email
/// is what the allow-list checks and is refreshed at every sign-in. Two kinds of row have no subject yet: the
/// legacy placeholder the ownership migration created for pre-existing rows (no subject, no email), and a row the
/// Development seed scheme created for an allow-listed email (email only). A real sign-in fills the subject in.
/// </summary>
public sealed class User
{
  /// <summary>
  /// The fixed id of the placeholder that owns every row created before ownership existed. The migration inserts
  /// it; the first sign-in (or seed run) by the first allow-listed email claims it.
  /// </summary>
  public static readonly Guid LegacyOwnerId = new("11111111-1111-1111-1111-111111111111");

  private User()
  {
  }

  /// <summary>Unique id; the value <c>owner_id</c> columns reference.</summary>
  public Guid Id { get; private set; }

  /// <summary>Google's <c>sub</c> claim; <c>null</c> until a real sign-in.</summary>
  public string? GoogleSubject { get; private set; }

  /// <summary>Lower-cased email; <c>null</c> only on an unclaimed legacy placeholder.</summary>
  public string? Email { get; private set; }

  /// <summary>Display name from the identity provider, when known.</summary>
  public string? DisplayName { get; private set; }

  /// <summary>Picture URL from the identity provider, when known.</summary>
  public string? PictureUrl { get; private set; }

  /// <summary>When the row was created (UTC).</summary>
  public DateTimeOffset CreatedAt { get; private set; }

  /// <summary>
  /// When the person last signed in or was last resolved by the seed scheme (UTC); <c>null</c> for an unclaimed
  /// placeholder.
  /// </summary>
  public DateTimeOffset? LastSignedInAt { get; private set; }

  /// <summary>True while the row is the unclaimed legacy placeholder.</summary>
  public bool IsUnclaimedPlaceholder => GoogleSubject is null && Email is null;

  /// <summary>Creates a user for <paramref name="email"/>, with the subject and profile when they are known.</summary>
  public static User Create(
    DateTimeOffset now,
    string email,
    string? googleSubject = null,
    string? displayName = null,
    string? pictureUrl = null)
  {
    var user = new User { Id = Guid.NewGuid(), CreatedAt = now.ToUniversalTime() };
    user.SignIn(now, email, googleSubject, displayName, pictureUrl);
    return user;
  }

  /// <summary>
  /// Records a sign-in (or a seed resolution): refreshes the email, replaces the profile values that are given
  /// (a <c>null</c> keeps the current one), fills in the subject when it is known and missing, and stamps
  /// <see cref="LastSignedInAt"/>. A row that already has a subject keeps it.
  /// </summary>
  public void SignIn(
    DateTimeOffset now,
    string email,
    string? googleSubject = null,
    string? displayName = null,
    string? pictureUrl = null)
  {
    var normalizedEmail = NormalizeEmail(email);
    if (GoogleSubject is not null && googleSubject is not null && !string.Equals(GoogleSubject, googleSubject, StringComparison.Ordinal))
    {
      throw new InvalidOperationException("A user's Google subject never changes.");
    }

    GoogleSubject ??= NormalizeOptional(googleSubject);
    Email = normalizedEmail;
    DisplayName = NormalizeOptional(displayName) ?? DisplayName;
    PictureUrl = NormalizeOptional(pictureUrl) ?? PictureUrl;
    LastSignedInAt = now.ToUniversalTime();
  }

  /// <summary>Trims and lower-cases an email so that lookups and the unique index agree.</summary>
  public static string NormalizeEmail(string email)
  {
    ArgumentException.ThrowIfNullOrWhiteSpace(email);
    return email.Trim().ToLowerInvariant();
  }

  private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
