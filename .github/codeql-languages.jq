# Which CodeQL languages a run analyses, from the CI rules' decision (issue #882, ADR-0046 amendment of 2026-11-14).
# The Languages job in codeql.yml runs it as `jq -c -f .github/codeql-languages.jq --argjson changes "$changes"`, where
# `$changes` is the output of `.github/ci-changes.jq` for the same input; tools/delivery-guards tests the two together.
#
# Input:  the input of ci-changes.jq, {"event": "pull_request", "complete": true, "files": [...]}
# Output: {"rust": false, "exclude": [{"language": "rust"}]}
#         whether the rust analysis runs, and the matrix entries the analyze job leaves out.
#
# Only the Rust analysis is filtered: the others take about a minute and read inputs that no CI path set describes.
# Rust runs exactly when CI's Backend job does, so the "Rust input" set is the Backend set of ci-changes.jq, not a copy
# of it. ci-changes.jq already runs everything for a push, schedule, dispatch, an incomplete listing or a change to its
# own rules; a change to this workflow or this file runs the Rust analysis too, so the gate is checked by the job it
# could skip.

def rules_files: [".github/workflows/codeql.yml", ".github/codeql-languages.jq"];

($changes.backend or any(.files[]; IN(rules_files[]))) as $rust
| {rust: $rust, exclude: (if $rust then [] else [{language: "rust"}] end)}
