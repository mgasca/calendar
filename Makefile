# Top-level task runner. Each language keeps its native tooling; these targets just orchestrate.
.DEFAULT_GOAL := help
BACKEND  := backend
FRONTEND := frontend
PNPM     := pnpm --dir $(FRONTEND)
# Run dotnet inside backend/ so backend/global.json (SDK pin, test runner) applies.
DOTNET   := cd $(BACKEND) && dotnet

.PHONY: help setup build test lint format check contracts dev-api dev-web clean

help: ## List targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

setup: ## Restore .NET packages and install frontend dependencies
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
	$(PNPM) lint
	$(PNPM) typecheck

format: ## Auto-format all code
	$(DOTNET) format
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
