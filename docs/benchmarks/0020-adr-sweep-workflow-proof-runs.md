---
subject: "The ADR sweep workflow and the issue verification workflow: three measured runs, a seeded run past the caps, a judge or skeptic that returns nothing, and two issue verification runs (story 0051)"
harness: ".claude/workflows/adr-sweep-judge.js"
---

# 0020 Proof runs of the ADR sweep and issue verification workflows

- **Date:** 2026-11-09
- **Issue:** [#559](https://github.com/mgasca/calendar/issues/559), story [0051](../stories/0051-sweep-only-what-changed-and-check-each-finding.md), criteria 7, 8, 9, 10, 12 and 13. Criterion 11 (the scheduled routine) is not in this record; see "Not measured".
- **Harness:** `.claude/workflows/adr-sweep-judge.js` and `.claude/workflows/issue-sweep-verify.js`, run with Claude Code's Workflow tool as scratch copies (see "What differed from the plan"). Agent counts, tokens and durations are the figures the Workflow tool reported for each run (`agent_count`, `subagent_tokens`, `duration_ms`).
- **Swept commit:** `c534cad28` (`origin/main` at 2026-11-09 18:40Z, the whole session). 50 records, `just tools adr` passing.
- **Machine:** one laptop, one session, runs one after the other except where stated. Each result is one run: these check behaviour and cost, so there is no spread to report.

## What differed from the plan

Read this first: the figures are not those of the committed scripts run as committed.

- **The agent types did not resolve.** `sweep-judge` and `sweep-skeptic` exist in `.claude/agents/` on `main`, but the session's agent registry did not list them ("Agent type not found"). Every agent below is a `general-purpose` agent on Sonnet (select and judges) or Haiku (skeptics) with the body of the agent definition prepended to its prompt, so the ground rules were the same text but the tool restriction (read-only `Read, Grep, Glob, Bash`) was not enforced by the harness. The cause is probably the one story 0035 found: the harness reads `.claude/agents/` from the repository root checkout, and the root checkout was on `097a86604` (#569), which has only the four older agents. This is inferred; the registry was not inspected. Whether the real agent types change cost or answers is **not measured**.
- **The committed workflow throws.** The first run (below) lost 19 finished agents to a `TypeError` in `adr-sweep-judge.js`, after every judge had returned (issue [#624](https://github.com/mgasca/calendar/issues/624)). The runs below use a scratch copy with the fix of [#626](https://github.com/mgasca/calendar/pull/626) plus an equivalent `async`/`await` rewrite of `verifyFinding` and `verifyAll` that was not needed and is not in #626.
- **The inventory was shortened by hand.** `just tools adr --inventory` printed 50 records. To fit the call, the cited-token lists passed as `args` were shortened by hand, dropping the generic and repeated tokens. This changes which records the select agent can match to a changed path, so the delta of run 1 (94 changed files) is not exactly what the full inventory would give. The later runs had no changed files, so only run 1 is affected.
- **No M4, M5, J7 or J8** ran in the three measured runs; only `just tools adr` (M1 counts, M2, M3, M6 branch half, M7 form, J6) ran in the session, once.

## Criterion 13: three measured runs

Run 1 was given the previous report's watermark and its 29 left-over records (the by-hand Codex sweep of `2026-11-09T0844Z`, merged in #585). Runs 2 and 3 were given the watermark and left-over list of the run before, as the skill says. Reports: [#627](https://github.com/mgasca/calendar/pull/627), [#628](https://github.com/mgasca/calendar/pull/628) and [#629](https://github.com/mgasca/calendar/pull/629).

| Run | Agents (select + judges + skeptics) | Tokens | Wall clock | Records judged / in delta | Confirmed | Refuted | Unexamined | Watch | Left over |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| Aborted attempt, committed script | 30 launched, 19 finished | 1,624,089 | 1:47 | none returned | – | – | – | – | – |
| 1 (18:47Z) | 38 (1 + 13 + 24) | 2,307,173 | 2:30 | 13 / 43 | 9 | 3 | 0 | 11 | 30 |
| 2 (18:51Z) | 24 (1 + 13 + 10) | 1,426,200 | 1:24 | 13 / 36 | 3 | 2 | 0 | 21 | 23 |
| 3 (18:53Z) | 28 (1 + 13 + 14) | 1,676,734 | 1:32 | 13 / 29 | 3 | 4 | 0 | 13 | 16 |
| Runs 1 to 3 | 90 | 5,410,107 | 5:26 | 39 judgements, 27 distinct records | 15 | 9 | 0 | 45 | – |

All figures measured, one run each. The wall clock of a run grows with the number of findings, because a finding's two skeptics start after its judge returns. Cost per judged record: 177,000 (run 1), 110,000 (run 2) and 129,000 (run 3) tokens.

**Coverage against the 2026-11-07 by-hand sweep.** The sweep of `52c667e65` ([card 0045](../stories/0045-resolve-the-adr-sweep-findings-of-2026-11-07.md)) says its "judgement review was selective" and gives no count of records judged, so a number cannot be compared; its seven Decide findings became seven issues, and no skeptic checked them. The by-hand sweep of `2026-11-09T0844Z` (Codex, [#585](https://github.com/mgasca/calendar/pull/585)) is the nearest by-hand figure: it judged 20 of 49 records (0000 to 0019) in one run, found 3 Decide (0008, 0016, 0018) and 4 Watch, had no skeptic pass and no cost figure, and left 29 over. The workflow judged 13 per run at the default caps, with two skeptics on each Fix now or Decide finding. Together with the Codex run, the four runs have judged 41 of 50 records (0000 to 0040); 0041 to 0049 are still never judged. No paired by-hand run was made, as agreed, so the by-hand side has no token figure.

Two comparisons that can be made from the reports:

- **What the skeptics refused.** 24 Fix now or Decide findings went to skeptics over the three runs; 15 were confirmed and 9 (37.5%) refuted. A person has not yet checked those 9; [report 1](https://github.com/mgasca/calendar/pull/627) says one of them (0023, a stale "Make interface" citation) reads as a real, lower-class finding. The skeptics disagreed between runs: the 0010 finding "`pnpm peers check` is named in Confirmation but nothing runs it" was confirmed in runs 1 and 3 and refuted in run 2 (*matters*: the sentence reads as a one-time observation). That is variance of a Haiku skeptic on one lens, measured on one finding.
- **Overlap with the Codex run.** Both found the Playwright deferral of 0008 (J3); the workflow classed it Watch where Codex said Decide. The workflow's Decide findings on 0009 (StyleCop adopted through ADR-0036) and 0010 (`pnpm peers check`) are not in the Codex report, which does not mention 0009. 0016 and 0018, which Codex flagged as Decide, were not judged by the three runs. The seeded run below judged both for J2 only: it re-found Codex's 0018 J2 finding (the round-trip tests are in the API suite, not Infrastructure), and the skeptics refuted it; it found nothing on 0016 (whose Codex finding is J1).

**The rotation repeated itself.** Runs 1 to 3 judged 0002, 0004, 0007, 0008, 0009 and 0010 every time, because the watermark's `judged=` groups carry a date and every record outside the delta carried 2026-11-09; ties go to the lowest number. Six of 13 slots per run were repeats. Filed as [#625](https://github.com/mgasca/calendar/issues/625). Across days the rotation behaves as designed.

## Criterion 9: a seeded run past the caps

Seeded with `records`: 25 records given in the order 14 `changed-token` records, 5 `left-over` records, then 6 `rotation` records, `k = 6`, J2 only, default caps. The rotation records were given last on purpose.

| Check | Result (measured) |
| --- | --- |
| The 6 rotation records are admitted first | Yes: 0011, 0013, 0014, 0015, 0016, 0018 head the judged list although given last |
| The left-over records come next | Yes: 0041 to 0045 |
| Then the selected records, in the given order | 0046 and 0047 (2 of 14) |
| The rest come back as left over, with the cap as the reason | Yes: 0048, 0049, 0000, 0001, 0003, 0005, 0006, 0012, 0017, 0019, 0021, 0022, each "past the run cap of 40 agents" |
| The log names the shortfall | `run cap 40: judging 13 of 25 records; 12 left over for the next run: 0048, 0049, ...` |
| Totals | 19 agents (13 judges, 6 skeptics), 1,196,729 tokens, 1:33; 2 confirmed, 1 refuted, 0 unexamined |

The per-record cap of 12 agents was not reached by any record (the most any record produced was one finding), so findings past the record cap were **not** exercised here; the stub run for #626 reached the run cap for findings (1 finding unexamined past the run cap) but not the record cap.

## Criterion 10: a judge or skeptic that returns nothing

Seeded on a scratch copy in which `agent()` returns `null` (what the Workflow tool documents for a skipped or dead agent) for the judge of record 0035 and for every *matters* skeptic, with 3 records given and J2 only.

| What returned nothing | Result (measured) |
| --- | --- |
| The judge of 0035 | The record is in `leftOver` with `why: "the judge returned nothing"`, not in `judged`, not passed |
| The *matters* skeptic of the 0010 and 0021 findings | Both findings are `unexamined` with `why: "a skeptic returned nothing"`; the *true* skeptic's answer is kept in `votes`; neither is confirmed or refuted |
| Totals | 4 agents answered of 7 launched; 240,342 tokens; 1:06 |

The `null` is injected by the scratch copy, not by a failing harness, so this checks the script's handling, not the harness's behaviour when an agent dies. Record [0018](0018-review-before-merge-cap-and-dying-reviewer.md) used a real unknown agent type for the equivalent check on the review workflow.

## Criterion 12: the issue verification workflow

No real hand-off candidate existed on 2026-11-09: the delivered #601 had an open card PR, #623's fix is in that open PR, and #592 and #593 are undone. The sweep ([#630](https://github.com/mgasca/calendar/pull/630)) therefore handed nothing to verification. Both runs below use **seeded candidate lists**.

| Run | Candidates (class) | Result (measured) | Agents | Tokens | Wall clock |
| --- | --- | --- | --: | --: | --: |
| A | #580 (safe to close), #623 (safe to close), #601 (nearly done) | 0 handed off, 3 refuted | 6 | 402,769 | 1:25 |
| B | #562 and #572, both already closed and delivered (safe to close) | 2 handed off, 0 refuted | 4 | 281,018 | 0:48 |

- **Refuted, with reasons the session could check:** #623 by both skeptics (the fix is in PR #622, which is open and does not contain it); #601 (the card PR's Docs site job fails on Prettier, which is the defect #623 describes); #580 by *done on main* (its own body makes a recorded run from a fresh session part of the item, and none was on `main`). All three reasons held when read.
- **Handed off:** #562 and #572, both seeded. No `issue-closeout` ran, because both issues were already closed; this checks the verification and the hand-off list, not the closeout. A real hand-off has not been observed.

## Criterion 8: the by-hand path

Not run in this session. The merged report [`2026-11-09T0844Z`](https://github.com/mgasca/calendar/pull/585) is a run of `adr-sweep` by another harness (Codex): it says "Path: by hand (Codex); no Workflow tool or skeptic pass", marks its findings unverified, names the records it did not reach (0020 to 0048) and leaves them as left over. That is the evidence for criterion 8. A later by-hand run on a harness without the Workflow tool has not been made.

## Not measured

- **Criterion 11**, a run inside the scheduled mj routine on Claude Code, is the maintainer's to run; the card says what to send back.
- The real `sweep-judge` and `sweep-skeptic` agent types (see "What differed from the plan").
- A run that reaches the per-record cap of 12 agents, and a real agent that dies.
- Whether Sonnet judges miss findings that matter: there is no paired by-hand judgement of the same records.

## Reconsider when

- The agent types resolve in a session and a run of the committed scripts differs from these figures by more than the spread of the three runs above.
- The default caps change: 13 records per run and about 1.4 to 2.3 million tokens per run are the figures to compare against.
- Several sweeps run per day and [#625](https://github.com/mgasca/calendar/issues/625) is still open.
