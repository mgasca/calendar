# Throwaway end-to-end stack recipes (`just e2e <recipe>`), ADR-0063. Each run is its own Compose project,
# calendar-e2e-<run-id>, with PostgreSQL, Grafana LGTM and the stub OpenID Connect provider from compose.yaml, plus
# the API and the built web app as processes. It never uses the shared `calendar` project, its volume or port 5432.
#
# Ports come from a slot k in 2, 3, 5, 6, 7, 8, 9 (the run-calendar agent stack's 55041, 55173 and 55432 sit in
# slots 0, 1 and 4): 55k00 + 17 OTLP gRPC, 18 OTLP HTTP, 20 Tempo, 30 Grafana, 31 Loki, 32 PostgreSQL, 41 API,
# 73 web, 80 stub, 90 Prometheus. The first slot whose ports are all free wins; CALENDAR_E2E_SLOT pins one.
# A run's state (ports, URLs, PIDs, logs) is in .plan/e2e/<project>/ (git-ignored); `just e2e env` prints it.

set shell := ["bash", "-euo", "pipefail", "-c"]

import 'just/run.just'

state_root := ".plan/e2e"

# List this module's recipes
[default]
[private]
list:
    @just --list e2e

# Start a new throwaway stack, wait until every service is healthy, and print its settings
up:
    #!/usr/bin/env bash
    set -euo pipefail
    test -f docker/postgres/init/01-roles.sh || { echo "docker/postgres/init is missing: the working tree is incomplete." >&2; exit 1; }
    project="calendar-e2e-$(date -u +%Y%m%d%H%M%S)-$(printf '%04x%04x' $RANDOM $RANDOM)"
    offsets=(17 18 20 30 31 32 41 73 80 90)
    in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
    slot=""
    for k in ${CALENDAR_E2E_SLOT:-2 3 5 6 7 8 9}; do
        case "$k" in 2|3|5|6|7|8|9) ;; *) echo "CALENDAR_E2E_SLOT must be one of 2 3 5 6 7 8 9, not '$k'." >&2; exit 1 ;; esac
        busy=""
        for o in "${offsets[@]}"; do if in_use $((55000 + 100 * k + o)); then busy=$((55000 + 100 * k + o)); break; fi; done
        if [[ -z $busy ]]; then slot=$k; break; fi
        echo "slot $k: port $busy is in use" >&2
    done
    [[ -n $slot ]] || { echo "No free end-to-end slot: stop a run with 'just e2e down <project>' (see 'just e2e ls')." >&2; exit 1; }
    base=$((55000 + 100 * slot))
    dir="{{ state_root }}/$project"
    mkdir -p "$dir/logs"
    dir=$(cd "$dir" && pwd)
    seed_key=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
    # The state file is written before anything starts, so `just e2e down` can clean up a run that failed half-way.
    cat > "$dir/stack.env" <<EOF
    CALENDAR_E2E_PROJECT=$project
    CALENDAR_E2E_SLOT=$slot
    CALENDAR_E2E_DIR=$dir
    CALENDAR_E2E_WEB_URL=http://127.0.0.1:$((base + 73))
    CALENDAR_E2E_API_URL=http://127.0.0.1:$((base + 41))
    CALENDAR_E2E_SEED_KEY=$seed_key
    CALENDAR_E2E_ALLOWED_EMAIL=e2e-user@example.com
    CALENDAR_E2E_POSTGRES_PORT=$((base + 32))
    CALENDAR_E2E_OTLP_HTTP_URL=http://127.0.0.1:$((base + 18))
    CALENDAR_E2E_OTLP_GRPC_URL=http://127.0.0.1:$((base + 17))
    CALENDAR_E2E_GRAFANA_URL=http://127.0.0.1:$((base + 30))
    CALENDAR_E2E_LOKI_URL=http://127.0.0.1:$((base + 31))
    CALENDAR_E2E_TEMPO_URL=http://127.0.0.1:$((base + 20))
    CALENDAR_E2E_PROMETHEUS_URL=http://127.0.0.1:$((base + 90))
    CALENDAR_E2E_OIDC_ISSUER=http://127.0.0.1:$((base + 80))/google
    CALENDAR_E2E_OIDC_CLIENT_ID=e2e-client
    CALENDAR_E2E_OIDC_CLIENT_SECRET=e2e-client-secret
    EOF
    sed -i 's/^ *//' "$dir/stack.env"
    source "$dir/stack.env"
    fail() { echo "error: $1. Logs: $dir/logs. Removing the run." >&2; {{ quote(just_executable()) }} --justfile {{ quote(justfile()) }} "{{ module_path() }}::down" "$project" >&2 || true; exit 1; }
    echo "Starting $project in slot $slot"

    # Throwaway credentials and this slot's ports; nothing comes from .env.
    export POSTGRES_DB=calendar POSTGRES_ADMIN_USER=postgres POSTGRES_ADMIN_PASSWORD=e2e-admin-password \
        CALENDAR_MIGRATOR_PASSWORD=e2e-migrator-password CALENDAR_APP_PASSWORD=e2e-app-password \
        CALENDAR_POSTGRES_RESTART=no CALENDAR_POSTGRES_PORT=$((base + 32)) \
        CALENDAR_OTLP_GRPC_PORT=$((base + 17)) CALENDAR_OTLP_HTTP_PORT=$((base + 18)) CALENDAR_TEMPO_PORT=$((base + 20)) \
        CALENDAR_GRAFANA_PORT=$((base + 30)) CALENDAR_LOKI_PORT=$((base + 31)) CALENDAR_PROMETHEUS_PORT=$((base + 90)) \
        CALENDAR_OIDC_STUB_PORT=$((base + 80))
    started=$(date +%s)
    docker compose -p "$project" --profile observability --profile sign-in-stub up -d --wait --wait-timeout 300 \
        > "$dir/logs/compose.log" 2>&1 || { cat "$dir/logs/compose.log" >&2; fail "the containers did not become healthy"; }
    echo "Containers healthy after $(( $(date +%s) - started )) s"

    (cd backend && CALENDAR_MIGRATOR_CONNECTION="Host=127.0.0.1;Port=$CALENDAR_E2E_POSTGRES_PORT;Database=calendar;Username=calendar_migrator;Password=e2e-migrator-password" \
        cargo run --locked --quiet -p calendar-migrate) > "$dir/logs/migrate.log" 2>&1 || fail "the migrations failed"
    (cd backend && cargo build --locked --quiet -p calendar-api) > "$dir/logs/api-build.log" 2>&1 || fail "the API did not build"
    (cd frontend/apps/web && VITE_OTEL_TRACES_EXPORTER=otlp corepack pnpm exec tsc -b \
        && VITE_OTEL_TRACES_EXPORTER=otlp corepack pnpm exec vite build --outDir "$dir/web" --emptyOutDir) \
        > "$dir/logs/web-build.log" 2>&1 || fail "the web app did not build"

    # The API runs as Development (seed key and the stub overrides need it) with a clean environment, so no
    # setting from .env or the shell (a real Google client, another seed key) reaches it. setsid gives each
    # process its own group, which `down` stops as a whole.
    setsid env -i PATH="$PATH" HOME="$HOME" \
        ASPNETCORE_ENVIRONMENT=Development \
        ASPNETCORE_URLS="$CALENDAR_E2E_API_URL" \
        ConnectionStrings__Calendar="Host=127.0.0.1;Port=$CALENDAR_E2E_POSTGRES_PORT;Database=calendar;Username=calendar_app;Password=e2e-app-password" \
        Auth__DevSeedKey="$seed_key" \
        Auth__AllowedEmails__0="$CALENDAR_E2E_ALLOWED_EMAIL" \
        Auth__Google__ClientId="$CALENDAR_E2E_OIDC_CLIENT_ID" \
        Auth__Google__ClientSecret="$CALENDAR_E2E_OIDC_CLIENT_SECRET" \
        Auth__Google__AuthorizationEndpoint="$CALENDAR_E2E_OIDC_ISSUER/authorize" \
        Auth__Google__TokenEndpoint="$CALENDAR_E2E_OIDC_ISSUER/token" \
        Auth__Google__UserInfoEndpoint="$CALENDAR_E2E_OIDC_ISSUER/userinfo" \
        Auth__Google__Issuer="$CALENDAR_E2E_OIDC_ISSUER" \
        OTEL_EXPORTER_OTLP_ENDPOINT="$CALENDAR_E2E_OTLP_HTTP_URL" \
        OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
        OTEL_SERVICE_NAME=calendar-api \
        backend/target/debug/calendar-api > "$dir/logs/api.log" 2>&1 < /dev/null &
    echo "CALENDAR_E2E_API_PID=$!" >> "$dir/stack.env"
    # vite preview serves the build and proxies /api (and /otlp, #732) like vite dev. CALENDAR_DEV_SIGN_IN stays
    # unset: the browser signs in through the stub or the tests' seed-key fixture, never through the proxy.
    (cd frontend/apps/web && exec setsid env -i PATH="$PATH" HOME="$HOME" \
        CALENDAR_API_URL="$CALENDAR_E2E_API_URL" CALENDAR_OTLP_URL="$CALENDAR_E2E_OTLP_HTTP_URL" \
        corepack pnpm exec vite preview --outDir "$dir/web" --host 127.0.0.1 --port "${CALENDAR_E2E_WEB_URL##*:}" --strictPort \
        > "$dir/logs/web.log" 2>&1 < /dev/null) &
    echo "CALENDAR_E2E_WEB_PID=$!" >> "$dir/stack.env"

    wait_for() { timeout "$2" bash -c "until curl -sf -o /dev/null '$1'; do sleep 0.5; done" || fail "$1 did not answer within $2 s"; }
    wait_for "$CALENDAR_E2E_API_URL/api/health" 60
    wait_for "$CALENDAR_E2E_WEB_URL/api/health" 60
    wait_for "$CALENDAR_E2E_WEB_URL/" 30
    echo "Ready after $(( $(date +%s) - started )) s. Check it with 'just e2e check $project'; stop it with 'just e2e down $project'."
    grep -v SEED_KEY "$dir/stack.env"

# Print a run's settings as KEY=VALUE lines (the newest run of this checkout when no project is given)
env project="":
    #!/usr/bin/env bash
    set -euo pipefail
    project="{{ project }}"
    if [[ -z $project ]]; then
        project=$(ls -1t "{{ state_root }}" 2>/dev/null | grep '^calendar-e2e-' | head -n 1 || true)
        [[ -n $project ]] || { echo "No end-to-end run in this checkout: start one with 'just e2e up'." >&2; exit 1; }
    fi
    [[ $project =~ ^calendar-e2e-[0-9a-z-]+$ && -f "{{ state_root }}/$project/stack.env" ]] || { echo "No run '$project' in this checkout (see 'just e2e ls')." >&2; exit 1; }
    cat "{{ state_root }}/$project/stack.env"

# List this checkout's end-to-end runs and whether their containers are up
ls:
    #!/usr/bin/env bash
    set -euo pipefail
    shopt -s nullglob
    for file in {{ state_root }}/calendar-e2e-*/stack.env; do
        project=$(basename "$(dirname "$file")")
        running=$(docker ps -q --filter "label=com.docker.compose.project=$project" | wc -l)
        echo "$project  slot $(grep -oP '^CALENDAR_E2E_SLOT=\K.*' "$file")  containers running: $running"
    done

# Prove a run works: health, PostgreSQL, the OTLP endpoint, and a sign-in through the stub provider
check project="":
    #!/usr/bin/env bash
    set -euo pipefail
    settings=$({{ quote(just_executable()) }} --justfile {{ quote(justfile()) }} "{{ module_path() }}::env" {{ quote(project) }})
    eval "$(sed 's/^/export /' <<<"$settings")"
    jar=$(mktemp -d); trap 'rm -rf "$jar"' EXIT
    ok() { echo "ok   $1"; }
    no() { echo "FAIL $1" >&2; exit 1; }
    status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

    [[ $(status "$CALENDAR_E2E_API_URL/api/health") == 200 ]] && ok "API health" || no "API health"
    [[ $(status "$CALENDAR_E2E_WEB_URL/") == 200 ]] && ok "web app served by vite preview" || no "web app"
    # A seed-key request that reads PostgreSQL as calendar_app.
    code=$(status -H "X-Dev-Seed-Key: $CALENDAR_E2E_SEED_KEY" "$CALENDAR_E2E_API_URL/api/agenda/day?date=2026-11-13&timeZone=UTC")
    [[ $code == 200 ]] && ok "API reads PostgreSQL (day agenda: $code)" || no "API reads PostgreSQL (day agenda: $code)"
    # The collector accepts an empty OTLP/HTTP export, the endpoint the API is given.
    code=$(status -X POST -H 'Content-Type: application/json' -d '{}' "$CALENDAR_E2E_OTLP_HTTP_URL/v1/traces")
    [[ $code == 200 ]] && ok "OTLP/HTTP endpoint accepts exports ($code)" || no "OTLP/HTTP endpoint ($code)"
    code=$(status "$CALENDAR_E2E_GRAFANA_URL/api/health")
    [[ $code == 200 ]] && ok "Grafana ($code)" || no "Grafana ($code)"

    # Sign in through the web app's origin as a browser would: login, the stub's form, the callback, the session.
    # The username is the Google subject; it stays the same per email, because the API binds an email to one subject.
    sign_in() { # email verified -> prints the callback's Location and leaves the cookies in $jar/$1
        local cookies="$jar/$1" location
        location=$(curl -s -o /dev/null -c "$cookies" -w '%{redirect_url}' "$CALENDAR_E2E_WEB_URL/api/auth/login?returnUrl=%2Fday%2F2026-11-13")
        [[ $location == "$CALENDAR_E2E_OIDC_ISSUER/authorize?"* ]] || no "login redirects to the stub issuer (got '$location')"
        location=$(curl -s -o /dev/null -w '%{redirect_url}' -X POST "$location" --data-urlencode "username=subject-$1" \
            --data-urlencode "claims={\"email\":\"$1\",\"email_verified\":$2}")
        [[ $location == "$CALENDAR_E2E_WEB_URL/api/auth/callback/google?"* ]] || no "the stub redirects to the callback (got '$location')"
        curl -s -o /dev/null -b "$cookies" -c "$cookies" -w '%{redirect_url}' "$location"
    }
    location=$(sign_in "$CALENDAR_E2E_ALLOWED_EMAIL" true)
    [[ $location == "$CALENDAR_E2E_WEB_URL/day/2026-11-13" ]] && ok "allow-listed sign-in returns to /day/2026-11-13" || no "allow-listed sign-in (went to '$location')"
    me=$(curl -s -b "$jar/$CALENDAR_E2E_ALLOWED_EMAIL" "$CALENDAR_E2E_WEB_URL/api/auth/me")
    [[ $me == *"\"$CALENDAR_E2E_ALLOWED_EMAIL\""* ]] && ok "the session cookie authenticates /api/auth/me" || no "session (/api/auth/me: $me)"
    location=$(sign_in someone-else@example.com true)
    [[ $location == "$CALENDAR_E2E_WEB_URL/signin?error=access_denied" ]] && ok "a non-allow-listed email is denied" || no "denial (went to '$location')"
    location=$(sign_in "$CALENDAR_E2E_ALLOWED_EMAIL" false)
    [[ $location == "$CALENDAR_E2E_WEB_URL/signin?error=access_denied" ]] && ok "an unverified email is denied" || no "unverified (went to '$location')"
    echo "All checks passed for $CALENDAR_E2E_PROJECT"

# Stop a run and remove only its processes, containers, network and volumes (every run of this checkout when no project is given)
down project="":
    #!/usr/bin/env bash
    set -euo pipefail
    shopt -s nullglob
    projects=()
    if [[ -n "{{ project }}" ]]; then projects=("{{ project }}"); else
        for file in {{ state_root }}/calendar-e2e-*/stack.env; do projects+=("$(basename "$(dirname "$file")")"); done
    fi
    [[ ${#projects[@]} -gt 0 ]] || { echo "No end-to-end run in this checkout."; exit 0; }
    # compose.yaml requires these to interpolate; they are the throwaway values `up` used.
    export POSTGRES_ADMIN_USER=postgres POSTGRES_ADMIN_PASSWORD=e2e-admin-password \
        CALENDAR_MIGRATOR_PASSWORD=e2e-migrator-password CALENDAR_APP_PASSWORD=e2e-app-password
    for project in "${projects[@]}"; do
        # Never the shared `calendar` project, another checkout's run, or anything not made by `just e2e up` here.
        [[ $project =~ ^calendar-e2e-[0-9a-z-]+$ ]] || { echo "Refusing '$project': only calendar-e2e-* projects are end-to-end runs." >&2; exit 1; }
        file="{{ state_root }}/$project/stack.env"
        [[ -f $file ]] || { echo "Refusing '$project': this checkout did not start it (no $file)." >&2; exit 1; }
        for key in CALENDAR_E2E_API_PID CALENDAR_E2E_WEB_PID; do
            pid=$(grep -oP "^$key=\K[0-9]+" "$file" || true)
            [[ -n $pid ]] || continue
            # Only a process group this run started, in case the PID was reused: the API must still listen on this
            # run's URL, and vite must still serve this run's build folder.
            args=$(ps -o args= -p "$pid" 2>/dev/null || true)
            api_url=$(grep -oP '^CALENDAR_E2E_API_URL=\K.*' "$file")
            if [[ $args == *"$project"* ]] || { [[ $args == *calendar-api* ]] \
                && tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep -qxF "ASPNETCORE_URLS=$api_url"; }; then
                kill -TERM -- "-$pid" 2>/dev/null || true
                echo "stopped $key $pid"
            fi
        done
        docker compose -p "$project" --profile observability --profile sign-in-stub down --volumes --remove-orphans --timeout 5
        rm -rf "{{ state_root }}/$project"
        echo "removed $project"
    done
