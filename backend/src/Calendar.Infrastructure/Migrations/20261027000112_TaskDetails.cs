using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Calendar.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class TaskDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "notes",
                table: "tasks",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "priority",
                table: "tasks",
                type: "character varying(6)",
                maxLength: 6,
                nullable: false,
                defaultValue: "medium");

            migrationBuilder.AddCheckConstraint(
                name: "ck_tasks_priority",
                table: "tasks",
                sql: "priority IN ('low', 'medium', 'high')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_tasks_priority",
                table: "tasks");

            migrationBuilder.DropColumn(
                name: "notes",
                table: "tasks");

            migrationBuilder.DropColumn(
                name: "priority",
                table: "tasks");
        }
    }
}
