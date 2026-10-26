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

.PHONY: db-up db-down db-reset db-migrate db-psql help doctor setup build test lint tooling tool-versions adr-check format check contracts dev-api dev-web clean

help: ## List targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

doctor: ## Check that dotnet, node and pnpm match the pinned versions
	@./tools/doctor/doctor.sh

setup: doctor ## Restore .NET packages and install frontend dependencies
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

tool-versions: ## Check tooling package pins match backend/Directory.Packages.props (ARGS=--fix to update)
	dotnet run tools/tool-versions/tool-versions.cs -- $(ARGS)

adr-check: ## Validate ADRs in docs/decisions (pass flags via ARGS=, e.g. ARGS=--fix-links)
	$(ADR_CHECK) $(ARGS)

db-up: ## Start the local PostgreSQL (creates .env from .env.example on first run)
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

dev-api: ## Run the API on http://localhost:5041
	$(DOTNET) watch --project src/Calendar.Api

dev-web: ## Run the web UI (proxies /api to the API)
	$(PNPM) dev

clean: ## Remove build outputs
	$(DOTNET) clean
	find $(FRONTEND) -name dist -type d -prune -not -path '*/node_modules/*' -exec rm -rf {} +
