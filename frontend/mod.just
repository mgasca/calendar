# Frontend recipes for the pnpm workspace (`just frontend <recipe>`). They run in frontend/.

set shell := ["bash", "-euo", "pipefail", "-c"]

# List this module's recipes
[default]
[private]
list:
    @just --list frontend

# Install dependencies from the lockfile
install:
    pnpm install --frozen-lockfile

# Build every package
build:
    pnpm build

# Run every package's tests
test:
    pnpm test

# Run the web app's tests; arguments go to Vitest (e.g. just frontend test-web src/features/day)
test-web *args:
    pnpm --filter @calendar/web test {{ args }}

# Type-aware ESLint (can take minutes)
lint:
    pnpm lint

# Type-check every project (tsc -b)
typecheck:
    pnpm typecheck

# Auto-format the frontend
format:
    pnpm format

# Run the web UI (proxies /api to the API)
dev:
    pnpm dev

# Regenerate the TypeScript client from contracts/openapi.json (part of just contracts)
generate:
    pnpm --filter @calendar/api-client generate

# Remove build outputs
clean:
    find . -name dist -type d -prune -not -path '*/node_modules/*' -exec rm -rf {} +
