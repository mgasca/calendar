using Calendar.Domain.Users;

namespace Calendar.Domain.Tests.Users;

public sealed class UserTests
{
  private static readonly DateTimeOffset Now = new(2026, 11, 2, 12, 0, 0, TimeSpan.FromHours(1));

  [Fact]
  public void Create_NormalizesTheEmail_AndStampsTheSignIn()
  {
    var user = User.Create(Now, "  Someone@Example.COM ", "sub", " Some One ", null);

    user.Id.ShouldNotBe(Guid.Empty);
    user.Email.ShouldBe("someone@example.com");
    user.GoogleSubject.ShouldBe("sub");
    user.DisplayName.ShouldBe("Some One");
    user.PictureUrl.ShouldBeNull();
    user.CreatedAt.ShouldBe(Now.ToUniversalTime());
    user.LastSignedInAt.ShouldBe(Now.ToUniversalTime());
    user.IsUnclaimedPlaceholder.ShouldBeFalse();
  }

  [Fact]
  public void SignIn_FillsInAMissingSubject_AndKeepsProfileValuesThatAreNotGiven()
  {
    var user = User.Create(Now, "a@example.com", googleSubject: null, displayName: "A", pictureUrl: "https://pic/a");
    user.GoogleSubject.ShouldBeNull();

    user.SignIn(Now.AddDays(1), "A@example.com", "sub-a", null, null);

    user.GoogleSubject.ShouldBe("sub-a");
    user.DisplayName.ShouldBe("A");
    user.PictureUrl.ShouldBe("https://pic/a");
    user.LastSignedInAt.ShouldBe(Now.AddDays(1).ToUniversalTime());
  }

  [Fact]
  public void SignIn_WithAnotherSubject_Throws()
  {
    var user = User.Create(Now, "a@example.com", "sub-a");

    Should.Throw<InvalidOperationException>(() => user.SignIn(Now, "a@example.com", "sub-b"));
  }

  [Theory]
  [InlineData("")]
  [InlineData("   ")]
  public void NormalizeEmail_RejectsBlank(string email) => Should.Throw<ArgumentException>(() => User.NormalizeEmail(email));

  [Fact]
  public void LegacyOwnerId_IsFixed() => User.LegacyOwnerId.ShouldBe(new Guid("11111111-1111-1111-1111-111111111111"));
}
