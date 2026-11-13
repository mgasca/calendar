tool_dirs := "tools"

# Test and lint repo tooling
test:
    #!/usr/bin/env bash
    printf '%s\n' $tests | xargs -P "${TOOLS_TEST_JOBS:-4}" -I{} bash -c 'dotnet run "$1"' _ {}
