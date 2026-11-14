# Azure infrastructure recipes (`just infra <recipe>`), wrapping tools/infra/infra.ts (ADR-0033).
# They run at the repo root, where the tool's paths are relative to.

set shell := ["bash", "-euo", "pipefail", "-c"]
set working-directory := '..'

import '../just/run.just'

# List this module's recipes
[default]
[private]
list:
    @just --list infra

# Preview infrastructure (env: staging|production; phase: foundation|full; e.g. just infra what-if staging full --allow-ip CIDR)
[positional-arguments]
what-if env phase="full" *args:
    @./tools/doctor/doctor.sh --infra
    deno run --config tools/deno.json --frozen --no-prompt --allow-read --allow-write --allow-run --allow-env --allow-net --allow-sys tools/infra/infra.ts what-if "$1" --phase "$2" "${@:3}"

# Deploy infrastructure (env: staging|production; phase: foundation|full; e.g. just infra deploy staging full --allow-ip CIDR)
[positional-arguments]
deploy env phase="full" *args:
    @./tools/doctor/doctor.sh --infra
    deno run --config tools/deno.json --frozen --no-prompt --allow-read --allow-write --allow-run --allow-env --allow-net --allow-sys tools/infra/infra.ts deploy "$1" --phase "$2" "${@:3}"

# Owner creates the Postgres password (env: staging|production)
secret-init env:
    @./tools/doctor/doctor.sh --infra
    deno run --config tools/deno.json --frozen --no-prompt --allow-read --allow-write --allow-run --allow-env --allow-net --allow-sys tools/infra/infra.ts secret init-postgres-password {{ env }}

# Stop staging PostgreSQL
db-stop:
    @./tools/doctor/doctor.sh --infra
    deno run --config tools/deno.json --frozen --no-prompt --allow-read --allow-write --allow-run --allow-env --allow-net --allow-sys tools/infra/infra.ts db stop staging

# Start staging PostgreSQL
db-start:
    @./tools/doctor/doctor.sh --infra
    deno run --config tools/deno.json --frozen --no-prompt --allow-read --allow-write --allow-run --allow-env --allow-net --allow-sys tools/infra/infra.ts db start staging

# Initialize database roles (env: staging|production; e.g. just infra init-roles staging --client-ip IPv4)
[positional-arguments]
init-roles env *args:
    deno run --config tools/deno.json --frozen --no-prompt --allow-read --allow-write --allow-run --allow-env --allow-net --allow-sys tools/infra/infra.ts db init-roles "$1" "${@:2}"

# Apply database migrations (env: staging|production; e.g. just infra migrate staging --client-ip IPv4)
[positional-arguments]
migrate env *args:
    deno run --config tools/deno.json --frozen --no-prompt --allow-read --allow-write --allow-run --allow-env --allow-net --allow-sys tools/infra/infra.ts migrate "$1" "${@:2}"

# Check the Azure role SQL against a real PostgreSQL (needs Docker)
integration:
    deno run --config tools/deno.json --frozen --no-prompt --allow-read --allow-env --allow-run=docker --allow-net=127.0.0.1 tools/infra/integration/database.ts
