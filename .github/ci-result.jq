# The jobs API check of `CI result` (story 0066, #368, #782), run by ci.yml on one read of this run attempt's jobs:
#
#   jq -r -f .github/ci-result.jq --argjson skipped "$SKIPPED" --argjson waited "$SECONDS" read.json
#
# `skipped` lists the jobs the Changes job skipped (ADR-0046) and `waited` is how many seconds the step has been
# reading the API. A read that failed is passed as `{}`. The first line printed is the verdict; the lines after it are
# what the step prints:
#
#   pass  every other job succeeded or was skipped by Changes.
#   fail  a completed job did not succeed (at once, without waiting); or a job still shows as not completed, or the
#         API could not be read, after `limit` seconds (default 120).
#   wait  a job still shows as not completed, or the API could not be read, and fewer than `limit` seconds have passed.
#
# Every job listed here is in `needs` (the ci-result-needs-all guard), so by the time this runs a job shown as running
# has finished and the API has not caught up yet (run 43474865497): that waits instead of failing. `CI result` itself
# and the optional Cancel superseded runs are not checked. The tests in tools/ci-timings/tests/result_test.ts run
# this file.

def line: "\(.name): \(.status) \(.conclusion)";

($ARGS.named.skipped // []) as $skipped
| ($ARGS.named.waited // 0) as $waited
| ($ARGS.named.limit // 120) as $limit
| if (.jobs | type) != "array" then
    if $waited < $limit then "wait", "The jobs API could not be read; reading it again."
    else "fail", "::error::The jobs API could not be read for \($limit) s."
    end
  else
    [
      .jobs[]
      | select(.name != "CI result" and .name != "Cancel superseded runs")
      | select(.conclusion != "success")
      | select(.conclusion != "skipped" or (.name | IN($skipped[]) | not))
    ] as $others
    | ($others | map(select(.status == "completed"))) as $failed
    | ($others | map(select(.status != "completed"))) as $pending
    | if ($failed | length) > 0 then
        "fail", "::error::The jobs API reports jobs that did not succeed:", ($failed[] | line)
      elif ($pending | length) == 0 then
        "pass"
      elif $waited < $limit then
        "wait", "The jobs API does not show these jobs as completed yet; reading it again:", ($pending[] | line)
      else
        "fail",
        "::error::The jobs API had not caught up: \($limit) s after every needed job finished, it still shows these jobs as not completed. Rerun this job; no new commit is needed.",
        ($pending[] | line)
      end
  end
