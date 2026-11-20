# Top-level task runner (ADR-0038). Each language keeps its native tooling; these recipes just orchestrate.
# Run `just` to list the recipes. The minimum `just` version is in .just-version.
# The root holds the recipes that span stacks; the rest live in modules: `just <module> <recipe>`.
# A module does not inherit settings, so each module file sets its own shell (ADR-0038 amendment).

# .env is loaded for every recipe, including module recipes, when it exists (see .env.example).
set dotenv-load
set shell := ["bash", "-euo", "pipefail", "-c"]

# Rust backend (Cargo workspace), run in backend/ so backend/rust-toolchain.toml applies
mod backend

# Rune UI (its own Cargo workspace, ADR-0067), run in native/ so native/rust-toolchain.toml applies
mod native

# pnpm workspace, run in frontend/
mod frontend

# Documentation site (ADRs, stories, architecture, runbooks, benchmarks)
mod docs 'frontend/apps/docs'

# Local PostgreSQL, and the opt-in otel-stack and stub sign-in services, through Docker Compose (ADR-0063)
mod db

# Throwaway end-to-end stacks, one Compose project per run (ADR-0063)
mod e2e

# Container image
mod image

# Azure infrastructure (ADR-0033)
mod infra

# Repo tooling: TypeScript on Deno and the doctor script (ADR-0058)
mod tools

# List recipes
default:
    @just --list --list-submodules

# Check the toolchain (pass --infra to also check Azure CLI and Bicep)
[positional-arguments]
doctor *args:
    @./tools/doctor/doctor.sh "$@"

# Fetch the backend crates, install frontend dependencies, configure git blame
setup: doctor && backend::restore frontend::install
    git config blame.ignoreRevsFile .git-blame-ignore-revs

# Build backend and frontend
build: backend::build frontend::build native::build

# Run all tests
test: backend::test frontend::test native::test

# Static analysis (clippy and rustfmt for the backend, ESLint and tsc for the frontend, then the repo tooling checks)
[parallel]
lint: backend::lint frontend::lint frontend::typecheck native::lint && tools::test tools::versions tools::adr (tools::narratives "--check") docs::architecture

# Auto-format all code
format: backend::format tools::format frontend::format native::format

# Regenerate OpenAPI contract and TypeScript client
contracts: backend::contract frontend::generate native::generate

# Everything CI runs
check: lint test

# Run only the checks of the CI jobs this branch's changes select (--dry-run, --base REF, --fail-fast, --image)
[positional-arguments]
changed *args:
    @deno run --config tools/deno.json --frozen --no-prompt --allow-read --allow-run=git,jq,just,pnpm tools/changed/changed.ts "$@"

# Remove build outputs
clean: backend::clean frontend::clean native::clean
