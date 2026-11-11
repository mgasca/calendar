//! The Calendar HTTP API on axum (ports `Calendar.Api`).
//!
//! [`app::build`] turns [`config::Settings`] and a few injectable collaborators ([`clock::Clock`], the Google
//! endpoints, a test-only [`auth::Authenticator`]) into a [`axum::Router`]. The HTTP contract is the one of the
//! .NET API it replaces: `contracts/openapi.json` is generated from [`openapi`], and paths, status codes, JSON
//! shapes, problem-details bodies and validation messages are kept as they were.

#![allow(
  clippy::doc_markdown,
  reason = "names such as OpenAPI, OpenID and PostgreSQL are prose here, not code"
)]

pub mod app;
pub mod auth;
pub mod clock;
pub mod config;
pub mod contracts;
pub mod endpoints;
pub mod error;
pub mod hosting;
pub mod json;
pub mod openapi;
pub mod problem;
pub mod state;
pub mod text;
pub mod validation;
pub mod wire;
