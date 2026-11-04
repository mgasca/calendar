# Documentation site recipes (`just docs <recipe>`). They run in frontend/apps/docs.

set shell := ["bash", "-euo", "pipefail", "-c"]

# List this module's recipes
[default]
[private]
list:
    @just --list docs

# Run the documentation site on http://localhost:4321
dev:
    pnpm dev

# Build and verify the static documentation site (optional DOCS_SITE_URL for hosting URL)
build:
    pnpm build
    pnpm verify:build

# Preview the built documentation site locally
preview:
    pnpm preview

# Benchmark ADR/story loading (run by hand; record results in docs/benchmarks/)
bench:
    pnpm bench

# Run the docs-site tests; arguments go to Vitest in place of `src` (e.g. just docs test src/lib/adr.test.ts)
test *args:
    pnpm exec vitest run {{ if args == "" { "src" } else { args } }}

# Validate the CALM architecture model in docs/architecture against the CALM schema (ADR-0039)
architecture:
    pnpm validate:architecture
