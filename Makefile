# Top-level task runner. Each language keeps its native tooling; these targets just orchestrate.
.DEFAULT_GOAL := help
BACKEND  := backend
FRONTEND := frontend
PNPM     := pnpm --dir $(FRONTEND)
# Run dotnet inside backend/ so backend/global.json (SDK pin, test runner) applies.
DOTNET   := cd $(BACKEND) && dotnet
# Repo tooling: .NET file-based apps kept in their skill folder or tools/<name>/ (ADR-0017).
ADR_SKILL := .claude/skills/adr-draft
ADR_CHECK := dotnet run $(ADR_SKILL)/scripts/check-adr/check-adr.cs --
TOOL_DIRS := $(ADR_SKILL) tools
SHELL_TOOLS := tools/doctor/doctor.sh

# Local database (ADR-0016). Credentials come from the untracked .env (created from .env.example).
COMPOSE := docker compose
DB_ENV  := set -a && . ./.env && set +a

.PHONY: infra-integration infra-init-roles infra-migrate infra-what-if infra-deploy infra-secret-init infra-db-stop infra-db-start db-up db-down db-reset db-migrate db-seed db-psql help doctor setup build test lint tooling tool-versions adr-check format check contracts dev-api dev-web dev-docs build-docs preview-docs bench-docs clean

help: ## List targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

doctor: ## Check the toolchain (ARGS=--infra also checks Azure CLI and Bicep)
	@./tools/doctor/doctor.sh $(ARGS)

setup: doctor ## Restore .NET packages, install frontend dependencies, configure git blame
	git config blame.ignoreRevsFile .git-blame-ignore-revs
	$(DOTNET) restore
	$(PNPM) install --frozen-lockfile

build: ## Build backend and frontend
	$(DOTNET) build --no-restore
	$(PNPM) build

test: ## Run all tests
	$(DOTNET) test
	$(PNPM) test

lint: ## Static analysis (analyzers run as part of the .NET build)
	$(DOTNET) build --no-restore
	$(DOTNET) format --verify-no-changes --no-restore
	$(DOTNET) tool restore
	$(DOTNET) ef migrations has-pending-model-changes --project src/Calendar.Infrastructure --no-build
	$(PNPM) lint
	$(PNPM) typecheck
	$(MAKE) --no-print-directory tooling tool-versions adr-check

tooling: ## Test and lint repo tooling (skill scripts, tools/)
	@for t in $$(find $(TOOL_DIRS) -name '*.tests.cs' -not -path '*/fixtures/*' | sort); do echo "dotnet run $$t"; dotnet run $$t || exit 1; done
	@for d in $(TOOL_DIRS); do echo "dotnet format whitespace $$d"; dotnet format whitespace --folder --verify-no-changes $$d || exit 1; done
	@if command -v shellcheck >/dev/null 2>&1; then echo "shellcheck $(SHELL_TOOLS)"; shellcheck $(SHELL_TOOLS); \
	elif [ -n "$$CI" ]; then echo "shellcheck is required in CI" >&2; exit 1; \
	else echo "shellcheck not installed: skipped locally (CI runs it)"; fi

infra-integration: ## Check the Azure role SQL against a real PostgreSQL (needs Docker)
	dotnet run tools/infra/integration/database.cs

tool-versions: ## Check tooling package pins match backend/Directory.Packages.props (ARGS=--fix to update)
	dotnet run tools/tool-versions/tool-versions.cs -- $(ARGS)

adr-check: ## Validate ADRs in docs/decisions (pass flags via ARGS=, e.g. ARGS=--fix-links)
	$(ADR_CHECK) $(ARGS)

db-up: ## Start the local PostgreSQL (creates .env from .env.example on first run)
	@test -f docker/postgres/init/01-roles.sh || { echo "docker/postgres/init/01-roles.sh is missing: the working tree is incomplete (check 'git status', then 'git pull')." >&2; exit 1; }
	@test -f .env || { cp .env.example .env && echo "Created .env from .env.example"; }
	$(COMPOSE) up -d --wait postgres

db-down: ## Stop the local PostgreSQL (keeps data)
	$(COMPOSE) down

db-reset: ## Delete the local database volume and start a fresh PostgreSQL (migrate afterwards)
	$(COMPOSE) down --volumes
	$(MAKE) --no-print-directory db-up

db-migrate: ## Apply EF Core migrations to the local database as calendar_migrator
	@$(DB_ENV) && cd $(BACKEND) && dotnet tool restore >/dev/null && \
	CALENDAR_MIGRATOR_CONNECTION="Host=127.0.0.1;Port=5432;Database=$$POSTGRES_DB;Username=calendar_migrator;Password=$$CALENDAR_MIGRATOR_PASSWORD" \
	dotnet ef database update --project src/Calendar.Infrastructure

db-seed: ## Seed a running API with a sample day (ARGS="--date YYYY-MM-DD --time-zone ID --api-url URL"; additive)
	@if [ -f .env ]; then $(DB_ENV); fi; dotnet run tools/seed-dev/seed-dev.cs -- $(ARGS)

db-psql: ## Open psql on the local database as calendar_migrator
	@$(DB_ENV) && $(COMPOSE) exec -e PGPASSWORD="$$CALENDAR_MIGRATOR_PASSWORD" postgres psql -U calendar_migrator -d "$$POSTGRES_DB"

format: ## Auto-format all code
	$(DOTNET) format
	@for d in $(TOOL_DIRS); do dotnet format whitespace --folder $$d; done
	$(PNPM) format

contracts: ## Regenerate OpenAPI contract and TypeScript client
	$(DOTNET) build src/Calendar.Api
	$(PNPM) --filter @calendar/api-client generate

check: lint test ## Everything CI runs

dev-api: ## Run the API on http://localhost:5041 (loads .env, e.g. the Google sign-in settings)
	@if [ -f .env ]; then $(DB_ENV); else echo "No .env found: copy .env.example to .env"; fi; \
	if [ -z "$$Auth__Google__ClientId" ] || [ -z "$$Auth__Google__ClientSecret" ]; then \
		echo "Warning: Auth__Google__ClientId/ClientSecret are not set in .env, so 'Sign in with Google' will return 503 (see README)."; \
	fi; \
	$(DOTNET) watch --project src/Calendar.Api

dev-web: ## Run the web UI (proxies /api to the API)
	$(PNPM) dev

dev-docs: ## Run the documentation site (ADRs and stories) on http://localhost:4321
	$(PNPM) --filter @calendar/docs dev

build-docs: ## Build and verify the static documentation site (optional DOCS_SITE_URL for hosting URL)
	$(PNPM) --filter @calendar/docs build
	$(PNPM) --filter @calendar/docs verify:build

preview-docs: ## Preview the built documentation site locally
	$(PNPM) --filter @calendar/docs preview

bench-docs: ## Benchmark ADR/story loading (run by hand; record results in docs/benchmarks/)
	$(PNPM) --filter @calendar/docs bench

clean: ## Remove build outputs
	$(DOTNET) clean
	find $(FRONTEND) -name dist -type d -prune -not -path '*/node_modules/*' -exec rm -rf {} +

image: ## Build calendar:local and calendar:<git-sha> using the pinned Node major
	docker build --build-arg NODE_VERSION=$$(cat frontend/.node-version) -t calendar:local -t calendar:$$(git rev-parse --short HEAD) .

run-image: ## Run on host port 8080 using local Postgres and .env (IMAGE_ENV defaults to Production)
	@$(DB_ENV) && export ConnectionStrings__Calendar="Host=127.0.0.1;Port=5432;Database=$$POSTGRES_DB;Username=calendar_app;Password=$$CALENDAR_APP_PASSWORD" && \
	export ASPNETCORE_ENVIRONMENT="$(or $(IMAGE_ENV),Production)" && \
	docker run --rm --network host --env-file .env -e ConnectionStrings__Calendar -e ASPNETCORE_ENVIRONMENT calendar:local

smoke-image: ## Check a running image at localhost:8080 (or BASE_URL)
	@base="$${BASE_URL:-http://localhost:8080}"; tmp=$$(mktemp -d); trap 'rm -rf "$$tmp"' EXIT; \
	for route in / /week /api/health /api/unknown /api/tasks; do \
	  code=$$(curl -sS -o "$$tmp/body" -w '%{http_code}' "$$base$$route") || exit 1; \
	  case "$$route:$$code" in /:200) grep -qi '<!doctype html' "$$tmp/body" && cp "$$tmp/body" "$$tmp/index" || exit 1;; \
	    /week:200) cmp -s "$$tmp/index" "$$tmp/body" || exit 1;; \
	    /api/health:200|/api/unknown:404|/api/tasks:401) ;; \
	    *) echo "Unexpected response $$code for $$route" >&2; exit 1;; esac; \
	  echo "$$route: $$code"; \
	done

infra-what-if: ## Preview infrastructure (ENV=staging|production, PHASE=foundation|full, ARGS="--allow-ip CIDR")
	@./tools/doctor/doctor.sh --infra
	dotnet run tools/infra/infra.cs -- what-if $(ENV) --phase $(or $(PHASE),full) $(ARGS)

infra-deploy: ## Deploy infrastructure (ENV=staging|production, PHASE=foundation|full, ARGS="--allow-ip CIDR")
	@./tools/doctor/doctor.sh --infra
	dotnet run tools/infra/infra.cs -- deploy $(ENV) --phase $(or $(PHASE),full) $(ARGS)

infra-secret-init: ## Owner creates the Postgres password (ENV=staging|production)
	@./tools/doctor/doctor.sh --infra
	dotnet run tools/infra/infra.cs -- secret init-postgres-password $(ENV)

infra-db-stop: ## Stop staging PostgreSQL
	@./tools/doctor/doctor.sh --infra
	dotnet run tools/infra/infra.cs -- db stop staging

infra-db-start: ## Start staging PostgreSQL
	@./tools/doctor/doctor.sh --infra
	dotnet run tools/infra/infra.cs -- db start staging

infra-init-roles: ## Initialize database roles (ENV=staging|production, ARGS="--client-ip IPv4")
	dotnet run tools/infra/infra.cs -- db init-roles $(ENV) $(ARGS)

infra-migrate: ## Apply database migrations (ENV=staging|production, ARGS="--client-ip IPv4")
	dotnet run tools/infra/infra.cs -- migrate $(ENV) $(ARGS)
