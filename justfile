# Top-level task runner (ADR-0038). Each language keeps its native tooling; these recipes just orchestrate.
# Run `just` to list the recipes. The minimum `just` version is in .just-version.

# .env is loaded for every recipe when it exists (see .env.example).
set dotenv-load
set shell := ["bash", "-euo", "pipefail", "-c"]

backend := "backend"
frontend := "frontend"
pnpm := "pnpm --dir " + frontend
# Run dotnet inside backend/ so backend/global.json (SDK pin, test runner) applies.
dotnet := "cd " + backend + " && dotnet"
# Repo tooling: .NET file-based apps kept in their skill folder or tools/<name>/ (ADR-0017).
adr_skill := ".claude/skills/adr-draft"
tool_dirs := adr_skill + " tools"
shell_tools := "tools/doctor/doctor.sh"

# List recipes
default:
    @just --list

# Check the toolchain (pass --infra to also check Azure CLI and Bicep)
doctor *args:
    @./tools/doctor/doctor.sh {{ args }}

# Restore .NET packages, install frontend dependencies, configure git blame
setup: doctor
    git config blame.ignoreRevsFile .git-blame-ignore-revs
    {{ dotnet }} restore
    {{ pnpm }} install --frozen-lockfile

# Build backend and frontend
build:
    {{ dotnet }} build --no-restore
    {{ pnpm }} build

# Run all tests
test:
    {{ dotnet }} test
    {{ pnpm }} test

# Static analysis (analyzers run as part of the .NET build)
lint: && tooling tool-versions adr-check
    {{ dotnet }} build --no-restore
    {{ dotnet }} format --verify-no-changes --no-restore
    {{ dotnet }} tool restore
    {{ dotnet }} ef migrations has-pending-model-changes --project src/Calendar.Infrastructure --no-build
    {{ pnpm }} lint
    {{ pnpm }} typecheck

# Test and lint repo tooling (skill scripts, tools/)
tooling:
    #!/usr/bin/env bash
    set -euo pipefail
    for t in $(find {{ tool_dirs }} -name '*.tests.cs' -not -path '*/fixtures/*' | sort); do
        echo "dotnet run $t"
        dotnet run "$t"
    done
    for d in {{ tool_dirs }}; do
        echo "dotnet format whitespace $d"
        dotnet format whitespace --folder --verify-no-changes "$d"
    done
    if command -v shellcheck >/dev/null 2>&1; then
        echo "shellcheck {{ shell_tools }}"
        shellcheck {{ shell_tools }}
    elif [ -n "${CI:-}" ]; then
        echo "shellcheck is required in CI" >&2
        exit 1
    else
        echo "shellcheck not installed: skipped locally (CI runs it)"
    fi

# Check the Azure role SQL against a real PostgreSQL (needs Docker)
infra-integration:
    dotnet run tools/infra/integration/database.cs

# Check tooling package pins match backend/Directory.Packages.props (--fix to update)
tool-versions *args:
    dotnet run tools/tool-versions/tool-versions.cs -- {{ args }}

# Validate ADRs in docs/decisions (e.g. just adr-check --fix-links)
adr-check *args:
    dotnet run {{ adr_skill }}/scripts/check-adr/check-adr.cs -- {{ args }}

# Start the local PostgreSQL (creates .env from .env.example on first run)
db-up:
    #!/usr/bin/env bash
    set -euo pipefail
    test -f docker/postgres/init/01-roles.sh || {
        echo "docker/postgres/init/01-roles.sh is missing: the working tree is incomplete (check 'git status', then 'git pull')." >&2
        exit 1
    }
    test -f .env || { cp .env.example .env && echo "Created .env from .env.example"; }
    docker compose up -d --wait postgres

# Stop the local PostgreSQL (keeps data)
db-down:
    docker compose down

# Delete the local database volume and start a fresh PostgreSQL (migrate afterwards)
db-reset: && db-up
    docker compose down --volumes

# Apply EF Core migrations to the local database as calendar_migrator
db-migrate:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ backend }}
    dotnet tool restore >/dev/null
    export CALENDAR_MIGRATOR_CONNECTION="Host=127.0.0.1;Port=5432;Database=${POSTGRES_DB};Username=calendar_migrator;Password=${CALENDAR_MIGRATOR_PASSWORD}"
    dotnet ef database update --project src/Calendar.Infrastructure

# Seed a running API with a sample day (e.g. just db-seed --date 2026-01-01 --time-zone UTC --api-url URL; additive)
db-seed *args:
    dotnet run tools/seed-dev/seed-dev.cs -- {{ args }}

# Open psql on the local database as calendar_migrator
db-psql:
    docker compose exec -e PGPASSWORD="$CALENDAR_MIGRATOR_PASSWORD" postgres psql -U calendar_migrator -d "$POSTGRES_DB"

# Auto-format all code
format:
    {{ dotnet }} format
    for d in {{ tool_dirs }}; do dotnet format whitespace --folder "$d"; done
    {{ pnpm }} format

# Regenerate OpenAPI contract and TypeScript client
contracts:
    {{ dotnet }} build src/Calendar.Api
    {{ pnpm }} --filter @calendar/api-client generate

# Everything CI runs
check: lint test

# Run the API on http://localhost:5041 (.env is loaded by dotenv-load)
dev-api:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -f .env ]; then echo "No .env found: copy .env.example to .env"; fi
    if [ -z "${Auth__Google__ClientId:-}" ] || [ -z "${Auth__Google__ClientSecret:-}" ]; then
        echo "Warning: Auth__Google__ClientId/ClientSecret are not set in .env, so 'Sign in with Google' will return 503 (see README)."
    fi
    cd {{ backend }}
    dotnet watch --project src/Calendar.Api

# Run the web UI (proxies /api to the API)
dev-web:
    {{ pnpm }} dev

# Run the documentation site (ADRs and stories) on http://localhost:4321
dev-docs:
    {{ pnpm }} --filter @calendar/docs dev

# Build and verify the static documentation site (optional DOCS_SITE_URL for hosting URL)
build-docs:
    {{ pnpm }} --filter @calendar/docs build
    {{ pnpm }} --filter @calendar/docs verify:build

# Preview the built documentation site locally
preview-docs:
    {{ pnpm }} --filter @calendar/docs preview

# Benchmark ADR/story loading (run by hand; record results in docs/benchmarks/)
bench-docs:
    {{ pnpm }} --filter @calendar/docs bench

# Remove build outputs
clean:
    {{ dotnet }} clean
    find {{ frontend }} -name dist -type d -prune -not -path '*/node_modules/*' -exec rm -rf {} +

# Build calendar:local and calendar:<git-sha> using the pinned Node major
image:
    docker build --build-arg NODE_VERSION=$(cat frontend/.node-version) -t calendar:local -t calendar:$(git rev-parse --short HEAD) .

# Run on host port 8080 using local Postgres and .env (image_env defaults to Production)
run-image image_env="Production":
    #!/usr/bin/env bash
    set -euo pipefail
    export ConnectionStrings__Calendar="Host=127.0.0.1;Port=5432;Database=${POSTGRES_DB};Username=calendar_app;Password=${CALENDAR_APP_PASSWORD}"
    export ASPNETCORE_ENVIRONMENT="{{ image_env }}"
    docker run --rm --network host --env-file .env -e ConnectionStrings__Calendar -e ASPNETCORE_ENVIRONMENT calendar:local

# Check a running image at localhost:8080 (or BASE_URL)
smoke-image:
    #!/usr/bin/env bash
    set -euo pipefail
    base="${BASE_URL:-http://localhost:8080}"
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    for route in / /week /api/health /api/unknown /api/tasks; do
        code=$(curl -sS -o "$tmp/body" -w '%{http_code}' "$base$route")
        case "$route:$code" in
            /:200) grep -qi '<!doctype html' "$tmp/body" && cp "$tmp/body" "$tmp/index" || exit 1 ;;
            /week:200) cmp -s "$tmp/index" "$tmp/body" || exit 1 ;;
            /api/health:200 | /api/unknown:404 | /api/tasks:401) ;;
            *) echo "Unexpected response $code for $route" >&2; exit 1 ;;
        esac
        echo "$route: $code"
    done

# Preview infrastructure (env: staging|production; phase: foundation|full; e.g. just infra-what-if staging full --allow-ip CIDR)
infra-what-if env phase="full" *args:
    @./tools/doctor/doctor.sh --infra
    dotnet run tools/infra/infra.cs -- what-if {{ env }} --phase {{ phase }} {{ args }}

# Deploy infrastructure (env: staging|production; phase: foundation|full; e.g. just infra-deploy staging full --allow-ip CIDR)
infra-deploy env phase="full" *args:
    @./tools/doctor/doctor.sh --infra
    dotnet run tools/infra/infra.cs -- deploy {{ env }} --phase {{ phase }} {{ args }}

# Owner creates the Postgres password (env: staging|production)
infra-secret-init env:
    @./tools/doctor/doctor.sh --infra
    dotnet run tools/infra/infra.cs -- secret init-postgres-password {{ env }}

# Stop staging PostgreSQL
infra-db-stop:
    @./tools/doctor/doctor.sh --infra
    dotnet run tools/infra/infra.cs -- db stop staging

# Start staging PostgreSQL
infra-db-start:
    @./tools/doctor/doctor.sh --infra
    dotnet run tools/infra/infra.cs -- db start staging

# Initialize database roles (env: staging|production; e.g. just infra-init-roles staging --client-ip IPv4)
infra-init-roles env *args:
    dotnet run tools/infra/infra.cs -- db init-roles {{ env }} {{ args }}

# Apply database migrations (env: staging|production; e.g. just infra-migrate staging --client-ip IPv4)
infra-migrate env *args:
    dotnet run tools/infra/infra.cs -- migrate {{ env }} {{ args }}
