# Shared by every module through `import` (ADR-0038 amendment). An imported recipe belongs to the
# importing module, so `just backend run build test` runs backend::build, then backend::test.

# Run several of this module's recipes in order, stopping at the first failure (e.g. just backend run build test)
[positional-arguments]
run +words:
    #!/usr/bin/env bash
    set -euo pipefail
    # Leading words that start with - are just options for every call (run -n build test; an option
    # with a value uses the = form). Then come the recipe names. From the next word that starts
    # with -, the words are arguments of the last recipe (run restore build test --project X).
    # A -- after the names ends them, and is dropped, so an argument need not start with -
    # (run build start -- Development); a second -- reaches the recipe.
    options=()
    while [[ $# -gt 0 && $1 == -* && $1 != -- ]]; do options+=("$1"); shift; done
    names=()
    while [[ $# -gt 0 && $1 != -* ]]; do names+=("{{ module_path() }}::$1"); shift; done
    if [[ ${#names[@]} -eq 0 ]]; then
        echo "error: name at least one recipe: just {{ module_path() }} run [options] <recipe>... [--] [arguments]" >&2
        exit 2
    fi
    if [[ $# -gt 0 && $1 == -- ]]; then shift; fi
    run() { {{ quote(just_executable()) }} --justfile {{ quote(justfile()) }} "${options[@]}" "$@"; }
    # Each recipe runs in its own just call, so one that takes *args cannot swallow the names after
    # it. Check every name first, as a native multi-recipe call does, so a typo runs nothing.
    for name in "${names[@]}"; do
        if ! run --show "$name" > /dev/null; then
            echo "hint: put an argument that does not start with - after --: just {{ module_path() }} run <recipe>... -- <argument>" >&2
            exit 1
        fi
    done
    last=$((${#names[@]} - 1))
    for i in "${!names[@]}"; do
        if [[ $i -lt $last ]]; then run "${names[$i]}"; else run "${names[$i]}" "$@"; fi
    done
