using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NpgsqlTypes;

#nullable disable

namespace Calendar.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    location = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    notes = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    is_all_day = table.Column<bool>(type: "boolean", nullable: false),
                    starts_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ends_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    time_zone_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    start_date = table.Column<DateOnly>(type: "date", nullable: true),
                    end_date = table.Column<DateOnly>(type: "date", nullable: true),
                    span = table.Column<NpgsqlRange<DateTimeOffset>>(type: "tstzrange", nullable: true, computedColumnSql: "CASE WHEN is_all_day THEN NULL ELSE tstzrange(starts_at, ends_at, '[)') END", stored: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_events", x => x.id);
                    table.CheckConstraint("ck_events_shape", "(is_all_day AND start_date IS NOT NULL AND end_date IS NOT NULL AND end_date > start_date AND starts_at IS NULL AND ends_at IS NULL AND time_zone_id IS NULL) OR (NOT is_all_day AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at AND time_zone_id IS NOT NULL AND start_date IS NULL AND end_date IS NULL)");
                    table.CheckConstraint("ck_events_title_not_blank", "length(btrim(title)) > 0");
                });

            migrationBuilder.CreateTable(
                name: "tasks",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    due_date = table.Column<DateOnly>(type: "date", nullable: true),
                    due_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_tasks", x => x.id);
                    table.CheckConstraint("ck_tasks_due_date_xor_due_at", "due_date IS NULL OR due_at IS NULL");
                    table.CheckConstraint("ck_tasks_title_not_blank", "length(btrim(title)) > 0");
                });

            migrationBuilder.CreateIndex(
                name: "ix_events_all_day_dates",
                table: "events",
                columns: new[] { "start_date", "end_date" },
                filter: "is_all_day");

            migrationBuilder.CreateIndex(
                name: "ix_events_span",
                table: "events",
                column: "span")
                .Annotation("Npgsql:IndexMethod", "gist");

            migrationBuilder.CreateIndex(
                name: "ix_tasks_completed_at",
                table: "tasks",
                column: "completed_at",
                filter: "completed_at IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_tasks_due_at",
                table: "tasks",
                column: "due_at",
                filter: "due_at IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_tasks_due_date",
                table: "tasks",
                column: "due_date",
                filter: "due_date IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "events");

            migrationBuilder.DropTable(
                name: "tasks");
        }
    }
}
