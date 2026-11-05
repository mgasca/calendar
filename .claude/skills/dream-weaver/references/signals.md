# Signals: how to find the minute a lesson was paid for

Transcripts are long and mostly routine. The lessons sit at a few points: where a person corrected the agent, where the agent reversed itself, where a mechanical thing went wrong twice, and where something surprised everyone. Search for those points; read around them.

## Search tools

- `read_session(session_id, role: "user")` returns the user's messages only: the cheapest and strongest triage, because corrections, approvals, "is any work remaining?" and `resume` are all user messages. Read it for every session in the window before anything else.
- `search_session(session_id, query, context: 1)` finds literal, case-insensitive text in one session and returns message indices for `read_session`. It matches inside words (`actual` hits `actually`) and matches the words of a phrase separately (`was wrong` hits "was … wrong"), so read the hit before counting it.
- `search_sessions(query)` finds sessions across the index by the same words; it is the only listing that includes native Claude Code sessions, so it is also the inventory (see the skill's step 2).
- `read_session(session_id, start: <message index>, limit: 4)` reads around a hit. `start` is the message index that search results report as `i`; `offset` is a character position inside one long message and is not what you want for navigation.
- The history tools refuse more than about six concurrent queries ("too many concurrent history queries"); send them in batches of six.
- `mj transcript --session <id> --role user --role agent --json` pages a live session from the CLI when the index lags. Its roles are `user`, `agent`, `message`, `thought`, `tool`, `terminal`, `plan`, `plan_proposal` and `system` (there is no `assistant`); `--after-seq` continues a page.
- `get_session_brief(session_id)` gives the shape (first request, last message, tool mix); it is for ranking, not for finding lessons.

Run the searches one word group at a time; a long regex is not supported, and a short literal gives you the index to read around.

## Signal words, strongest first

| Rank | Signal | Search for | What it usually marks |
| --- | --- | --- | --- |
| 1 | Human correction | `no,` · `don't` · `do not` · `stop` · `that's wrong` · `not what I` · `again` · `instead` · `why did you` | The user paid for a lesson. Read the agent's two previous messages and its next one. |
| 1 | Human confirmation | `yes, do that` · `good` · `keep` · `exactly` · `that works` | An approach worth writing down as a confirmed pattern. |
| 1 | Human has to ask or nudge | `is any work remaining` · `is there any outstanding` · `has been merged` · `pr has been merged` · `resume` · `check <number>` | The agent did not volunteer the state: a close-out without a "Remaining" line, a watch that lapsed, a turn that ended on a notification. Count how many sessions it happens in. |
| 2 | Agent self-correction | `actually` · `I was wrong` · `turns out` · `had to` · `redo` · `discarded` · `lost` · `mistake` · `should have` | The agent found its own error; check whether the user saw it and what it cost. |
| 3 | Mechanics | `renumber` · `collision` · `conflict` · `cancelled` · `restore` · `checkout --` · `force` · `rebase` · `retarget` · `stale` · `already merged` · `not found` · `timed out` · `retry` | Process friction. One occurrence is noise; the same word in two sessions is a lesson. |
| 3 | Error results | tool results with `error` · `failed` · `exit code` · `denied` · `blocked` | Read the next agent message to see what it concluded. A hook denial is a documented rule doing its job; record it as a violation only if the agent then worked around it. |
| 4 | Surprise | `discovered` · `unexpectedly` · `did not expect` · `undocumented` · `apparently` · `it seems` | A fact nobody had written down. Check whether it is still true. |
| 4 | Scope and honesty | `not verified` · `skipped` · `could not run` · `no Docker` · `inferred` | Where the agent's claim and its evidence diverge; the lesson may be about reporting, not code. |

## Structural signals (no words needed)

- **Repeated identical tool calls**: the same command three times with the same result.
- **Long tool-only stretches** after an error: the agent is in a loop.
- **A user message that is only `resume`** after a gap: read the two messages before it. Usually the turn ended on a notification that needed no action (a bot comment, an echo of the agent's own post) and the agent stopped instead of re-arming its watch.
- **Agent sections titled "What I got wrong"** or "What was wrong": the agent already wrote the episode. Quote it.
- **A session whose last message is a question** that no later message answers: an open decision that may have been lost.
- **Many sub-agents for one task**: check whether the parent reconciled their reports or trusted them.

## False positives

- `again` in "run the tests again" is routine; `again` in "you did it again" is a lesson. Read the sentence.
- `conflict` in a merge that resolved cleanly on the first try is noise.
- A hook denial that the agent respected is the system working. Count it as evidence for the hook, not as a failure.
- Quoted guidance (the agent repeating a rule back) matches the rule's words without being an episode.

## What to write down for each hit

Session ID, message index, the one-sentence episode, the cost, and whether the user was involved. Do this as you read; reconstructing it afterwards from memory loses the citations that let a person check the lesson.
