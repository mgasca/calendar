# Documentation site recipes (`just docs <recipe>`). They run in frontend/apps/docs.

set shell := ["bash", "-euo", "pipefail", "-c"]

import '../../../just/run.just'

# List this module's recipes
[default]
[private]
list:
    @just --list docs

# Run the documentation site on http://localhost:4321
dev:
    pnpm dev

# Copy the dashboard-data branch's snapshots into .dashboard-data/ (git-ignored) for the delivery dashboard pages.
# No such branch is fine (the pages say "no snapshot yet"); any other failure stops the build. Keep in step with the
# "Read the dashboard data branch" step of the docs job in .github/workflows/ci.yml.
dashboard-data:
    #!/usr/bin/env bash
    set -euo pipefail
    rm -rf .dashboard-data
    status=0
    git ls-remote --exit-code --heads origin dashboard-data > /dev/null || status=$?
    if [ "$status" -eq 2 ]; then
        echo "No dashboard-data branch: the dashboard pages will say that no snapshot exists yet."
    elif [ "$status" -ne 0 ]; then
        echo "Could not read the dashboard-data branch (git exit $status)." >&2
        exit "$status"
    else
        git fetch --quiet --depth 1 origin dashboard-data
        if git cat-file -e FETCH_HEAD:snapshots 2> /dev/null; then
            mkdir -p .dashboard-data/snapshots
            git archive FETCH_HEAD:snapshots | tar -x -C .dashboard-data/snapshots
        fi
    fi

# Build and verify the static documentation site (optional DOCS_SITE_URL for hosting URL)
build: dashboard-data
    pnpm build
    pnpm verify:build

# Preview the built documentation site locally
preview:
    pnpm preview

# Benchmark ADR/story loading (run by hand; record results in docs/benchmarks/)
bench:
    pnpm bench

# Run the docs-site tests; arguments go to Vitest in place of `src` (e.g. just docs test src/lib/adr.test.ts)
[positional-arguments]
test *args:
    if (( $# )); then pnpm exec vitest run "$@"; else pnpm exec vitest run src; fi

# Validate the CALM architecture model in docs/architecture against the CALM schema (ADR-0039)
architecture:
    pnpm validate:architecture
