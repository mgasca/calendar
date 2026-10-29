using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Calendar.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class OpenTaskDueIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "ix_tasks_open_due_at",
                table: "tasks",
                column: "due_at",
                filter: "due_at IS NOT NULL AND completed_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_tasks_open_due_date",
                table: "tasks",
                column: "due_date",
                filter: "due_date IS NOT NULL AND completed_at IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_tasks_open_due_at",
                table: "tasks");

            migrationBuilder.DropIndex(
                name: "ix_tasks_open_due_date",
                table: "tasks");
        }
    }
}
