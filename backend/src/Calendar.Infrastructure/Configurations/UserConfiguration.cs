using Calendar.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Calendar.Infrastructure.Configurations;

internal sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
  public void Configure(EntityTypeBuilder<User> builder)
  {
    builder.ToTable("users", table =>
    {
      // Lookups and the unique index compare lower-cased emails; the domain normalizes, the database insists.
      table.HasCheckConstraint("ck_users_email_lower", "email IS NULL OR email = lower(email)");
    });

    builder.HasKey(u => u.Id);
    builder.Property(u => u.Id).ValueGeneratedNever();

    // Google documents sub as at most 255 case-sensitive ASCII characters.
    builder.Property(u => u.GoogleSubject).HasMaxLength(255);
    builder.Property(u => u.Email).HasMaxLength(320);
    builder.Property(u => u.DisplayName).HasMaxLength(200);
    builder.Property(u => u.PictureUrl).HasMaxLength(2048);

    builder.HasIndex(u => u.GoogleSubject).IsUnique().HasDatabaseName("ix_users_google_subject").HasFilter("google_subject IS NOT NULL");
    builder.HasIndex(u => u.Email).IsUnique().HasDatabaseName("ix_users_email").HasFilter("email IS NOT NULL");

    builder.Ignore(u => u.IsUnclaimedPlaceholder);
  }
}
