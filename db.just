# Local PostgreSQL recipes (`just db <recipe>`), through Docker Compose (ADR-0016).
# Migrations are applied only by `just db migrate`, as calendar_migrator (ADR-0015).

set shell := ["bash", "-euo", "pipefail", "-c"]

import 'just/run.just'

# List this module's recipes
[default]
[private]
list:
    @just --list db

# Start the local PostgreSQL (creates .env from .env.example on first run)
up:
    #!/usr/bin/env bash
    set -euo pipefail
    test -f docker/postgres/init/01-roles.sh || {
        echo "docker/postgres/init/01-roles.sh is missing: the working tree is incomplete (check 'git status', then 'git pull')." >&2
        exit 1
    }
    test -f .env || { cp .env.example .env && echo "Created .env from .env.example"; }
    docker compose up -d --wait postgres

# Stop the local PostgreSQL (keeps data)
down:
    docker compose down

# Delete the local database volume and start a fresh PostgreSQL (migrate afterwards)
reset: && up
    docker compose down --volumes

# Apply the migrations to the local database as calendar_migrator (the calendar-migrate binary)
migrate:
    #!/usr/bin/env bash
    set -euo pipefail
    cd backend
    export CALENDAR_MIGRATOR_CONNECTION="Host=127.0.0.1;Port=5432;Database=${POSTGRES_DB};Username=calendar_migrator;Password=${CALENDAR_MIGRATOR_PASSWORD}"
    cargo run --locked --quiet -p calendar-migrate

# Seed a running API with a sample day (e.g. just db seed --date 2026-01-01 --time-zone UTC --api-url URL; additive)
[positional-arguments]
seed *args:
    dotnet run tools/seed-dev/seed-dev.cs -- "$@"

# Open psql on the local database as calendar_migrator
psql:
    docker compose exec -e PGPASSWORD="$CALENDAR_MIGRATOR_PASSWORD" postgres psql -U calendar_migrator -d "$POSTGRES_DB"
