set shell := ["bash", "-euo", "pipefail", "-c"]

# The module's default recipe
[default]
list:
    @just --list m

# Calls Deno directly
inner:
    deno run --quiet tool.ts

# Reaches Deno only through a dependency
built: inner
    echo built

# Reaches Deno through just_executable() and module_path(), as e2e.just's cleanup does
nested:
    #!/usr/bin/env bash
    set -euo pipefail
    {{ quote(just_executable()) }} --justfile {{ quote(justfile()) }} "{{ module_path() }}::inner"

# Mentions Deno without calling it
mentions:
    # deno run would go here
    echo "deno run later" && cat tools/deno.json && just m-deno-test

# A Deno script recipe
script:
    #!/usr/bin/env -S deno run
    console.log("script");

# Calls nothing
quiet:
    echo quiet

# Runs several recipes in order, like just/run.just
[positional-arguments]
run +words:
    echo "$@"
