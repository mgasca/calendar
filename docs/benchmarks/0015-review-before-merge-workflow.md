---
subject: "The review-before-merge workflow: what three skeptics per finding add to the two reviewers (#390)"
harness: ".claude/workflows/review-before-merge.js"
---

# 0015 What three skeptics per finding add to the review before a merge

- **Date:** 2026-11-07
- **Issue:** [#390](https://github.com/mgasca/calendar/issues/390), story [0035](../stories/0035-review-before-merge-with-a-workflow-and-a-skeptic-per-finding.md); workflow delivered by [#403](https://github.com/mgasca/calendar/pull/403), skeptic agent by [#405](https://github.com/mgasca/calendar/pull/405)
- **Harness:** `.claude/workflows/review-before-merge.js`, run with Claude Code's Workflow tool on the checked-out head of each PR, no arguments (cap 60 agents). Main's copy of the script was run from a scratch path, because the three PRs' branches predate it; it reviews whatever is checked out.
- **Commit of the harness:** `d375490a` (main, the merge of #403)
- **Machine:** one laptop, WSL2, 12 CPUs; other load not controlled. The session model was Claude Fable 5.1 for the run on #392 and Claude Opus 5.5 for #395 and #398 (the maintainer switched it between them), and agents inherit it, so the first row is not strictly comparable with the other two. The harness caps concurrent agents at ten on this machine.
- **Iterations:** one run per PR, on three real code PRs of one stack: [#392](https://github.com/mgasca/calendar/pull/392) (head `28ba9deb`), [#395](https://github.com/mgasca/calendar/pull/395) (`cf7b1534`) and [#398](https://github.com/mgasca/calendar/pull/398) (`41b85088`). One run each is the number criterion 7 of the story asks for, not a sample with a spread.

## What was measured, and why

The review step before a merge already ran the two reviewer agents in parallel. The workflow keeps that and adds three skeptics per finding, started as each reviewer returns. The question is what the skeptics cost in minutes and tokens, and what they changed about the findings a person reads.

**Before** is the two reviewers in parallel with no skeptics: its wall-clock is the slower reviewer's duration. It was measured inside the same run, from the reviewers' own transcripts, not in a separate run, so both sides saw the same revision, the same machine load and the same model. **After** is the whole run, from the workflow's start to its last agent's last message. Durations come from the `timestamp` fields of each agent's transcript; the run's start was noted just before it launched. Tokens are the harness's own count of subagent tokens for the run.

The control is the reviewers themselves: the workflow does not change what they are asked, so their findings and durations are what the two-reviewer step would have produced.

## Results

| PR | Before: slower reviewer | After: whole run | Added by skeptics | Agents | Subagent tokens | Findings | Confirmed | Refuted |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| #392 | 145 s | 221 s | 76 s | 8 | 241,087 | 2 | 2 | 0 |
| #395 | 58 s | 85 s | 27 s | 5 | 114,734 | 1 | 1 | 0 |
| #398 | 127 s | 165 s | 38 s | 11 | 254,876 | 3 | 3 | 0 |

Measured. The other reviewer took 62 s, 38 s and 47 s. Skeptics took 27–68 s, 13–17 s and 14–29 s each; all of one finding batch started together, and every batch fit under the concurrency cap.

- **Time.** The skeptics added 27–76 s to each review, a factor of 1.3 to 1.5 over the slower reviewer. The added time follows the slowest skeptic of the last batch, not the number of findings: #398 had the most findings and the second-smallest addition.
- **Tokens.** Not measured for the reviewers alone; the run total includes both. Inferred from the agent count, the skeptics are about half of each run's tokens.
- **Findings.** All six were confirmed and none refuted, so the first ten refutations the story asked a person to check do not exist yet. Three skeptic votes were refutations of a severity rather than of a claim: on #392 finding 1 and #398 finding 1 the *matters* skeptic argued medium down to low, and on #398 finding 2 the *true* skeptic confirmed the mechanism but corrected the line number. A two-of-three vote confirmed each, and the dissenting reason is posted with it, so the person reading the PR sees both.
- **Repeats across a stack.** The baseline tool's extra API calls were reported on #392 and again on #395 and #398, which inherit the file. The session posted it once, on #392, and named the repeats in the other run notes. One finding of #395's code (an extra checkout step in the CI result job) was reported only by the run on #398, which reviews #395's change as part of its stack; it was posted on #395.

## Runs before these

Four runs on #403 itself, while the workflow was built, are recorded on the [story card](../stories/0035-review-before-merge-with-a-workflow-and-a-skeptic-per-finding.md) and are not comparable: run 1 (301 s, 14 agents, 4 of 4 confirmed, all four about the script) predates the read-only skeptic agent, and runs 2 to 4 had every skeptic call fail because the agent definition was not loaded.

## Limits

- One run per PR, on one machine under uncontrolled load, with two models across the three runs. The spread between runs on the same revision is unknown; agent durations are dominated by the model's reading and tool calls, which vary.
- All three PRs come from one stack in one tool, so the findings are similar in kind. A backend or frontend change would give different reviewer durations and could give refutations.
- No refutation happened, so the record says nothing yet about how often skeptics are wrong. That check is deferred to the first ten refutations, whenever they occur (see the card's follow-ups).

## When to measure again

When the first refutations occur; when the skeptic agent or the cap changes; or if the added time passes the slower reviewer's own duration on a typical PR (today it is 0.3 to 0.5 of it).
