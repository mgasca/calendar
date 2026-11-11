# Rust backend recipes (`just backend <recipe>`). They run in backend/, the Cargo workspace, so
# backend/rust-toolchain.toml (toolchain pin) and backend/Cargo.lock apply.

set shell := ["bash", "-euo", "pipefail", "-c"]

import '../just/run.just'

# List this module's recipes
[default]
[private]
list:
    @just --list backend

# Download the locked crates; arguments go to cargo fetch (e.g. just backend restore --target x86_64-unknown-linux-gnu)
[positional-arguments]
restore *args:
    cargo fetch --locked "$@"

# Build the workspace, tests included
build:
    cargo build --workspace --all-targets --locked

# Run the tests; arguments go to cargo test (e.g. just backend test -p calendar-domain day_window, or -- --nocapture)
[positional-arguments]
test *args:
    cargo test --locked "$@"

# Clippy with warnings as errors, and the formatting check
lint:
    cargo clippy --workspace --all-targets --locked -- -D warnings
    cargo fmt --all --check

# Auto-format the backend
format:
    cargo fmt --all

# Run the API on http://localhost:5041 in Development (.env is loaded by the root justfile)
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -f "{{ justfile_directory() }}/.env" ]; then echo "No .env found: copy .env.example to .env"; fi
    if [ -z "${Auth__Google__ClientId:-}" ] || [ -z "${Auth__Google__ClientSecret:-}" ]; then
        echo "Warning: Auth__Google__ClientId/ClientSecret are not set in .env, so 'Sign in with Google' will return 503 (see backend/README.md, 'Google sign-in setup')."
    fi
    export ASPNETCORE_ENVIRONMENT="${ASPNETCORE_ENVIRONMENT:-Development}"
    # The local database as calendar_app, from the passwords in .env, unless the connection string is already set.
    if [ -z "${ConnectionStrings__Calendar:-}" ] && [ -n "${CALENDAR_APP_PASSWORD:-}" ]; then
        export ConnectionStrings__Calendar="Host=127.0.0.1;Port=5432;Database=${POSTGRES_DB:-calendar};Username=calendar_app;Password=${CALENDAR_APP_PASSWORD}"
    fi
    cargo run --locked -p calendar-api

# Regenerate contracts/openapi.json from the API's routes and types (part of just contracts)
contract:
    cargo run --locked -p calendar-api -- --openapi ../contracts/openapi.json

# Remove Cargo build outputs
clean:
    cargo clean
