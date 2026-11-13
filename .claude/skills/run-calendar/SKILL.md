---
name: run-calendar
description: Run, start, launch and drive the Calendar app (API + web UI) locally, signed in without Google, and take screenshots of the Today, Week and My tasks views. Use when asked to run or start the app, screenshot the UI, click through a flow (add a task, complete it, open the week), call the running API with curl, or confirm a frontend or backend change works in the real app rather than only in tests.
---

# Run the Calendar app

The agent path is a throwaway stack on its own ports (PostgreSQL 55432, API 55041, Vite 55173), signed in through
the API's development seed key, and driven by
`.claude/skills/run-calendar/scripts/browse/browse.cs`: a .NET file-based Playwright driver (ADR-0017) that reads
commands on stdin and writes screenshots to `/tmp/calendar-shots/`. Use `curl` with the same key for the API.

All paths are relative to the repo root. Each block below was run as written on Ubuntu 26.04 (WSL2), Node 24, with
podman behind the `docker` command and the driver blocks with .NET SDK 10.0.403. The backend blocks (migrations, API,
`curl`) were run again with Docker after the backend moved to Rust (Cargo, the toolchain in `backend/rust-toolchain.toml`).

## Prerequisites (once per machine)

Toolchain as in the README (`./tools/doctor/doctor.sh`), then dependencies:

```bash
just backend restore && just frontend install
```

The driver uses `#:include`, which .NET SDK 10.0.1xx rejects (`Unrecognized directive 'include'`), and 10.0.1xx is
what Ubuntu's `dotnet-sdk-10.0` package installs. Check `dotnet --version` in the shell that runs the driver: under
WSL, the Windows SDK in `C:\Program Files\dotnet` doesn't count. If it starts with `10.0.1`, install a newer SDK next
to it, without sudo, and put it first on `PATH` (add the `export` to `~/.bashrc` to keep it):

```bash
curl -fsSL https://dot.net/v1/dotnet-install.sh | bash -s -- --version 10.0.403 --install-dir ~/.dotnet
```

```bash
export DOTNET_ROOT="$HOME/.dotnet" PATH="$HOME/.dotnet:$PATH"
```

Download Chromium for the driver (the first run also builds the driver, about a minute):

```bash
dotnet run .claude/skills/run-calendar/scripts/browse/browse.cs -- --install
```

Chromium needs `libnss3`, `libnspr4` and `libasound2t64`. Without sudo, extract them into the cache folder the driver
adds to `LD_LIBRARY_PATH` by itself:

```bash
L=~/.cache/calendar-chromium-libs; mkdir -p $L/debs && (cd $L/debs && apt-get download libnss3 libnspr4 libasound2t64) && for d in $L/debs/*.deb; do dpkg -x "$d" $L; done
```

(With sudo, `sudo apt-get install -y libnss3 libnspr4 libasound2t64` does the same.)

## Start the stack (agent path)

1. Throwaway PostgreSQL. The roles come from `docker/postgres/init`; the data dies with the container.

```bash
docker run -d --rm --name calendar-agent-db -p 127.0.0.1:55432:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=dev-admin-password -e POSTGRES_DB=calendar \
  -e CALENDAR_MIGRATOR_PASSWORD=dev-migrator-password -e CALENDAR_APP_PASSWORD=dev-app-password \
  -v "$PWD/docker/postgres/init:/docker-entrypoint-initdb.d:ro" "$(grep -oP 'image: \Kpostgres:\S+' compose.yaml)"
timeout 60 bash -c 'until docker exec calendar-agent-db pg_isready -h 127.0.0.1 -U postgres -d calendar >/dev/null 2>&1; do sleep 1; done'
```

2. Migrations, as `calendar_migrator` (ADR-0052):

```bash
(cd backend && CALENDAR_MIGRATOR_CONNECTION="Host=127.0.0.1;Port=55432;Database=calendar;Username=calendar_migrator;Password=dev-migrator-password" cargo run --locked --quiet -p calendar-migrate)
```

3. API in Development with the seed key, as `calendar_app`:

```bash
mkdir -p /tmp/calendar-agent
(cd backend && cargo build --locked -p calendar-api && ASPNETCORE_ENVIRONMENT=Development \
  ConnectionStrings__Calendar="Host=127.0.0.1;Port=55432;Database=calendar;Username=calendar_app;Password=dev-app-password" \
  Auth__DevSeedKey=local-development-seed-key-change-me-123456 \
  Auth__AllowedEmails__0=dev-seed@example.com \
  nohup target/debug/calendar-api --urls http://127.0.0.1:55041 > /tmp/calendar-agent/api.log 2>&1 &)
timeout 180 bash -c 'until curl -sf http://127.0.0.1:55041/api/health >/dev/null; do sleep 1; done'
```

4. Web UI (Vite) proxying `/api` to that API:

```bash
(cd frontend/apps/web && CALENDAR_API_URL=http://127.0.0.1:55041 nohup corepack pnpm exec vite --host 127.0.0.1 --port 55173 --strictPort > /tmp/calendar-agent/web.log 2>&1 &)
timeout 60 bash -c 'until curl -sf http://127.0.0.1:55173/api/health >/dev/null; do sleep 1; done'
```

5. Seed today (UTC, the driver's default zone) through the API:

```bash
K=local-development-seed-key-change-me-123456; A=http://127.0.0.1:55041; D=$(date -u +%F); N=$(date -u -d tomorrow +%F)
post() { curl -sS -o /dev/null -w "$1 %{http_code}\n" -X POST "$A$1" -H "X-Dev-Seed-Key: $K" -H 'Content-Type: application/json' -d "$2"; }
post /api/events "{\"title\":\"Team stand-up\",\"start\":\"${D}T09:00:00Z\",\"end\":\"${D}T09:30:00Z\",\"timeZone\":\"UTC\",\"location\":\"Room 2\"}"
post /api/events "{\"title\":\"Conference day\",\"allDay\":true,\"startDate\":\"$D\",\"endDate\":\"$N\"}"
post /api/tasks "{\"title\":\"Review the quarterly plan\",\"priority\":\"high\",\"dueDate\":\"$D\"}"
```

Each line prints `201`.

## Drive the UI

Pipe a script to the driver. It stops at the first failing command, prints the error and saves
`/tmp/calendar-shots/failure.png`. A cached run takes about 2 s; the first after an edit to `browse.cs` rebuilds it.

```bash
dotnet run .claude/skills/run-calendar/scripts/browse/browse.cs <<'EOF'
nav /
click role=button[name="Add task"]
fill label=Title Book the dentist
select label=Priority Low
click role=button[name="Save task"]
wait-for text=Book the dentist
click role=checkbox[name="Review the quarterly plan"]
wait-for role=checkbox[name="Review the quarterly plan"][checked=true]
screenshot task-added
nav /tasks
wait-for text=Book the dentist
screenshot my-tasks
errors
EOF
```

It prints each command, the screenshot paths (`/tmp/calendar-shots/task-added.png`, ...) and `no errors`. Open the
PNGs with the Read tool and look at them.
To show one on an issue or PR, add it to the `screenshots` branch under the issue number and link the pinned raw
URL, as the `github-screenshots` skill describes; never attach it another way.

| command | what it does |
| --- | --- |
| `nav PATH` | open `/`, `/week`, `/tasks`, `/signin` (relative to `--base-url`) |
| `wait-for SEL` | wait up to 15 s for the element to be visible |
| `click SEL` / `fill SEL TEXT` / `select SEL VALUE` / `press KEY` | act; `fill` and `select` take the rest of the line |
| `text [SEL]` / `count SEL` | print visible text (default `main`) / number of matches |
| `eval JS` | evaluate an expression in the page and print it |
| `screenshot [NAME]` | full-page PNG in `/tmp/calendar-shots/` (or `--out DIR`) |
| `errors` | console errors, page errors and every HTTP response >= 400 so far |

Selectors are Playwright's (`text=`, `role=button[name="..."]`, `data-testid=`, CSS), plus `label=TEXT` for the
first form field whose label contains TEXT. Wrap a selector containing spaces in single quotes unless it is the
last argument. Options: `--base-url`, `--time-zone` (default `UTC`; the client decides what "today" is, ADR-0021),
`--seed-key`, `--out`, `--viewport WxH` (default `1280x900`; `390x844` is a phone) and `--color-scheme light|dark`
(the browser's OS preference, for the System theme). The saved theme is `localStorage` key `calendar.theme`
(`light`, `dark` or `system`): `eval localStorage.setItem('calendar.theme', 'dark')`, then `nav` again.

The week grid scrolls itself to the current time, so morning events can be outside a screenshot. Scroll it first:

```bash
dotnet run .claude/skills/run-calendar/scripts/browse/browse.cs <<'EOF'
nav /week
wait-for data-testid=week-scroll
eval document.querySelector('[data-testid="week-scroll"]').scrollTop = 8 * 48
screenshot week-morning
EOF
```

## Drive the API

Every endpoint except health and sign-in needs the key header (ADR-0027). Agenda reads take `today` and `timeZone`:

```bash
curl -s -H 'X-Dev-Seed-Key: local-development-seed-key-change-me-123456' "http://127.0.0.1:55041/api/agenda/day?date=$(date -u +%F)&today=$(date -u +%F)&timeZone=UTC"
```

The API log is `/tmp/calendar-agent/api.log`; Vite's is `/tmp/calendar-agent/web.log`.

## Stop

```bash
lsof -ti:55173 -sTCP:LISTEN | xargs -r kill; lsof -ti:55041 -sTCP:LISTEN | xargs -r kill; docker stop calendar-agent-db
```

## Run (human path)

`just db up`, `just db migrate`, `just backend dev`, `just frontend dev`, then open http://localhost:5173. With
`just frontend dev`, sign-in is Google only, so it needs a real OAuth client and allow-listed email in `.env` (`backend/README.md`,
"Google sign-in setup"); without them the sign-in button returns 503. To sign in without Google, set
`Auth__AllowedEmails__0` in `.env` and run `just frontend dev-signed-in` instead. Its Vite proxy adds `Auth__DevSeedKey`
to every `/api` request (story 0021). This path uses the shared `calendar` Compose project, so it touches the same
database container and volume as every other checkout on the machine.

## Test

```bash
just frontend test-web
```

```bash
just backend test -p calendar-domain
```

```bash
just backend test -p calendar-api task
```

The second command runs the API tests whose name contains `task`. The infrastructure and API tests start their own
Testcontainers PostgreSQL (with podman, `DOCKER_HOST` must point at the podman socket); the domain tests need no Docker.

The driver's own tests cover script parsing only, so they need neither Chromium nor the app; `just tools test` and the CI
`Tooling` job run them:

```bash
dotnet run .claude/skills/run-calendar/tests/browse.tests.cs
```

Observed: 20 tests pass.

## Gotchas

- **No Google credentials, so sign in with the seed key.** In Development with `Auth__DevSeedKey` (at least 32
  characters) set, a request carrying `X-Dev-Seed-Key` is authenticated as `dev-seed`, acting as the user of the
  first allow-listed email (`Auth__AllowedEmails__0`, any syntactically valid address here): the seed finds, claims
  or creates that user's row, and every event and task it creates belongs to it (ADR-0041). The driver sends the
  key on every browser request, so the SPA's `/api/auth/me` check passes and the nav shows "dev-seed".
- **The API is Production unless told otherwise.** The binary has no launch profile: without
  `ASPNETCORE_ENVIRONMENT=Development` the seed scheme is off and every call is 401. `just backend dev` sets it; the
  block above sets it by hand.
- **The API does not serve the web app here.** It serves static files from `wwwroot` in its working directory (or
  `ASPNETCORE_WEBROOT`), which only the container image has; locally the UI comes from Vite.
- **Why not `just db up`:** `compose.yaml` pins the project name `calendar`, so every worktree shares one container
  and volume (`calendar_calendar-pgdata`) with the human's checkout. The agent database is a separate `--rm`
  container on 55432, and the agent ports stay clear of `just backend dev` (5041) and `just frontend dev` (5173).
- **`#:include` needs a newer SDK than 10.0.1xx.** On 10.0.1xx the driver, its tests, `just db seed`, `just tools adr`
  and `just tools test` all fail with `Unrecognized directive 'include'`; see Prerequisites. Seeding above uses `curl`,
  which works with any SDK.
- **File-based apps default to `PublishAot`**, which disables reflection-based JSON; Playwright then fails with
  `Reflection-based serialization has been disabled`. The driver sets `#:property PublishAot=false`.
- **`label=` is not a Playwright selector engine** (`Unknown engine "label"`); the driver maps it to `GetByLabel`.
  The match is a substring because each field sits inside its `<label>`, so a select's label text also holds its
  options ("Priority Low Medium High") and an exact match finds nothing.
- **All-day events have an exclusive end date**: `endDate` equal to `startDate` is a 400
  ("end is exclusive"); use the next day.
- **Seed and browse in the same zone.** The browser runs in `--time-zone` (UTC by default) and seeds above use
  `date -u`; with another zone, pass `--time-zone` and seed with matching dates.

## Troubleshooting

- **`chrome-headless-shell: error while loading shared libraries: libnspr4.so`**: the libraries are missing; run the
  `apt-get download` block above (the driver picks up `~/.cache/calendar-chromium-libs` automatically).
- **`Executable doesn't exist at ~/.cache/ms-playwright/...`**: run the driver with `--install`.
- **`wait-for` times out, `failure.png` shows "Sign in", and the error lists `HTTP 401 GET .../api/auth/me`**: the
  API is not in Development, was started with a different `Auth__DevSeedKey` than the driver's (`--seed-key`), or
  has no `Auth__AllowedEmails__0` (the seed scheme refuses to act without a first allow-listed email).
- **`the container name "calendar-agent-db" is already in use`**: the previous agent database is still running;
  reuse it, or `docker stop calendar-agent-db` and start again.
