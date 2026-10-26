#!/usr/bin/env bash
# Verifies the local toolchain matches the versions pinned in the repo.
# Prints a fix hint for each problem and exits non-zero if any are found.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

if [ "$problems" -gt 0 ]; then
  echo "Found $problems problem(s). See the README 'Prerequisites' section."
  exit 1
fi
echo "Toolchain OK."
