# Top-level task runner (ADR-0038). Each language keeps its native tooling; these recipes just orchestrate.
# Run `just` to list the recipes. The minimum `just` version is in .just-version.
# The root holds the recipes that span stacks; the rest live in modules: `just <module> <recipe>`.
# A module does not inherit settings, so each module file sets its own shell (ADR-0038 amendment).

# .env is loaded for every recipe, including module recipes, when it exists (see .env.example).
set dotenv-load
set shell := ["bash", "-euo", "pipefail", "-c"]

# .NET backend, run in backend/ so backend/global.json applies
mod backend

# pnpm workspace, run in frontend/
mod frontend

# Documentation site (ADRs, stories, architecture, runbooks, benchmarks)
mod docs 'frontend/apps/docs'

# Local PostgreSQL through Docker Compose (ADR-0016)
mod db

# Container image
mod image

# Azure infrastructure (ADR-0033)
mod infra

# Repo tooling: .NET file-based apps and the doctor script (ADR-0017)
mod tools

# List recipes
default:
    @just --list --list-submodules

# Check the toolchain (pass --infra to also check Azure CLI and Bicep)
[positional-arguments]
doctor *args:
    @./tools/doctor/doctor.sh "$@"

# Restore .NET packages, install frontend dependencies, configure git blame
setup: doctor && backend::restore frontend::install
    git config blame.ignoreRevsFile .git-blame-ignore-revs

# Build backend and frontend
build: backend::build frontend::build

# Run all tests
test: backend::test frontend::test

# Static analysis (analyzers run as part of the .NET build)
[parallel]
lint: backend::lint frontend::lint frontend::typecheck && tools::test tools::versions tools::adr docs::architecture

# Auto-format all code
format: backend::format tools::format frontend::format

# Regenerate OpenAPI contract and TypeScript client
contracts: backend::contract frontend::generate

# Everything CI runs
check: lint test

# Remove build outputs
clean: backend::clean frontend::clean
