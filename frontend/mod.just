# Frontend recipes for the pnpm workspace (`just frontend <recipe>`). They run in frontend/.

set shell := ["bash", "-euo", "pipefail", "-c"]

import '../just/run.just'

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

# Run the web UI signed in without Google: the /api proxy adds Auth__DevSeedKey from .env (story 0021)
dev-signed-in:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -z "${Auth__AllowedEmails__0:-}" ]; then
        echo "Warning: Auth__AllowedEmails__0 is not set in .env, so the API will reject the seed key (401). Set it and restart the API."
    fi
    echo "Dev sign-in: the browser is signed in as Auth__AllowedEmails__0 while this runs. The API must run in Development (just backend dev). Sign out does not end it: stop this recipe."
    CALENDAR_DEV_SIGN_IN=true pnpm dev

# Regenerate the TypeScript client from contracts/openapi.json (part of just contracts)
generate:
    pnpm --filter @calendar/api-client generate

# Remove build outputs
clean:
    find . -name dist -type d -prune -not -path '*/node_modules/*' -exec rm -rf {} +
