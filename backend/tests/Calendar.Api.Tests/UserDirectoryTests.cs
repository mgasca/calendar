using Calendar.Api.Auth;
using Calendar.Domain.Users;
using Calendar.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Calendar.Api.Tests;

/// <summary>
/// ADR-0041's lookup order: by Google subject; then by email among rows without a subject; then, for the first
/// allow-listed email, the unclaimed legacy placeholder; otherwise a new row.
/// </summary>
public sealed class UserDirectoryTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
  private const string First = "First@Example.com";
  private const string Other = "other@example.com";

  [Fact]
  public async Task NewPerson_GetsARow_AndSignsInAgainToTheSameRow()
  {
    User created = await ResolveAsync(Other, "sub-1", "Other Person", "https://pic/1");
    created.Email.ShouldBe(Other);
    created.GoogleSubject.ShouldBe("sub-1");
    created.DisplayName.ShouldBe("Other Person");
    created.PictureUrl.ShouldBe("https://pic/1");
    created.LastSignedInAt.ShouldBe(Clock.GetUtcNow());

    // Same subject, new email and name, no picture this time: the row follows the subject and keeps the picture.
    User again = await ResolveAsync("Renamed@Example.com", "sub-1", "Renamed", null);
    again.Id.ShouldBe(created.Id);
    again.Email.ShouldBe("renamed@example.com");
    again.DisplayName.ShouldBe("Renamed");
    again.PictureUrl.ShouldBe("https://pic/1");
    (await CountUsersAsync()).ShouldBe(3);
  }

  [Fact]
  public async Task SeedCreatedRow_IsClaimedByTheRealSignIn_WhichFillsInTheSubject()
  {
    User seeded = await ResolveAsync(Other, googleSubject: null, displayName: null, pictureUrl: null);
    seeded.GoogleSubject.ShouldBeNull();
    seeded.Email.ShouldBe(Other);

    User signedIn = await ResolveAsync(Other, "sub-2", "Other", null);
    signedIn.Id.ShouldBe(seeded.Id);
    signedIn.GoogleSubject.ShouldBe("sub-2");
    (await CountUsersAsync()).ShouldBe(3);
  }

  [Fact]
  public async Task SeedScheme_AfterTheRealSignIn_ResolvesTheSameRow_AndKeepsTheSubject()
  {
    User signedIn = await ResolveAsync(Other, "sub-6", "Other", "https://pic/6");

    User seeded = await ResolveAsync(Other, googleSubject: null, displayName: null, pictureUrl: null);

    seeded.Id.ShouldBe(signedIn.Id);
    seeded.GoogleSubject.ShouldBe("sub-6");
    seeded.DisplayName.ShouldBe("Other");
    (await CountUsersAsync()).ShouldBe(3);
  }

  [Theory]
  [InlineData("sub-race")]
  [InlineData(null)]
  public async Task ConcurrentFirstSignIns_ConvergeOnOneRow(string? subjectOfTheRowThatWon)
  {
    // Another request inserts the same person's row between this one's lookup and its insert.
    var interposed = Guid.NewGuid();
    var interceptor = new InterposingInterceptor(Database.MigratorConnectionString, interposed, subjectOfTheRowThatWon);
    DbContextOptions<CalendarDbContext> options = CalendarDbContextOptions.Create(Database.AppConnectionString)
      .AddInterceptors(interceptor)
      .Options;
    await using var db = new CalendarDbContext(options, FixedCurrentUser.None);
    var directory = new UserDirectory(
      db,
      Clock,
      new ConfigurationBuilder().AddInMemoryCollection([new("Auth:AllowedEmails:0", First)]).Build());

    User resolved = await directory.ResolveAsync("race@example.com", "sub-race", "Racer", null, Ct);

    interceptor.Fired.ShouldBe(1);
    resolved.Id.ShouldBe(interposed);
    resolved.GoogleSubject.ShouldBe("sub-race");
    resolved.LastSignedInAt.ShouldBe(Clock.GetUtcNow());
    (await CountUsersAsync()).ShouldBe(3);
  }

  [Fact]
  public async Task FirstAllowListedEmail_ClaimsTheLegacyPlaceholder_OnceOnly()
  {
    await InsertLegacyPlaceholderAsync();

    User claimed = await ResolveAsync(First, "sub-first", "The Owner", null);
    claimed.Id.ShouldBe(User.LegacyOwnerId);
    claimed.Email.ShouldBe("first@example.com");
    claimed.GoogleSubject.ShouldBe("sub-first");
    claimed.IsUnclaimedPlaceholder.ShouldBeFalse();

    User again = await ResolveAsync(First, "sub-first", null, null);
    again.Id.ShouldBe(User.LegacyOwnerId);
    (await CountUsersAsync()).ShouldBe(3);
  }

  [Fact]
  public async Task SeedScheme_ClaimsTheLegacyPlaceholder_ForTheFirstAllowListedEmail()
  {
    await InsertLegacyPlaceholderAsync();

    User seeded = await ResolveAsync(First, googleSubject: null, displayName: null, pictureUrl: null);
    seeded.Id.ShouldBe(User.LegacyOwnerId);
    seeded.GoogleSubject.ShouldBeNull();

    User signedIn = await ResolveAsync(First, "sub-first", "The Owner", null);
    signedIn.Id.ShouldBe(User.LegacyOwnerId);
    signedIn.GoogleSubject.ShouldBe("sub-first");
  }

  [Fact]
  public async Task OtherEmails_NeverClaimTheLegacyPlaceholder()
  {
    await InsertLegacyPlaceholderAsync();

    User other = await ResolveAsync(Other, "sub-3", null, null);
    other.Id.ShouldNotBe(User.LegacyOwnerId);

    await using CalendarDbContext db = Database.CreateMigratorContext();
    User placeholder = await db.Users.SingleAsync(u => u.Id == User.LegacyOwnerId, Ct);
    placeholder.IsUnclaimedPlaceholder.ShouldBeTrue();
  }

  [Fact]
  public async Task AnotherSubjectWithAClaimedEmail_DoesNotTakeOverTheRow()
  {
    await ResolveAsync(Other, "sub-4", null, null);

    // Google says the email now belongs to another account: no silent takeover, the sign-in fails instead.
    await Should.ThrowAsync<DbUpdateException>(() => ResolveAsync(Other, "sub-5", null, null));
    (await CountUsersAsync()).ShouldBe(3);
  }

  private async Task<User> ResolveAsync(string email, string? googleSubject, string? displayName, string? pictureUrl)
  {
    using WebApplicationFactory<Program> host = Factory.WithWebHostBuilder(builder => builder.UseSetting("Auth:AllowedEmails:0", First));
    using IServiceScope scope = host.Services.CreateScope();
    UserDirectory directory = scope.ServiceProvider.GetRequiredService<UserDirectory>();
    return await directory.ResolveAsync(email, googleSubject, displayName, pictureUrl, Ct);
  }

  private async Task InsertLegacyPlaceholderAsync()
  {
    await using CalendarDbContext db = Database.CreateMigratorContext();
    await db.Database.ExecuteSqlAsync($"INSERT INTO users (id, created_at) VALUES ({User.LegacyOwnerId}, now())", Ct);
  }

  /// <summary>Users in the table; the base class seeds two.</summary>
  private async Task<int> CountUsersAsync()
  {
    await using CalendarDbContext db = Database.CreateMigratorContext();
    return await db.Users.CountAsync(Ct);
  }

  /// <summary>On the first save that adds a user, inserts a competing row for the same email through another connection.</summary>
  private sealed class InterposingInterceptor(string connectionString, Guid id, string? subject) : SaveChangesInterceptor
  {
    public int Fired { get; private set; }

    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
      DbContextEventData eventData,
      InterceptionResult<int> result,
      CancellationToken cancellationToken = default)
    {
      if (Fired == 0 && eventData.Context!.ChangeTracker.Entries<User>().Any(e => e.State == EntityState.Added))
      {
        Fired++;
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var insert = new NpgsqlCommand(
          "INSERT INTO users (id, google_subject, email, created_at) VALUES (@id, @subject, 'race@example.com', now())",
          connection);
        insert.Parameters.AddWithValue("id", id);
        insert.Parameters.AddWithValue("subject", (object?)subject ?? DBNull.Value);
        await insert.ExecuteNonQueryAsync(cancellationToken);
      }

      return result;
    }
  }
}
