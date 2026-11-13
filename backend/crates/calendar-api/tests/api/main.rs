//! The API tests against a real PostgreSQL (Testcontainers, through `calendar-testing`). One test binary, so
//! every test shares one container and the tests run in parallel threads; `common` is the harness. Add a module
//! here instead of a new file beside `main.rs`. Needs Docker.

mod common;

mod agenda_agreement;
mod agenda_bucketing;
mod agenda_endpoints;
mod agenda_order;
mod authentication;
mod contract;
mod events;
mod google_sign_in;
mod health;
mod hosting;
mod ownership;
mod session_and_seed;
mod session_keys;
mod sign_in;
mod smoke;
mod tasks;
mod telemetry;
mod week_agenda_agreement;
mod week_agenda_endpoints;
