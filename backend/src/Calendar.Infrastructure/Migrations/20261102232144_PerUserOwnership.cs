using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Calendar.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class PerUserOwnership : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ADR-0041. Order matters: the users table and its legacy placeholder must exist before owner_id can
            // reference them, and every existing event and task is backfilled to the placeholder through the
            // column default. The default stays: migrations run before the new revision starts, and a row the
            // previous revision still creates in that window lands on the legacy owner too. The app always
            // names the owner.
            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    google_subject = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: true),
                    display_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    picture_url = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_signed_in_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_users", x => x.id);
                    table.CheckConstraint("ck_users_email_lower", "email IS NULL OR email = lower(email)");
                });

            migrationBuilder.CreateIndex(
                name: "ix_users_email",
                table: "users",
                column: "email",
                unique: true,
                filter: "email IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_users_google_subject",
                table: "users",
                column: "google_subject",
                unique: true,
                filter: "google_subject IS NOT NULL");

            // The legacy owner (User.LegacyOwnerId): no subject and no email until the first allow-listed email
            // signs in (or seeds) and claims it.
            migrationBuilder.Sql(
                "INSERT INTO users (id, created_at) VALUES ('11111111-1111-1111-1111-111111111111', now());");

            migrationBuilder.AddColumn<Guid>(
                name: "owner_id",
                table: "events",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("11111111-1111-1111-1111-111111111111"));

            migrationBuilder.AddColumn<Guid>(
                name: "owner_id",
                table: "tasks",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("11111111-1111-1111-1111-111111111111"));

            migrationBuilder.AddForeignKey(
                name: "fk_events_owner",
                table: "events",
                column: "owner_id",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "fk_tasks_owner",
                table: "tasks",
                column: "owner_id",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.CreateIndex(
                name: "ix_events_owner_id",
                table: "events",
                column: "owner_id");

            // The task indexes the agenda and task-list queries use now lead with the owner.
            migrationBuilder.DropIndex(
                name: "ix_tasks_completed_at",
                table: "tasks");

            migrationBuilder.DropIndex(
                name: "ix_tasks_due_at",
                table: "tasks");

            migrationBuilder.DropIndex(
                name: "ix_tasks_due_date",
                table: "tasks");

            migrationBuilder.DropIndex(
                name: "ix_tasks_open_due_at",
                table: "tasks");

            migrationBuilder.DropIndex(
                name: "ix_tasks_open_due_date",
                table: "tasks");

            migrationBuilder.CreateIndex(
                name: "ix_tasks_completed_at",
                table: "tasks",
                columns: new[] { "owner_id", "completed_at" },
                filter: "completed_at IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_tasks_due_at",
                table: "tasks",
                columns: new[] { "owner_id", "due_at" },
                filter: "due_at IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_tasks_due_date",
                table: "tasks",
                columns: new[] { "owner_id", "due_date" },
                filter: "due_date IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_tasks_open_due_at",
                table: "tasks",
                columns: new[] { "owner_id", "due_at" },
                filter: "due_at IS NOT NULL AND completed_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_tasks_open_due_date",
                table: "tasks",
                columns: new[] { "owner_id", "due_date" },
                filter: "due_date IS NOT NULL AND completed_at IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_events_owner",
                table: "events");

            migrationBuilder.DropForeignKey(
                name: "fk_tasks_owner",
                table: "tasks");

            migrationBuilder.DropTable(
                name: "users");

            migrationBuilder.DropIndex(
                name: "ix_tasks_completed_at",
                table: "tasks");

            migrationBuilder.DropIndex(
                name: "ix_tasks_due_at",
                table: "tasks");

            migrationBuilder.DropIndex(
                name: "ix_tasks_due_date",
                table: "tasks");

            migrationBuilder.DropIndex(
                name: "ix_tasks_open_due_at",
                table: "tasks");

            migrationBuilder.DropIndex(
                name: "ix_tasks_open_due_date",
                table: "tasks");

            migrationBuilder.DropIndex(
                name: "ix_events_owner_id",
                table: "events");

            migrationBuilder.DropColumn(
                name: "owner_id",
                table: "tasks");

            migrationBuilder.DropColumn(
                name: "owner_id",
                table: "events");

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
    }
}
