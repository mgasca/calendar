---
subject: "The narrative panel workflow: part reads and tokens of the rebuttal round before and after telling rebuttals to re-read only the parts a peer cites (story 0063)"
harness: ".claude/workflows/narrative-panel.js"
---

# 0022 Narrative panel rebuttal part reads

- **Date:** 2026-11-13
- **Issue:** [#708](https://github.com/mgasca/calendar/issues/708), PR [#716](https://github.com/mgasca/calendar/pull/716), story [0063](../stories/0063-build-architecture-narratives-with-an-expert-panel.md). The question came from a low `review-before-merge` finding on #716: each rebuttal agent starts with a fresh context and its prompt listed every part again, so part reads per phase could roughly double. That estimate was inferred from the code, not measured.
- **Harness:** `.claude/workflows/narrative-panel.js`, run with Claude Code's Workflow tool as scratch copies (see "What differed from the plan"), on the fixture narrative `tools/narrative-panel/tests/fixtures/school-library/` (three parts of 8 to 14 lines). Tokens, tool uses and durations are the figures the Workflow tool reported for each run (`subagent_tokens`, `tool_uses`, `duration_ms`). Part reads are the distinct `Read` tool calls on a fixture part in each agent's transcript.
- **Before:** the workflow at `ea377ceee`. **After:** the workflow at `dc7c8bc36`, whose rebuttal prompt still lists the parts but says "Your first answer already reflects these parts: do not re-read them all. Re-read a part only when a peer's point cites it or turns on what it says, and only that part." The first-round prompt is the same in both.
- **Arguments (both runs):** phase `review`; three experts: `availability` (characteristic, with a requirement and a target), `end-user` and `business`; map: availability/business conflict, end-user/availability synergy, end-user/business neutral; focus "Act 3 review of the draft". The rebuttal round therefore had three agents: availability (two peers), end-user (one) and business (one).
- **Machine:** one laptop, one session, the before run and then the after run, a few minutes apart. Each figure is one run; there is no spread to report.

## What differed from the plan

Read this first: the figures are not those of the committed script run exactly as committed.

- **The agent type did not resolve.** The session started before `.claude/agents/narrative-expert.md` existed, so `agentType: 'narrative-expert'` was not in its registry. A first attempt with the committed script failed all three agents in 71 ms, before any model call. Every agent below is a `general-purpose` agent with `model: 'sonnet'` and the body of the agent definition prepended to its prompt. The copy was made mechanically: `EXPERT` becomes `'general-purpose'`, a `PREAMBLE` constant holds the agent body, and the two `agent()` calls get `PREAMBLE + '\n\n' +` and `model: 'sonnet'`. Validation, routing and prompts are otherwise byte-identical. The read-only tool restriction (`Read, Grep, Glob`) was in the prompt but not enforced by the harness. Proving the real agent type end to end was deferred to the first call in #709 or #711, as the maintainer decided on #716.
- **Not alternated.** The README asks for A, B, A, B. One run of each was made, because each costs about 300,000 tokens and the quantity that matters (part reads in the rebuttal round) is a count, not a timing. The control below stands in for the repetition.

## Results

| | Before (`ea377ceee`) | After (`dc7c8bc36`) |
| --- | --: | --: |
| Part reads, round 1 (control: the change does not touch this prompt) | 9 (3 per expert) | 9 (3 per expert) |
| Part reads, rebuttal round | 2 (business only; availability and end-user read none) | 0 |
| Agents | 6 | 6 |
| Subagent tokens | 295,362 | 290,476 (−1.7 %) |
| Tool uses | 20 | 18 |
| Wall clock | 40.9 s | 32.1 s |

All figures measured, one run each. The control held: round 1 read every part in both runs.

For scale, the first `questions` run on the fixture at `ea377ceee` took 6 agents, 306,874 tokens, 24 tool uses and 46.6 s.

## Insights

- **The doubling did not happen.** Before the change, two of the three rebuttal agents already relied on their first answer, which the prompt includes, and read no part. Only the business expert re-read, two of the three parts. The finding's mechanism was real, but its size was overstated.
- **The fix removes what was left.** After the change no rebuttal agent read a part. The test `rebuttals re-read only the parts a peer cites; round 1 reads them all` in `tools/narrative-panel/tests/narrative-panel_test.ts` keeps the instruction in the rebuttal prompt and out of round 1. It fails against `ea377ceee`.
- **Tokens are dominated by something else.** With three short parts, part reads are a small share of a run. Each of the 6 agents loads its system context, the role brief and the structured-output schema, and each rebuttal carries its peers' answers as JSON. The −1.7 % cannot be told apart from run-to-run variation with one run of each, so it is not evidence of a saving at this size. The saving scales with part length times the number of rebuttals, at most 7 for a full panel. It should be visible on a real narrative, where an Act 3 review reads four parts of a few hundred lines each, but that is inferred.
- **Wall clock fell 22 %, in one pair of runs.** That is consistent with fewer tool round trips, but the size of the drop is not attributable from one pair.
- **Answers were not weakened in this pair.** After the change, the rebuttals still answered each peer with a stance and a point and cited parts by path from their first answer. That was checked by reading the two results, not scored.

## Reconsideration

Measure again, with the real `narrative-expert` agent type, at the first real Act 3 review (the Calendar narrative of #711): part reads and tokens of the rebuttal agents against round 1, on parts of real length. Revisit the instruction if either of these happens:

- the rebuttals miss evidence a peer's point depends on, such as a claim about a part they did not re-read;
- rebuttal agents read whole parts again despite the instruction.
