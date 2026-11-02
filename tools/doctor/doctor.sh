#!/usr/bin/env bash
# Verifies the local toolchain matches the versions pinned in the repo.
# Prints a fix hint for each problem and exits non-zero if any are found.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
problems=0

if [ -t 1 ]; then green=$'\033[32m' red=$'\033[31m' reset=$'\033[0m'; else green='' red='' reset=''; fi
ok()   { printf '  %s✓%s %s\n' "$green" "$reset" "$1"; }
fail() { printf '  %s✗%s %s\n      → %s\n' "$red" "$reset" "$1" "$2"; problems=$((problems + 1)); }

echo "Checking toolchain..."

# .NET SDK: must satisfy backend/global.json (dotnet --version fails otherwise).
if ! command -v dotnet >/dev/null 2>&1; then
  fail "dotnet not found" "Install the .NET SDK pinned in backend/global.json: https://learn.microsoft.com/dotnet/core/install/linux"
elif sdk="$(cd "$root/backend" && dotnet --version 2>/dev/null)"; then
  ok ".NET SDK $sdk (satisfies backend/global.json)"
else
  fail "no .NET SDK satisfies backend/global.json" "Install the SDK version in backend/global.json (dotnet --list-sdks shows what is installed)"
fi

# Node: major version must match frontend/.node-version.
want_node="$(tr -d '[:space:]v' < "$root/frontend/.node-version")"
if ! command -v node >/dev/null 2>&1; then
  fail "node not found" "Install Node $want_node with a version manager, e.g. fnm: https://github.com/Schniz/fnm"
else
  have_node="$(node --version | tr -d v)"
  if [ "${have_node%%.*}" = "${want_node%%.*}" ]; then
    ok "Node $have_node ($(command -v node))"
  else
    fail "Node $have_node at $(command -v node), but frontend/.node-version wants $want_node" \
      "Use a version manager that reads .node-version, e.g. 'fnm install && fnm use' (Ubuntu's apt nodejs is too old and lacks Corepack)"
  fi
fi

# pnpm: provided by Corepack from the packageManager field in frontend/package.json.
want_pnpm="$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' "$root/frontend/package.json")"
if command -v pnpm >/dev/null 2>&1; then
  ok "pnpm on PATH ($(command -v pnpm)); package.json pins pnpm@$want_pnpm"
elif command -v corepack >/dev/null 2>&1; then
  fail "pnpm not on PATH" "Run 'corepack enable pnpm' (provisions pnpm@$want_pnpm from frontend/package.json)"
else
  fail "pnpm not on PATH and corepack not available" "Install Node $want_node (bundles Corepack), then run 'corepack enable pnpm'"
fi

# Docker: needed for the local database (just db-up) and the Testcontainers-based tests (ADR-0016).
if ! command -v docker >/dev/null 2>&1; then
  fail "docker not found" "Install Docker Engine (or Docker Desktop with WSL integration): https://docs.docker.com/engine/install/"
elif ! docker info >/dev/null 2>&1; then
  fail "docker is installed but the daemon is not reachable" "Start Docker (e.g. 'sudo service docker start', or start Docker Desktop) and make sure your user may access the socket"
else
  ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) (daemon reachable)"
fi

# just: the task runner (ADR-0038). The minimum version is in .just-version.
want_just="$(tr -d '[:space:]v' < "$root/.just-version")"
if ! command -v just >/dev/null 2>&1; then
  fail "just not found" "Install just $want_just or newer: https://just.systems/man/en/packages.html (Ubuntu's apt package is older; use the release binary or cargo)"
else
  have_just="$(just --version | sed -n 's/^just \([0-9][0-9.]*\).*/\1/p')"
  if [ "$(printf '%s\n%s\n' "$want_just" "$have_just" | sort -V | head -n 1)" = "$want_just" ]; then
    ok "just $have_just (.just-version wants $want_just or newer)"
  else
    fail "just $have_just, but .just-version wants $want_just or newer" "Install just $want_just or newer: https://just.systems/man/en/packages.html"
  fi
fi

# Azure tools are deployment prerequisites; local-only development can skip them.
if [ "${1:-}" = "--infra" ]; then
  export AZURE_BICEP_USE_BINARY_FROM_PATH=false
  # This checked-in manifest contains only version assignments.
  # shellcheck disable=SC1091
  . "$root/tools/azure-versions.env"
  if ! command -v az >/dev/null 2>&1; then
    fail "Azure CLI not found" "Install Azure CLI $AZURE_CLI_VERSION: https://learn.microsoft.com/cli/azure/install-azure-cli"
  else
    have_az="$(az version --query '"azure-cli"' -o tsv 2>/dev/null || true)"
    if [ "$have_az" = "$AZURE_CLI_VERSION" ]; then
      ok "Azure CLI $have_az"
    else
      fail "Azure CLI version '${have_az:-unavailable}', expected $AZURE_CLI_VERSION" "Install Azure CLI $AZURE_CLI_VERSION: https://learn.microsoft.com/cli/azure/install-azure-cli"
    fi
    have_bicep="$(az bicep version 2>/dev/null | sed -n 's/^Bicep CLI version \([0-9][0-9.]*\).*/\1/p' || true)"
    if [ "$have_bicep" = "$BICEP_VERSION" ]; then
      ok "Bicep $have_bicep"
    else
      fail "Bicep version '${have_bicep:-unavailable}', expected $BICEP_VERSION" "Run 'az bicep install --version v$BICEP_VERSION' and 'az config set bicep.use_binary_from_path=false'"
    fi
  fi
fi

if [ "$problems" -gt 0 ]; then
  echo "Found $problems problem(s). See the README 'Prerequisites' section."
  exit 1
fi
echo "Toolchain OK."
