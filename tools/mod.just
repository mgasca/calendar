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

# Test and lint repo tooling (skill scripts, tools/); test apps run TOOLS_TEST_JOBS at a time (default 4)
test:
    #!/usr/bin/env bash
    set -euo pipefail
    # Each test app compiles and runs on its own, so they run in parallel; each one's output is kept and printed in
    # order afterwards, so the log reads as if they had run one after another (#351, record 0011).
    logs=$(mktemp -d)
    trap 'rm -rf "$logs"' EXIT
    tests=$(find {{ tool_dirs }} -name '*.tests.cs' -not -path '*/fixtures/*' | sort)
    printf '%s\n' $tests | xargs -P "${TOOLS_TEST_JOBS:-4}" -I{} bash -c \
        'log="$2/$(tr / _ <<< "$1")"; dotnet run "$1" > "$log.log" 2>&1 || touch "$log.failed"' _ {} "$logs"
    failed=0
    for t in $tests; do
        log="$logs/$(tr / _ <<< "$t")"
        echo "dotnet run $t"
        cat "$log.log"
        if [ -e "$log.failed" ]; then failed=1; echo "FAILED: $t" >&2; fi
    done
    [ "$failed" = 0 ]
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

# Check that the tools pin each package at one version (--fix to update to the newest pinned)
[positional-arguments]
versions *args:
    dotnet run tools/tool-versions/tool-versions.cs -- "$@"

# Sample a workflow's job and step durations from GitHub (e.g. just tools ci-timings --job Frontend)
[positional-arguments]
ci-timings *args:
    dotnet run tools/ci-timings/ci-timings.cs -- "$@"

# Print new comments, reviews and PR states on an issue and its delivery PRs since the last run (e.g. just tools handover-watch 320)
[positional-arguments]
handover-watch *args:
    dotnet run tools/handover-watch/handover-watch.cs -- "$@"

# Take a delivery-dashboard snapshot, or check snapshot files (e.g. just tools delivery-dashboard snapshot --runs 5, or check FILE)
[positional-arguments]
delivery-dashboard *args:
    dotnet run tools/delivery-dashboard/delivery-dashboard.cs -- "$@"

# Validate ADRs in docs/decisions (e.g. just tools adr --fix-links)
[positional-arguments]
adr *args:
    dotnet run {{ adr_skill }}/scripts/check-adr/check-adr.cs -- "$@"

# Auto-format repo tooling (whitespace; part of just format)
format:
    for d in {{ tool_dirs }}; do dotnet format whitespace --folder "$d"; done
