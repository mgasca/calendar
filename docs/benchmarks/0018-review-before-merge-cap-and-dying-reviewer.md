---
subject: "The review-before-merge workflow: the agent cap and a reviewer that dies (#410)"
harness: ".claude/workflows/review-before-merge.js"
---

# 0018 The agent cap and a reviewer that dies in the review before a merge

- **Date:** 2026-11-08
- **Issue:** [#410](https://github.com/mgasca/calendar/issues/410), story [0035](../stories/0035-review-before-merge-with-a-workflow-and-a-skeptic-per-finding.md); follows [record 0015](0015-review-before-merge-workflow.md), which could not exercise these paths.
- **Harness:** scratch copies of `.claude/workflows/review-before-merge.js` run with Claude Code's Workflow tool. Copy A changes nothing but is run with `args: { cap: 8 }`. Copy B changes one line: the second reviewer's agent type is `no-such-reviewer`. The copies are not kept; each differs from the script on `main` by that line or that argument.
- **Subject of the review:** one uncommitted file with seeded defects (an anonymous endpoint, SQL built from the query string, a query per task owner, an unbounded in-memory result), never wired into the app and never committed.
- **Iterations:** one run of each copy. These check behaviour, not time, so there is no spread to report.

## What was checked, and why

Criterion 3 of the story (the cap, severity-first order under it, the "past the cap" log line) and criterion 2 (a reviewer that fails) had not run on a real branch, because no run in record 0015 passed three findings or lost a reviewer.

## Results

**The cap (copy A, `cap: 8`)** — measured.

- 8 agents ran: the 2 reviewers and 6 skeptics, so the ceiling held. Two findings were judged, three skeptics each.
- Both judged findings came from the security reviewer, which returned first and took every skeptic slot. Its third finding (a `critical`) and all four of the performance reviewer's findings (three `high`, one `low`) were returned as unexamined, five in all.
- The log named the shortfall for each reviewer ("judging N, leaving M past the cap of 8 agents").
- **Order is per reviewer, not global.** Severity-first holds inside each reviewer's batch, but the budget goes to whichever reviewer returns first, so a `critical` from the slower reviewer can be left unexamined while the faster one's findings are judged. This is what criterion 3 says ("each reviewer's findings are judged as it returns"); the unexamined list is the safeguard, and the session posts it by name.

**A reviewer that dies (copy B)** — measured.

- The run completed: 17 agents, 16 finished, 1 error (the unknown agent type). The performance reviewer's 5 findings were all judged (15 skeptics).
- The result lists the failed reviewer with status `returned nothing` and a count of 0, and the log said `no-such-reviewer returned nothing`. A reviewer that ran and found nothing has status `reported` and a count of 0, so the two are told apart.
- **The reason is not in the result.** "agent type not found" appears only in the harness's own failure notice. The session must copy it into the post when it names the failed reviewer.

**Refutations (not the criterion-7 check).** Both runs produced refutations, 7 of 7 judged findings, but all for the same reason: the skeptics found the seeded file untracked and never mapped. They disagreed with severity and reachability, not with the code pattern. These are artefacts of a scratch subject and are not counted toward the first ten real refutations a person is to check.

## Limits

- One run each, on a seeded subject. The reviewers' findings are not a sample of real ones.
- The cap run used `cap: 8` to reach the path; the default of 60 was not reached.

## When to measure again

When the first ten real refutations occur (the human check of criterion 7); when the cap, the budget rule or the failure handling changes.
