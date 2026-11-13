# Local PostgreSQL recipes (`just db <recipe>`), through Docker Compose (ADR-0063), plus the opt-in Grafana LGTM
# (`observability`) and stub sign-in (`sign-in-stub`) services, all in the shared `calendar` project.
# Migrations are applied only by `just db migrate`, as calendar_migrator (ADR-0052).
# For a throwaway stack that never touches this project, use `just e2e`.

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

# Start Grafana LGTM for local telemetry (http://127.0.0.1:3000) and print the API's OTLP settings
observability:
    #!/usr/bin/env bash
    set -euo pipefail
    test -f .env || { cp .env.example .env && echo "Created .env from .env.example"; }
    docker compose --profile observability up -d --wait --wait-timeout 300 lgtm
    echo "Grafana: http://127.0.0.1:${CALENDAR_GRAFANA_PORT:-3000} (admin/admin, loopback only)"
    echo "Run the API with:"
    echo "  OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:${CALENDAR_OTLP_HTTP_PORT:-4318} OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf"
    echo "and the web app with CALENDAR_OTLP_URL=http://127.0.0.1:${CALENDAR_OTLP_HTTP_PORT:-4318}"

# Start the stub sign-in provider standing in for Google (Development only) and print the API's settings
sign-in-stub:
    #!/usr/bin/env bash
    set -euo pipefail
    test -f .env || { cp .env.example .env && echo "Created .env from .env.example"; }
    docker compose --profile sign-in-stub up -d --wait --wait-timeout 120 oidc-stub
    issuer="http://127.0.0.1:${CALENDAR_OIDC_STUB_PORT:-8080}/google"
    echo "Run the API with ASPNETCORE_ENVIRONMENT=Development and (ADR-0064):"
    echo "  Auth__Google__ClientId=dev-client Auth__Google__ClientSecret=dev-client-secret"
    echo "  Auth__Google__AuthorizationEndpoint=$issuer/authorize Auth__Google__TokenEndpoint=$issuer/token"
    echo "  Auth__Google__UserInfoEndpoint=$issuer/userinfo Auth__Google__Issuer=$issuer"
    echo "The stub's sign-in page takes any username and the claims, e.g. {\"email\": \"you@example.com\", \"email_verified\": true}."

# Stop the local PostgreSQL and the opt-in services (keeps data)
down:
    docker compose --profile observability --profile sign-in-stub down

# Delete the local database volume and start a fresh PostgreSQL (migrate afterwards)
reset: && up
    docker compose --profile observability --profile sign-in-stub down --volumes

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
