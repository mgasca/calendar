# Azure infrastructure recipes (`just infra <recipe>`), wrapping tools/infra/infra.cs (ADR-0033).
# They run at the repo root, where the tool's paths are relative to.

set shell := ["bash", "-euo", "pipefail", "-c"]
set working-directory := '..'

# List this module's recipes
[default]
[private]
list:
    @just --list infra

# Preview infrastructure (env: staging|production; phase: foundation|full; e.g. just infra what-if staging full --allow-ip CIDR)
what-if env phase="full" *args:
    @./tools/doctor/doctor.sh --infra
    dotnet run tools/infra/infra.cs -- what-if {{ env }} --phase {{ phase }} {{ args }}

# Deploy infrastructure (env: staging|production; phase: foundation|full; e.g. just infra deploy staging full --allow-ip CIDR)
deploy env phase="full" *args:
    @./tools/doctor/doctor.sh --infra
    dotnet run tools/infra/infra.cs -- deploy {{ env }} --phase {{ phase }} {{ args }}

# Owner creates the Postgres password (env: staging|production)
secret-init env:
    @./tools/doctor/doctor.sh --infra
    dotnet run tools/infra/infra.cs -- secret init-postgres-password {{ env }}

# Stop staging PostgreSQL
db-stop:
    @./tools/doctor/doctor.sh --infra
    dotnet run tools/infra/infra.cs -- db stop staging

# Start staging PostgreSQL
db-start:
    @./tools/doctor/doctor.sh --infra
    dotnet run tools/infra/infra.cs -- db start staging

# Initialize database roles (env: staging|production; e.g. just infra init-roles staging --client-ip IPv4)
init-roles env *args:
    dotnet run tools/infra/infra.cs -- db init-roles {{ env }} {{ args }}

# Apply database migrations (env: staging|production; e.g. just infra migrate staging --client-ip IPv4)
migrate env *args:
    dotnet run tools/infra/infra.cs -- migrate {{ env }} {{ args }}

# Check the Azure role SQL against a real PostgreSQL (needs Docker)
integration:
    dotnet run tools/infra/integration/database.cs
