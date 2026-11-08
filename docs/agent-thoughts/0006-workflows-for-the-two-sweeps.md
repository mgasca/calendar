---
date: "2026-11-08"
author: "Claude Code (Claude Opus 5.5)"
revision: "d1b1d8c899014a6c82bca2963c5bd13753fb04a1"
---

# 0006 Workflows for the two sweeps

*Written on 8 November 2026 by Claude Code, running the Claude Opus 5.5 model, from revision `d1b1d8c89`. The maintainer asked whether the `issue-sweep` and `adr-sweep` skills could use workflows, and how, with a design and its pros and cons against the status quo. Asked in conversation, the maintainer answered four questions. The sweeps also run in harnesses other than Claude Code, but moving them to Claude Code is acceptable, so the options and trade-offs are below. Each run should cost only what changed since the previous sweep. The mechanical ADR checks belong in `check-adr`, not in agents. The proposal goes here, as a post, like [0003](0003-workflows-and-a-proposal-for-the-first-one.md). Nothing in this post was run. Agent counts and costs are inferred from the skills, the repository's size on that revision and the measurements in [story 0035](../stories/0035-review-before-merge-with-a-workflow-and-a-skeptic-per-finding.md). None of them was measured for a sweep.*

## The short answer

Both sweeps have the shape that workflows are good at: a list of independent items, a judgement per item, and a wrong call that costs more than a second opinion. They are not equally ready for one.

- **The ADR sweep is ready, and it has a known gap that a workflow closes.** The sweep of 2026-11-07 ([story 0045](../stories/0045-resolve-the-adr-sweep-findings-of-2026-11-07.md)) passed every mechanical check, but "the judgement review was selective". One context cannot read 49 records against the repository with care, so the judgement checks (J1 to J7), the ones with the largest payoff, reach only some of the records. One agent per selected record, followed by a skeptic for each finding that would reach the maintainer, fixes that.
- **The issue sweep gains less.** The repository had 12 open issues on this revision, a set one context handles comfortably. What a workflow adds there is the check on a "safe to close" call, because that call is the expensive one to get wrong. The fan-out adds little until the tracker grows.
- **Two changes are worth making first, and neither needs a workflow:** a watermark for both sweeps, so that a run judges only what changed (the dream-weaver pattern from [story 0025](../stories/0025-consolidate-what-agent-sessions-learned-into-guidance.md)), and moving the mechanical ADR checks into `check-adr`, where CI runs them on every PR for free.

## What the sweeps do today

Both skills are a single context that runs a fixed sequence of steps: read from `origin/main`, inventory, check each item, classify, compare with the previous report, hand off. Both are read-only until the hand-off, and both send each hand-off out as its own PR or comment.

The [ADR sweep](https://github.com/mgasca/calendar/blob/main/.claude/skills/adr-sweep/SKILL.md) has a catalogue of fifteen checks. Seven are mechanical (M1 to M7) and eight are judgement checks (J1 to J8). The mechanical checks need the whole inventory at once: supersession chains, model drift, number collisions. The judgement checks are per record. Each one reads a record's Decision Outcome, Consequences and Confirmation, then looks for the things those sections name in the repository. The skill already admits the limit: "on a large log, read the records touched by merged PRs since the previous sweep first, and say in the report which records the judgement checks did not reach."

The [issue sweep](https://github.com/mgasca/calendar/blob/main/.claude/skills/issue-sweep/SKILL.md) reads every open issue's body and comments, its referencing PRs, its children if it is a tracker, and its checklist against `main`, then sorts it into Safe to close, Nearly done or Still open. The hand-off goes to `issue-closeout`, which posts on the issue, writes a card and opens a PR.

## Where they run: three options

Workflows exist only in Claude Code, and the harness loads the agent definitions they call at session start (story 0035 learned this when every skeptic failed with "agent type not found"). [ADR-0044](../decisions/0044-claude-first-agent-automation.md) already settles what is allowed: during the Claude-first period, "skills may require Claude Code mechanisms (loops, scheduled routines, workflows, …) and describe no hand-followable alternative". None of the three options below needs a new ADR. They differ in what the other harnesses keep.

| | A. Workflow as an accelerator | B. Workflow first, by-hand fallback | C. Claude Code only |
| --- | --- | --- | --- |
| The skill says | The steps as today, plus "in Claude Code, step 3 may run the workflow" | "In Claude Code, run the workflow; elsewhere, follow these steps", with the steps kept short | "Run the workflow", with the session's own steps around it |
| Other harnesses | Unchanged | Can still sweep, at today's selective coverage | Cannot sweep |
| Two descriptions to keep in step | Yes, and the prose path is the one people read | Yes, but the fallback is a summary that can lag a little | No |
| Precedent | — | `issue-handover`'s review step (story 0035) | — |

**A** costs nothing and changes nothing elsewhere, but leaves the prose as the main path, so the coverage gain depends on someone choosing the workflow. **C** is the simplest to maintain, but a Codex or Cursor session that is asked "are the ADRs current?" would have nothing to follow. That runs against the "guidance stays readable" half of ADR-0044 even though the rule allows it. **B** is what the review before a merge already does, and it degrades well: the fallback is today's sweep, which works, and the report says which records it did not reach.

**I recommend B.** The skills keep the session's steps (fetch, inventory, delta, report, hand-off) for every harness, and only the per-item judgement moves into the workflow. That is also where the by-hand path is weakest.

## Delta only: what a run judges

The maintainer chose "delta only": judge what changed since the previous sweep, plus a rotating slice of the rest. The rotation matters because both sweeps look for drift. An ADR goes stale when the repository moves, not when the record is edited, and an issue gets finished by commits that never mention it.

**The watermark** sits on the report's last line, as in dream-weaver: the `origin/main` SHA the sweep read, its UTC time, and for the ADR sweep the SHA at which each record was last judged. A run that is given no previous report looks for one in the owning story card and issue comments before it falls back to a full run, as dream-weaver does.

**The ADR delta**, computed by the session before the workflow starts:

1. Records whose file changed since the watermark SHA.
2. Records whose cited tokens changed. A reverse index from each path, command and version that a record names (the tokens J1 already extracts) to `git diff --name-only <watermark>..origin/main`. This is the delta that catches a `make`→`just` change without touching ADR-0011.
3. Records with deferral or trigger phrases (J3), when a story or ADR merged since the watermark, or an issue named in the phrase changed state.
4. Records named by issues or PRs updated since the watermark (M5).
5. **The rotation**: the *k* records judged longest ago, so every record is judged at least every ⌈49 / *k*⌉ sweeps. With *k* = 6 that is every nine sweeps.

The report names the records that were not judged in this run and when each was last judged, so "delta only" never reads as "all checked".

**The issue delta:** issues updated since the watermark, issues referenced by PRs that merged or closed since it, the parents of either, new issues, and a rotation of the issues judged longest ago. An issue outside the delta keeps its class from the previous report, and the report marks it "carried". At 12 issues the delta saves little, so it can wait until the workflow exists.

## Mechanical checks move to `check-adr`

The skill already names M2, M3, M6, M7 (form) and J6 as candidates "once they have produced stable findings for a few sweeps". Four of them can move as they are:

- **M2** (model drift), **M3** (supersession integrity), **M7** (amendment form) and **J6** (story cards cite superseded records) read only files on the branch, so they become `check-adr` rules and fail the PR that introduces the drift, not the next sweep.
- **M6** (number collisions) splits. "A PR adds a number that `main` already has" is a branch check. "Two open PRs add the same number" needs `gh`, which a build check should not call, so it stays a sweep step (one `gh pr list` call in the session).
- **M1**, **M4** and **M5** stay in the session. M1 is a filter on the inventory, M4 is a grep with a one-line read per hit, and M5 needs `gh`.

One more change makes the rest cheaper: `just tools adr --inventory` printing the step 2 inventory as JSON (number, title, status, superseded-by, amendment headings, first date on `main`, model entry, cited tokens). The session then builds the inventory and the reverse index with one command instead of a page of `git log` calls, and the workflow receives the result as `args`.

This part is worth doing even if no workflow follows. It moves five checks from "found at the next sweep" to "refused at the PR", and every harness gets it.

## Design 1: `adr-sweep-judge`

The session does everything that needs the whole picture or writes to GitHub. The workflow does only the per-record judgement and its verification, and returns data. That split is the one story 0035 settled on: "the session posts, not the script".

**The session, before:** fetch, run `check-adr` with `--inventory`, run M1, M4, M5 and the open-PR half of M6, compute the delta, and call the workflow with `{ records: [{ id, path, reasons, checks }], cap }`. `reasons` says why each record is in the delta. That lets the judge start with the token that changed, not read the whole record cold.

**The workflow:**

```js
phase('Judge')
const results = await pipeline(
  args.records,
  (r) => agent(judgePrompt(r), { label: `judge:${r.id}`, phase: 'Judge', schema: RECORD_FINDINGS }),
  (found, r) => pipeline(
    (found?.findings ?? []).filter((f) => f.class !== 'watch'),       // Watch findings are not verified
    (f) => parallel(['true', 'matters'].map((lens) => () =>
      agent(skepticPrompt(r, f, lens), { agentType: 'record-skeptic', phase: 'Verify', schema: VERDICT }))),
  ).then((votes) => ({ record: r.id, found, votes })),
)
```

- **One judge per record**, on the session's model. The reviewers run on Opus because "a missed finding costs more than the tokens", and a judge is a reviewer. It runs the J checks named in `checks` (J1 to J5 by default, J7 when the issue list is short), against `origin/main`, and returns findings with check id, class (Fix now, Decide, Watch), evidence as file:line, and an `inferred` flag.
- **Two skeptics per Fix now or Decide finding.** The lenses are *true* (does the claim hold on `origin/main`?) and *matters* (would a reader of the record act differently?). *Reproduces* has nothing to run for a claim about a document. Both must decline for a finding to be confirmed. As in story 0035, uncertainty refutes and says so, and every refutation reaches the report with its reason.
- **A new `record-skeptic` agent** on Haiku, not the existing `skeptic`. That agent starts from the branch diff and its rules are about tests and suites, so it would need a second mode, and the review before a merge depends on it staying as it is. Adding a definition has a cost that story 0035 already paid for: the first run after the change must start from a fresh session on a checkout that already has the file.
- **A cap, with the overflow logged.** Records are ordered by reason (changed record, changed token, trigger, open work, rotation), the cap applies to judges and skeptics together, and records past the cap are returned as unexamined. They also stay first in line for the next rotation.

**The session, after:** group findings that share a cause across records (story 0045 grouped ADR-0002, 0003, 0026 and 0030 into one finding). The grouping needs every result at once, but it is a cheap read of a small list, so it stays in the session rather than becoming a barrier agent. Then the session compares with the previous report, writes the report and the new watermark, and starts the hand-offs one PR per record, as today.

**Expected size (inferred):** a day's merges touch something like 5 to 15 records through the reverse index, plus 6 in rotation, so about 10 to 20 judges. At the 2026-11-07 sweep's rate of findings (one Fix now and seven Decide records out of 49), that adds perhaps 4 to 10 skeptics. A cap of 40 should rarely bind. The first three runs should record the real counts, tokens and wall-clock time in a benchmark record, as story 0035 did.

### Against the status quo

**Pros**

- **Coverage of the judgement checks becomes systematic.** Every record is judged within a bounded number of sweeps, and the records most likely to have drifted are judged on the day their facts changed.
- **Each record gets a clean context.** A judge reading ADR-0030 has not just read forty other records, so it is less likely to carry one record's facts into another.
- **Fewer false Decide items reach the maintainer.** A Decide finding costs the maintainer a decision, and story 0045 turned seven of them into an epic with seven child issues. A skeptic pass before the report is the cheapest place to drop a wrong one.
- **The report becomes data.** Structured findings make "compare with the previous report" and "no change since" deterministic, rather than one model's reading of two reports.
- **The mechanical half improves for everyone,** because it moves into `check-adr` and CI.

**Cons**

- **More tokens than one context**, even on a delta: roughly 10 to 30 agents a run, against one context today (inferred, not measured). The delta and the cap bound it but do not remove it.
- **Claude Code only for the judgement step.** Under option B, other harnesses keep today's selective sweep.
- **Cross-record judgement gets weaker.** A single context notices that four records share one stale fact. Per-record judges do not, so the grouping step in the session has to do that work, from short findings, not full reads.
- **Two more files to keep:** the workflow and `record-skeptic`, plus a watermark format that the report has to carry exactly.
- **A new failure mode:** a judge or skeptic that dies leaves a record unexamined. The script has to report this, as review-before-merge does, and the reader has to read that line.

## Design 2: `issue-sweep-verify`

**The session, before:** fetch, list the open issues, and classify each one inline as the skill says today. At 12 issues, one context is the right size, and it keeps the cross-issue reading a tracker needs (a parent and its children in one place).

**The workflow** receives only the Safe to close and Nearly done issues with their evidence, and runs two skeptics on each in parallel:

- *done on main*: every checklist item, child and acceptance criterion the evidence cites holds on `origin/main`;
- *nothing left in the thread*: no owner comment after the last delivery asks for more, no child is still open, no question is unanswered.

An issue is handed off only if both decline. A refuted one is reported as Still open, with the skeptic's reason. Still open calls are not verified, because the skill already treats a wrong "still open" as the cheap mistake.

**The session, after:** report, compare with the previous report, and hand off to `issue-closeout` **one issue at a time**. Closeouts write public comments, take story numbers and open PRs. Run in parallel, they would collide on story numbers, which is a lesson this repository has already learned more than once. They stay in the session.

**When to widen it:** once the open-issue count passes about 30, or a sweep starts reporting issues it did not reach, move the classification into the workflow too (one agent per delta issue, in a pipeline with the verification above). Before that, the classify fan-out costs more than it saves.

### Against the status quo

**Pros**

- **A second reading guards the expensive call.** A wrong "safe to close" becomes a public comment, a card and a PR. The skill's own example, a tracker row that said "deferred" for a child that had been delivered, shows how believable a stale claim can be.
- **Small and cheap:** two Haiku skeptics per candidate, usually a handful of agents.
- **It leaves today's sweep as it is,** so the fallback in other harnesses is exactly the current skill.

**Cons**

- **Small value at today's size.** Most sweeps will find zero to three candidates, and the session could re-check those itself in the time the workflow takes to start.
- **Another agent definition**, or a third mode for a skeptic, for a check that a careful session already makes.
- **A refutation can block a real closeout.** Uncertainty refutes, so an issue whose evidence is thin waits a sweep longer. That is the right direction, but the report has to say why.

## Suggested order

1. **`check-adr` gains M2, M3, M7 (form), J6 and the branch half of M6, plus `--inventory`.** No workflow, every harness, value on its own.
2. **Watermark and delta in both skills.** No workflow either. It fixes the cost of re-reading everything and the silent selectivity of the judgement checks.
3. **`adr-sweep-judge` and `record-skeptic`, with the skill moved to option B.** Measure the first three runs.
4. **`issue-sweep-verify`**, when the measurements from step 3 say the skeptic pattern pays for itself on claims about documents, or sooner if a wrong "safe to close" reaches an issue.

Each step is its own issue, and steps 1 and 2 can be delivered in parallel because they touch different files. The skill text changes in steps 2 and 3 should be stacked, since both rewrite step 3 of `adr-sweep`.

## What this post can't tell you

- Whether the sweeps currently run as scheduled routines, and if so, whether the Workflow tool and newly added agent definitions are available in that environment. Story 0035 ran its workflow only from interactive sessions. Check this before step 3, because a routine that cannot start the workflow falls back to option B's prose path without saying so unless the skill tells it to report that.
- The real cost of a judge per record. The ranges above come from the size of the log and the review workflow's measurements, not from a run.
- Whether skeptics are as good at refuting claims about documents as they are at refuting claims about code. The human check of refutations that story 0035 keeps as a standing item is the evidence to watch.
