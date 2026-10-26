using Calendar.Domain.Events;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NpgsqlTypes;

namespace Calendar.Infrastructure.Configurations;

internal sealed class CalendarEventConfiguration : IEntityTypeConfiguration<CalendarEvent>
{
    /// <summary>Shadow property: generated <c>tstzrange</c> of a timed event's span, <c>NULL</c> for all-day events.</summary>
    public const string SpanProperty = "Span";

    public void Configure(EntityTypeBuilder<CalendarEvent> builder)
    {
        builder.ToTable("events", table =>
        {
            table.HasCheckConstraint("ck_events_title_not_blank", "length(btrim(title)) > 0");
            table.HasCheckConstraint(
                "ck_events_shape",
                "(is_all_day AND start_date IS NOT NULL AND end_date IS NOT NULL AND end_date > start_date " +
                "AND starts_at IS NULL AND ends_at IS NULL AND time_zone_id IS NULL) " +
                "OR (NOT is_all_day AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at " +
                "AND time_zone_id IS NOT NULL AND start_date IS NULL AND end_date IS NULL)");
        });

        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).ValueGeneratedNever();

        builder.Property(e => e.Title).HasMaxLength(200).IsRequired();
        builder.Property(e => e.Location).HasMaxLength(200);
        builder.Property(e => e.Notes).HasMaxLength(4000);
        builder.Property(e => e.TimeZoneId).HasMaxLength(64);

        // "start"/"end" are awkward SQL words, so the instants are stored as starts_at/ends_at (timestamptz).
        builder.Property(e => e.Start).HasColumnName("starts_at");
        builder.Property(e => e.End).HasColumnName("ends_at");
        builder.Property(e => e.StartDate).HasColumnType("date");
        builder.Property(e => e.EndDate).HasColumnType("date");

        // ADR-0014/0015: a half-open tstzrange backs overlap queries through a GiST index. It is derived from
        // starts_at/ends_at by the database, so the domain model keeps plain instants and never sees Npgsql types.
        builder.Property<NpgsqlRange<DateTimeOffset>?>(SpanProperty)
            .HasColumnName("span")
            .HasColumnType("tstzrange")
            .HasComputedColumnSql("CASE WHEN is_all_day THEN NULL ELSE tstzrange(starts_at, ends_at, '[)') END", stored: true);
        builder.HasIndex(SpanProperty).HasDatabaseName("ix_events_span").HasMethod("gist");

        // All-day events: StartDate <= day < EndDate.
        builder.HasIndex(e => new { e.StartDate, e.EndDate }).HasDatabaseName("ix_events_all_day_dates").HasFilter("is_all_day");

        builder.Property<uint>("xmin").HasColumnType("xid").ValueGeneratedOnAddOrUpdate().IsConcurrencyToken();
    }
}
