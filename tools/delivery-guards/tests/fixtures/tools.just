tool_dirs := "tools"

# Test and lint repo tooling
test:
    #!/usr/bin/env bash
    printf '%s\n' {{ tool_dirs }} | xargs -P "${TOOLS_TEST_JOBS:-4}" -I{} bash -c 'just tools deno-test "$1"' _ {}
