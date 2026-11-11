//! Tests against a real PostgreSQL (Testcontainers, through `calendar-testing`). One test binary, so the whole
//! suite shares one container. Needs Docker.

mod agenda_agreement;
mod agenda_read;
mod database_roles;
mod events_repository;
mod migrations;
mod ownership;
mod ownership_migration;
mod repositories;
mod schema_constraints;
mod schema_definition;
mod session_key;
mod support;
mod task_list;
mod tasks_repository;
mod tls;
mod user_directory;
