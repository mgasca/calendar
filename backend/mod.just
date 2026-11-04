# .NET backend recipes (`just backend <recipe>`). They run in backend/, so backend/global.json
# (SDK pin, test runner) applies.

set shell := ["bash", "-euo", "pipefail", "-c"]

# List this module's recipes
[default]
[private]
list:
    @just --list backend

# Restore .NET packages; arguments go to dotnet restore (e.g. just backend restore -p:NuGetAudit=false offline)
restore *args:
    dotnet restore {{ args }}

# Build the solution
build:
    dotnet build --no-restore

# Run the tests; arguments go to dotnet test (e.g. just backend test --project tests/Calendar.Domain.Tests --filter-method "*Name*")
test *args:
    dotnet test {{ args }}

# Analyzers, formatting check and the EF Core model check
lint:
    dotnet build --no-restore
    dotnet format --verify-no-changes --no-restore
    dotnet tool restore
    dotnet ef migrations has-pending-model-changes --project src/Calendar.Infrastructure --no-build

# Auto-format the backend
format:
    dotnet format

# Run the API on http://localhost:5041 (.env is loaded by the root justfile)
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -f "{{ justfile_directory() }}/.env" ]; then echo "No .env found: copy .env.example to .env"; fi
    if [ -z "${Auth__Google__ClientId:-}" ] || [ -z "${Auth__Google__ClientSecret:-}" ]; then
        echo "Warning: Auth__Google__ClientId/ClientSecret are not set in .env, so 'Sign in with Google' will return 503 (see README)."
    fi
    dotnet watch --project src/Calendar.Api

# Build the API, which regenerates contracts/openapi.json (part of just contracts)
contract:
    dotnet build src/Calendar.Api

# Remove .NET build outputs
clean:
    dotnet clean
