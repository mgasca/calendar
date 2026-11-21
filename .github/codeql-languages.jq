# Whether a set of changed files changes the inputs of a CodeQL Rust analysis (issue #882, ADR-0046 amendment of
# 2026-11-15; the native entry from #1019). codeql.yml runs it after `.github/ci-changes.jq` on the same input, as
# `jq -c -f .github/codeql-languages.jq --argjson changes "$changes"`, in two places: the CodeQL languages job, for the
# pull request's files, and the reuse step of each Rust entry, for the files between an analysed main commit and the
# pull request's head. tools/delivery-guards tests the two rule files together.
#
# Input:  the input of ci-changes.jq, {"event": "pull_request", "complete": true, "files": [...]}
# Output: {"rust": false, "native": true}
#         one key per Rust entry of codeql.yml (its `gate`): true when that entry's analysis must run; false when main's
#         result for the same inputs can be reused.
#
# Only the Rust analyses are filtered: the others take about a minute and read inputs that no CI path set describes.
# Each entry's input set is a CI job's set from ci-changes.jq, not a copy of it: `rust` (the backend/ workspace) is the
# Backend set, and `native` (the native/ workspace, ADR-0067) is the Native set. ci-changes.jq already answers true for
# a push, schedule, dispatch, an incomplete listing or a change to its own rules. A change to this workflow or this file
# answers true too, so a change to the gate is checked by the analyses it could skip, and main's result is never reused
# across a change to the queries or the workflow.

def rules_files: [".github/workflows/codeql.yml", ".github/codeql-languages.jq"];

any(.files[]; IN(rules_files[])) as $rules
| {rust: ($changes.backend or $rules), native: ($changes.native or $rules)}
