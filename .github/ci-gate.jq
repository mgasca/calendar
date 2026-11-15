# The run-time gate of ADR 0045 (docs/decisions/0045-run-time-regression-gates-for-ci-jobs.md), run by the
# `CI result` job of ci.yml on this run attempt's jobs API response:
#
#   jq -r -f .github/ci-gate.jq --slurpfile baseline .github/ci-baseline.json --arg event "$GITHUB_EVENT_NAME" jobs.json
#
# It does five things only: classify the run's path, pick the gated jobs, look up each job's threshold, compare, and
# format the messages. With `--arg format summary` it prints a Markdown table for the step summary instead. It exits 1
# (halt_error) only when a pull_request or merge_group run has a job above a pinned threshold; on any other event, and
# on a provisional path, an exceedance is a warning. The thresholds are derived by `tools/ci-timings --baseline`; the
# tests in tools/ci-timings/tests/gate_test.ts run this file.

def clock: round as $s | "\(($s / 60) | floor):\(($s % 60) | if . < 10 then "0\(.)" else tostring end)";
def seconds: (.completed_at | fromdateiso8601) - (.started_at | fromdateiso8601);

($ARGS.named.event // "") as $event
| ($ARGS.named.format // "annotations") as $format
| $baseline[0] as $file
| (any(.jobs[] | select(.name == "Docs site") | .steps[]?;
    .name == "Build and verify publication artifact" and .conclusion == "success")) as $published
| (if $published then "publication" else "check" end) as $path
| ($file.paths[$path] // null) as $base
| ($event == "pull_request" or $event == "merge_group") as $gating
| ($base != null and $base.status == "pinned") as $pinned
| [
    .jobs[]
    | select(.conclusion == "success" and .name != "CI result" and .name != "Cancel superseded runs")
    | (if $base == null then null else ($base.jobs[.name] // null) end) as $entry
    | { name, seconds: seconds, entry: $entry, exceeded: ($entry != null and seconds > $entry.threshold) }
  ] as $results
| ($gating and $pinned and any($results[]; .exceeded)) as $fail
| (if $gating | not then "the gate only reports on a \($event) run"
   elif $pinned | not then "the \($path) baseline is provisional (fewer than \($file.minRuns) runs per job)"
   else "" end) as $reportOnly
| if $format == "summary" then
    "### Job run times on the \($path) path (ADR 0045)\n",
    (if $reportOnly == "" then empty else "Not failing: \($reportOnly).\n" end),
    "| Job | time | threshold | baseline median | n | result |",
    "| --- | --: | --: | --: | --: | --- |",
    ($results[]
      | if .entry == null then "| \(.name) | \(.seconds | clock) | – | – | – | no baseline |"
        else "| \(.name) | \(.seconds | clock) | \(.entry.threshold | clock) | \(.entry.median | clock) | \(.entry.n) |"
          + " \(if .exceeded then "**above the threshold**" else "within" end) |"
        end)
  else
    (if $base == null then "::warning::No baseline for the \($path) path in .github/ci-baseline.json; no job is gated." else empty end),
    ($results[]
      | if .entry == null then
          if $base == null then empty
          else "::warning::\(.name) has no baseline on the \($path) path; it is not gated until the next baseline update."
          end
        elif .exceeded then
          "::\(if $fail then "error" else "warning" end)::\(.name) took \(.seconds | clock) on the \($path) path, above its threshold"
          + " of \(.entry.threshold | clock) (baseline median \(.entry.median | clock), n = \(.entry.n), \($file.record))."
          + (if $fail then " If nothing in this change explains it, use \"Re-run all jobs\"; a second failure is evidence of a regression."
             else " Not failing: \($reportOnly)." end)
        else "\(.name): \(.seconds | clock), within its threshold of \(.entry.threshold | clock) (median \(.entry.median | clock))."
        end),
    (if $fail then "A job took longer than its pinned baseline allows (ADR 0045).\n" | halt_error(1) else empty end)
  end
