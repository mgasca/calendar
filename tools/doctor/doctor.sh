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

# Rust: the backend's toolchain is pinned in backend/rust-toolchain.toml. With rustup, cargo and rustc in backend/
# select that toolchain (and report an error when it is not installed), so the versions are read there.
want_rust="$(sed -n 's/^channel *= *"\(.*\)"/\1/p' "$root/backend/rust-toolchain.toml")"
if ! command -v cargo >/dev/null 2>&1 || ! command -v rustc >/dev/null 2>&1; then
  fail "cargo or rustc not found" "Install rustup (https://rustup.rs), then run 'rustup toolchain install' in backend/ for Rust $want_rust; make sure ~/.cargo/bin is on PATH"
elif have_rust="$(cd "$root/backend" && rustc --version 2>/dev/null | sed -n 's/^rustc \([^ ]*\).*/\1/p')" && [ "$have_rust" = "$want_rust" ] \
  && (cd "$root/backend" && cargo --version >/dev/null 2>&1); then
  ok "Rust $have_rust (backend/rust-toolchain.toml)"
else
  fail "Rust '${have_rust:-unavailable}' in backend/, but backend/rust-toolchain.toml wants $want_rust" \
    "Run 'rustup toolchain install' in backend/ (rustup reads rust-toolchain.toml); without rustup, install Rust $want_rust with rustfmt and clippy"
fi

# A C compiler and linker: rustc links through cc, and some crates (the TLS backend) compile C.
if command -v cc >/dev/null 2>&1 || command -v gcc >/dev/null 2>&1 || command -v clang >/dev/null 2>&1; then
  ok "C compiler and linker ($(command -v cc || command -v gcc || command -v clang))"
else
  fail "no C compiler (cc, gcc or clang) found" "Install one, e.g. 'sudo apt install build-essential': the backend cannot link without it"
fi

# Deno: exact version for the TypeScript repo tooling and scripted skills (ADR-0058).
want_deno="$(tr -d '[:space:]v' < "$root/.deno-version")"
if ! command -v deno >/dev/null 2>&1; then
  fail "deno not found" "Install Deno $want_deno from https://docs.deno.com/runtime/getting_started/installation/"
else
  have_deno="$(deno --version 2>/dev/null | sed -n '1s/^deno \([^ ]*\).*/\1/p')"
  if [ "$have_deno" = "$want_deno" ]; then
    ok "Deno $have_deno (.deno-version)"
  else
    fail "Deno '${have_deno:-unavailable}', but .deno-version wants $want_deno" "Run 'deno upgrade --version $want_deno'"
  fi
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

# Docker: needed for the local database (just db up), the Testcontainers-based tests and the end-to-end stack
# (ADR-0063).
if ! command -v docker >/dev/null 2>&1; then
  fail "docker not found" "Install Docker Engine (or Docker Desktop with WSL integration): https://docs.docker.com/engine/install/"
elif ! docker info >/dev/null 2>&1; then
  fail "docker is installed but the daemon is not reachable" "Start Docker (e.g. 'sudo service docker start', or start Docker Desktop) and make sure your user may access the socket"
else
  ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) (daemon reachable)"
fi

# Docker Compose v2.20 or newer: profiles and `up --wait --wait-timeout`, which just db and just e2e use (ADR-0063).
want_compose="2.20.0"
have_compose="$(docker compose version --short 2>/dev/null | tr -d '[:space:]v' || true)"
if [ -z "$have_compose" ]; then
  fail "the Docker Compose plugin (docker compose) is not available" "Install the Compose plugin $want_compose or newer: https://docs.docker.com/compose/install/linux/ (Docker Desktop includes it)"
elif [ "$(printf '%s\n%s\n' "$want_compose" "$have_compose" | sort -V | head -n 1)" = "$want_compose" ]; then
  ok "Docker Compose $have_compose (just db, just e2e want $want_compose or newer)"
else
  fail "Docker Compose $have_compose, but just db and just e2e want $want_compose or newer" "Update the Compose plugin: https://docs.docker.com/compose/install/linux/"
fi

# curl: the end-to-end stack's health waits and checks (just e2e up, just e2e check).
if ! command -v curl >/dev/null 2>&1; then
  fail "curl not found" "Install curl, e.g. 'sudo apt install curl': just e2e waits for and checks its services with it"
else
  ok "curl $(curl --version 2>/dev/null | sed -n '1s/^curl \([^ ]*\).*/\1/p')"
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

# gh and jq: the GitHub CLI and JSON processor used by the issue, PR and CI workflows.
if ! command -v gh >/dev/null 2>&1; then
  fail "gh not found" "Install the GitHub CLI: https://github.com/cli/cli/blob/trunk/docs/install_linux.md (then run 'gh auth login')"
else
  ok "gh $(gh --version 2>/dev/null | sed -n '1s/^gh version \([0-9][0-9.]*\).*/\1/p')"
fi
if ! command -v jq >/dev/null 2>&1; then
  fail "jq not found" "Install jq, e.g. 'sudo apt install jq': https://jqlang.org/download/"
else
  ok "jq $(jq --version 2>/dev/null)"
fi

# git and the gh-stack extension: native stacked PRs (gh stack init/add/submit/link) need gh-stack, which needs
# git 2.36 or newer and gh 2.0 or newer (#887). gh 2.0 introduced extensions, so a gh that cannot list them is too
# old (or broken). Without gh, its failure above comes first and the extension is checked on the next run.
want_git="2.36.0"
if ! command -v git >/dev/null 2>&1; then
  fail "git not found" "Install git $want_git or newer, e.g. 'sudo apt install git' (gh-stack needs $want_git or newer)"
else
  have_git="$(git --version 2>/dev/null | sed -n '1s/^git version \([0-9][0-9.]*\).*/\1/p')"
  if [ -n "$have_git" ] && [ "$(printf '%s\n%s\n' "$want_git" "$have_git" | sort -V | head -n 1)" = "$want_git" ]; then
    ok "git $have_git (gh-stack wants $want_git or newer)"
  else
    fail "git '${have_git:-unavailable}', but gh-stack wants $want_git or newer" \
      "Install git $want_git or newer, e.g. from the git-core PPA on Ubuntu: https://git-scm.com/download/linux"
  fi
fi
if command -v gh >/dev/null 2>&1; then
  if ! gh_extensions="$(gh extension list 2>/dev/null)"; then
    fail "gh cannot list extensions; gh-stack needs gh 2.0 or newer" \
      "Update the GitHub CLI: https://github.com/cli/cli/blob/trunk/docs/install_linux.md"
  else
    have_stack="$(printf '%s\n' "$gh_extensions" | sed -n 's|^[^\t]*\tgithub/gh-stack\t\([^\t]*\).*|\1|p' | head -n 1)"
    if [ -n "$have_stack" ]; then
      ok "gh-stack $have_stack"
    else
      fail "gh-stack not installed: creating, rebasing and merging native stacked PRs needs it (gh stack init/add/submit/link)" \
        "gh extension install github/gh-stack"
    fi
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
