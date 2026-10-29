using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NpgsqlTypes;

#nullable disable

namespace Calendar.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AllDayDateSpan : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_events_all_day_dates",
                table: "events");

            migrationBuilder.AddColumn<NpgsqlRange<DateOnly>>(
                name: "date_span",
                table: "events",
                type: "daterange",
                nullable: true,
                computedColumnSql: "CASE WHEN is_all_day THEN daterange(start_date, end_date, '[)') END",
                stored: true);

            migrationBuilder.CreateIndex(
                name: "ix_events_date_span",
                table: "events",
                column: "date_span",
                filter: "is_all_day")
                .Annotation("Npgsql:IndexMethod", "gist");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_events_date_span",
                table: "events");

            migrationBuilder.DropColumn(
                name: "date_span",
                table: "events");

            migrationBuilder.CreateIndex(
                name: "ix_events_all_day_dates",
                table: "events",
                columns: new[] { "start_date", "end_date" },
                filter: "is_all_day");
        }
    }
}
