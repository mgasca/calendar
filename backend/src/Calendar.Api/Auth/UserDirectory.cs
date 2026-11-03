using Calendar.Domain.Users;
using Calendar.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Calendar.Api.Auth;

/// <summary>
/// Finds or creates the <see cref="User"/> row of a signed-in identity (ADR-0041). Sign-in and the Development
/// seed scheme share one lookup order: by Google subject; failing that, by lower-cased email (a real sign-in
/// only matches a row that has no subject yet, so another Google account never takes over a claimed row; the
/// seed scheme asserts no Google identity and matches its email whatever the row's subject); failing that, when
/// the email is the first in <c>Auth:AllowedEmails</c>, the unclaimed legacy placeholder; otherwise a new row.
/// A real sign-in fills in the subject of a matched row; the seed scheme never sets one.
/// </summary>
internal sealed class UserDirectory(CalendarDbContext db, TimeProvider time, IConfiguration configuration)
{
  /// <summary>Resolves the user row for <paramref name="email"/>, creating it when none matches, and records the sign-in.</summary>
  /// <param name="email">The verified email; matched and stored lower-cased.</param>
  /// <param name="googleSubject">Google's <c>sub</c> claim, or <c>null</c> for the seed scheme.</param>
  /// <param name="displayName">The display name to record, or <c>null</c> to keep the current one.</param>
  /// <param name="pictureUrl">The picture URL to record, or <c>null</c> to keep the current one.</param>
  /// <param name="cancellationToken">Cancels the lookup.</param>
  public async Task<User> ResolveAsync(
    string email,
    string? googleSubject,
    string? displayName,
    string? pictureUrl,
    CancellationToken cancellationToken)
  {
    var normalizedEmail = User.NormalizeEmail(email);
    DateTimeOffset now = time.GetUtcNow();
    var retried = false;
    while (true)
    {
      User? user = await FindAsync(normalizedEmail, googleSubject, cancellationToken);
      if (user is null)
      {
        user = User.Create(now, normalizedEmail, googleSubject, displayName, pictureUrl);
        db.Users.Add(user);
      }
      else
      {
        user.SignIn(now, normalizedEmail, googleSubject, displayName, pictureUrl);
      }

      try
      {
        await db.SaveChangesAsync(cancellationToken);
        return user;
      }
      catch (DbUpdateException exception) when (!retried && IsUniqueViolation(exception))
      {
        // Two first sign-ins of the same person raced; the other request's row wins and the lookup finds it.
        retried = true;
        db.ChangeTracker.Clear();
      }
    }
  }

  /// <summary>The first configured allow-listed email, trimmed, or <c>null</c> when the allow-list is empty.</summary>
  public string? FirstAllowedEmail() =>
    configuration.GetSection("Auth:AllowedEmails").Get<string[]>()?
      .Select(entry => entry?.Trim())
      .FirstOrDefault(entry => !string.IsNullOrEmpty(entry));

  internal static bool IsUniqueViolation(Exception exception)
  {
    for (Exception? current = exception; current is not null; current = current.InnerException)
    {
      if (current is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
      {
        return true;
      }
    }

    return false;
  }

  private bool IsFirstAllowed(string normalizedEmail) =>
    FirstAllowedEmail() is { } first && string.Equals(User.NormalizeEmail(first), normalizedEmail, StringComparison.Ordinal);

  private async Task<User?> FindAsync(string normalizedEmail, string? googleSubject, CancellationToken cancellationToken)
  {
    User? user = googleSubject is null
      ? null
      : await db.Users.FirstOrDefaultAsync(u => u.GoogleSubject == googleSubject, cancellationToken);
    user ??= googleSubject is null
      ? await db.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail, cancellationToken)
      : await db.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail && u.GoogleSubject == null, cancellationToken);
    if (user is null && IsFirstAllowed(normalizedEmail))
    {
      user = await db.Users.FirstOrDefaultAsync(
        u => u.Id == User.LegacyOwnerId && u.GoogleSubject == null && u.Email == null,
        cancellationToken);
    }

    return user;
  }
}
