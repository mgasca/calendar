# Repo tooling recipes (`just tools <recipe>`): .NET file-based apps kept in their skill folder or
# tools/<name>/ (ADR-0017), and the doctor script. They run at the repo root.

set shell := ["bash", "-euo", "pipefail", "-c"]
set working-directory := '..'

import '../just/run.just'

adr_skill := ".claude/skills/adr-draft"
run_skill := ".claude/skills/run-calendar"
tool_dirs := adr_skill + " " + run_skill + " tools"
shell_tools := "tools/doctor/doctor.sh"

# List this module's recipes
[default]
[private]
list:
    @just --list tools

# Test and lint repo tooling (skill scripts, tools/)
test:
    #!/usr/bin/env bash
    set -euo pipefail
    for t in $(find {{ tool_dirs }} -name '*.tests.cs' -not -path '*/fixtures/*' | sort); do
        echo "dotnet run $t"
        dotnet run "$t"
    done
    for d in {{ tool_dirs }}; do
        echo "dotnet format whitespace $d"
        dotnet format whitespace --folder --verify-no-changes "$d"
    done
    if command -v shellcheck >/dev/null 2>&1; then
        echo "shellcheck {{ shell_tools }}"
        shellcheck {{ shell_tools }}
    elif [ -n "${CI:-}" ]; then
        echo "shellcheck is required in CI" >&2
        exit 1
    else
        echo "shellcheck not installed: skipped locally (CI runs it)"
    fi

# Check tooling package pins match backend/Directory.Packages.props (--fix to update)
versions *args:
    dotnet run tools/tool-versions/tool-versions.cs -- {{ args }}

# Sample a workflow's job and step durations from GitHub (e.g. just tools ci-timings --job Frontend)
ci-timings *args:
    dotnet run tools/ci-timings/ci-timings.cs -- {{ args }}

# Print new comments, reviews and PR states on an issue and its delivery PRs since the last run (e.g. just tools handover-watch 320)
handover-watch *args:
    dotnet run tools/handover-watch/handover-watch.cs -- {{ args }}

# Validate ADRs in docs/decisions (e.g. just tools adr --fix-links)
adr *args:
    dotnet run {{ adr_skill }}/scripts/check-adr/check-adr.cs -- {{ args }}

# Auto-format repo tooling (whitespace; part of just format)
format:
    for d in {{ tool_dirs }}; do dotnet format whitespace --folder "$d"; done
