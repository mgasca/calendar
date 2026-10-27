using Calendar.Domain.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Calendar.Infrastructure.Configurations;

internal sealed class TodoTaskConfiguration : IEntityTypeConfiguration<TodoTask>
{
  public void Configure(EntityTypeBuilder<TodoTask> builder)
  {
    builder.ToTable("tasks", table =>
    {
      table.HasCheckConstraint("ck_tasks_title_not_blank", "length(btrim(title)) > 0");
      table.HasCheckConstraint("ck_tasks_due_date_xor_due_at", "due_date IS NULL OR due_at IS NULL");
    });

    builder.HasKey(t => t.Id);
    builder.Property(t => t.Id).ValueGeneratedNever();

    builder.Property(t => t.Title).HasMaxLength(200).IsRequired();
    builder.Property(t => t.DueDate).HasColumnType("date");

    // Partial indexes: undated tasks never match the agenda's due-date predicates.
    builder.HasIndex(t => t.DueDate).HasDatabaseName("ix_tasks_due_date").HasFilter("due_date IS NOT NULL");
    builder.HasIndex(t => t.DueAt).HasDatabaseName("ix_tasks_due_at").HasFilter("due_at IS NOT NULL");
    builder.HasIndex(t => t.CompletedAt).HasDatabaseName("ix_tasks_completed_at").HasFilter("completed_at IS NOT NULL");

    builder.Property<uint>("xmin").HasColumnType("xid").ValueGeneratedOnAddOrUpdate().IsConcurrencyToken();
  }
}
