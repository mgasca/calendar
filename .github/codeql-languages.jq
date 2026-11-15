# Whether a set of changed files changes a Rust input of the CodeQL rust analysis (issue #882, ADR-0046 amendment of
# 2026-11-15). codeql.yml runs it after `.github/ci-changes.jq` on the same input, as
# `jq -c -f .github/codeql-languages.jq --argjson changes "$changes"`, in two places: the CodeQL languages job, for the
# pull request's files, and the rust analysis, for the files between an analysed main commit and the pull request's
# head. tools/delivery-guards tests the two rule files together.
#
# Input:  the input of ci-changes.jq, {"event": "pull_request", "complete": true, "files": [...]}
# Output: {"rust": false}
#         true when the Rust analysis must run; false when main's result for the same Rust inputs can be reused.
#
# Only the Rust analysis is filtered: the others take about a minute and read inputs that no CI path set describes.
# The "Rust input" set is the Backend set of ci-changes.jq, not a copy of it. ci-changes.jq already answers true for a
# push, schedule, dispatch, an incomplete listing or a change to its own rules. A change to this workflow or this file
# answers true too, so a change to the gate is checked by the analysis it could skip, and main's result is never reused
# across a change to the queries or the workflow.

def rules_files: []; # throwaway probe for #882: lets this PR take the reuse path

{rust: ($changes.backend or any(.files[]; IN(rules_files[])))}
