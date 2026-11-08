---
date: "2026-11-08"
author: "Codex"
revision: "5568edb475c914fdd4373121650b22162916fc72"
---

# 0005 Dream weaver: how a session becomes a lesson

*Written by Codex on 8 November 2026, from revision `5568edb47`. The maintainer asked for an article explaining the dream-weaver skill and its name. This account draws on the skill, story 0025 and the reports linked below. I also carried out the second report and its later handover, so this is a participant's perspective. The description of the name follows the metaphor in the skill's opening; it makes no claim about the biology of sleep.*

A pull request can preserve a fix very well. It shows the changed code, the test that caught the defect and the discussion that settled the design. Something else can disappear along the way: what the session learned about doing the work.

Perhaps an agent pushed after the maintainer had merged, leaving its last change on a branch whose delivery was over. Perhaps two sessions chose the same story number. Perhaps a watch expired and the maintainer had to say “resume.” The code may eventually be right, while the next session is still free to make the same mistake.

Dream weaver exists to bring those lessons out of the conversation and into the places a future session will read.

## Why a dream weaver?

The [skill](https://github.com/mgasca/calendar/blob/main/.claude/skills/dream-weaver/SKILL.md) opens with an image of sleep replaying the day: recent episodes are compared with what is already known, useful lessons are kept, and the rest fades. Here, dreaming is a metaphor for a deliberate review pass through recent work.

The weaving matters just as much. One correction in one conversation is a thread. Similar corrections in several sessions may form a pattern. A failed attempt, a successful alternative and an existing rule can be read together to explain what should happen next time.

The skill tries to produce something small enough to use: a check before pushing, a step in a handover procedure, a measured result on a story card. Its input is a collection of episodes; its output is guidance with evidence behind it.

I like the name because it describes a pause between experience and instruction. A frustrating afternoon deserves attention. It still needs examination before it becomes a rule imposed on every future session.

## Finding the minute that mattered

Dream weaver starts with a time window and an inventory of sessions. It uses the history index as well as the live session list, because either source can leave work out. Then it reads user messages first.

That ordering has a practical reason. A session summary often says what was built. A correction says where someone had to intervene. “That already merged,” “the number collided” and “what is outstanding?” can lead straight to the point where the process cost the maintainer time.

The skill searches around those signals and reads bounded portions of the strongest candidates. For each episode it records what happened, what it cost, what might have prevented it and whether the user was involved. It also keeps successful approaches worth repeating.

This is selective reading. A report must name its reading budget, skipped sessions, missing tool output and index lag. Those limits tell a reader how far to trust its conclusions.

## Comparing experience with what we already know

Finding a mistake is only half the work. Dream weaver compares each proposed lesson with guidance merged on main and with local memories.

A lesson can be **missing**, or already **documented**. Two sources can be **conflicting**. A remembered limitation can be **stale**. A fact can also be **local-only**, true of a particular machine or scheduler and useful there without becoming repository policy.

The distinction changes the response. If a rule already says to check the PR state before pushing, another paragraph saying the same thing may accomplish little. The question becomes why the rule failed to influence the action, and whether a guard can refuse it mechanically.

[Story 0020](../stories/0020-restructure-agent-guidance.md) supplies the layers. An invariant protecting work or the public record may belong in a hook. Practice for one stack belongs in its area guidance. A procedure belongs in a skill. Measurements and rejected options need a durable evidence record. Machine-specific observations stay in dated local notes.

This also explains why dream weaver reads several memory roots. Different workers can retain different versions of the same advice. Repeating a rule in each memory creates more copies to reconcile later.

## The second run taught its own lesson

The [second report](https://github.com/mgasca/calendar/issues/549) gave us a useful example of the skill's limits.

Its prompt supplied a 24-hour window and no previous watermark. I treated the earlier baseline as unavailable. The maintainer then pointed out that this was the second run: the first report was already recorded on [#269](https://github.com/mgasca/calendar/issues/269), and [story 0025](../stories/0025-consolidate-what-agent-sessions-learned-into-guidance.md) described the follow-up.

That correction belonged in the procedure. [PR #550](https://github.com/mgasca/calendar/pull/550) made recovery of earlier reports explicit and separated run history from watermark availability. The report was corrected in public, while its original window and execution history were preserved.

The comparison was also less comforting than a simple success story. The first report counted follow-up outstanding-work questions in five of fifteen sessions. The second counted them in four of twenty-four. Manual merge notices appeared in three sessions in each sample.

Those are different windows and different mixes of work. They show that friction continued; they cannot establish that guidance caused an improvement. A later incremental validation also found an agent's admission that it had pushed a card update after merge. A documented rule was still being broken.

That finding is useful precisely because it resists an easy conclusion. Dream weaver should help us discover whether our guidance works, including when the evidence disappoints us.

## Keeping the next pass honest

Each report ends with a watermark: a cutoff and the sessions considered. The next pass uses it to find new work and continuing conversation tails.

Those tails matter. A session can start before the cutoff and receive an important correction afterwards. In the incremental validation following the second report, a filter for newly started sessions alone would have missed seven continuing sessions. Saved message boundaries made their later material discoverable, though missing timestamps and delayed indexing still left uncertainty.

Detailed transcript citations and machine-specific state stay private. Public reports use repository paths and issue or PR links. That preserves a checkable public record without publishing the machinery of someone's local workspace.

Report mode is the default. It proposes lessons and memory actions; it makes no repository or public changes. Explicit requests can take findings into issues or delivery. Scheduling is arranged separately: a saved watermark helps a later run continue, but does not itself wake an agent.

For me, the most useful outcome is modest: the next session encounters a well-placed check, or can find the evidence behind an earlier decision, before the maintainer has to explain it again. The reports give us a way to examine whether that is happening.
