//! Test support shared by the backend's test suites (ports `Calendar.Testing`): one throwaway PostgreSQL
//! container per test process, running the image pinned in `compose.yaml` and initialised by the same role
//! script as local development, with the migrations applied by the real migrator. Each test takes a database of
//! its own, cloned from a template, so tests that write can run in parallel. Needs Docker and the `docker` CLI.

pub mod repo_files;

mod container;
mod postgres;
mod readiness;

pub use container::{free_port, publishable_ports, start_postgres};
pub use postgres::{MAX_DATABASES, MIGRATED_DATABASE, TestDatabase};
pub use readiness::{CONTAINER_READY_WITHIN, LastAttempt, NotAccepting, is_not_ready_yet, wait_until_accepting};
