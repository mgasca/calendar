# Container image recipes (`just image <recipe>`), for the Dockerfile at the repo root.

set shell := ["bash", "-euo", "pipefail", "-c"]

import 'just/run.just'

# List this module's recipes
[default]
[private]
list:
    @just --list image

# Build calendar:local and calendar:<git-sha> using the pinned Node major
build:
    docker build --build-arg NODE_VERSION=$(cat frontend/.node-version) -t calendar:local -t calendar:$(git rev-parse --short HEAD) .

# Run on host port 8080 using local Postgres and .env (image_env defaults to Production)
start image_env="Production":
    #!/usr/bin/env bash
    set -euo pipefail
    export ConnectionStrings__Calendar="Host=127.0.0.1;Port=5432;Database=${POSTGRES_DB};Username=calendar_app;Password=${CALENDAR_APP_PASSWORD}"
    export ASPNETCORE_ENVIRONMENT="{{ image_env }}"
    docker run --rm --network host --env-file .env -e ConnectionStrings__Calendar -e ASPNETCORE_ENVIRONMENT calendar:local

# Check a running image at localhost:8080 (or BASE_URL)
smoke:
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
