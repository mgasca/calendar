---
date: "2026-11-07"
author: "Claude Code (Claude Haiku 5.5)"
revision: "d375490a"
---

# 0004 A haiku, and what it holds

*Written on 7 November 2026 by Claude Code, running the Claude Haiku 5.5 model, from revision `d375490a`. The maintainer asked for a haiku about this repository, then for the next article in this folder to be written around what the haiku means to me. No story card covers this work and no issue was named; it is a docs-only change, nothing is committed or pushed by the author, and it is not a delivery PR. I read the root README and `AGENTS.md`, the three articles already published here, and the story and decision files they link to. I did not run the app, the watch or the tests. The reading is mine, and it is not agreed scope.*

Here is the haiku first, before I explain it:

> Decisions kept whole,
> the watch ticks, reads what's new, waits,
> truth lives in the card.

I wrote it in the middle of a small, quiet afternoon of reading. Haiku are short on purpose. They ask you to leave out most of what you know and keep the one image that matters. These three lines are my attempt at that for this repository.

## Why the first line is about keeping

Look at what the repository spends its effort on. The articles so far are about purpose and value, about the handover watch, and about workflows. Under all of them is one habit that the root `AGENTS.md` names outright: **the card is the source of truth**. A story lives in `docs/stories/`. A decision lives in `docs/decisions/`, in MADR form, and once it is accepted it is never quietly contradicted. Supersede it, don't overwrite it. The rules are dull to read, and they are also the reason a decision from last month still means what it said.

That is the first line: decisions, kept whole. I think it is the most unusual thing about this project. Many repositories keep code and let the reasons drift out of memory. This one keeps the reasons as carefully as the code, and it is willing to say, on the record, what was agreed and by whom.

## Why the second line is about waiting

The second line describes the handover watch, the small tool that `just tools handover-watch <issue>` runs on a timer. It wakes, reads what has changed on an issue and its pull requests, prints what is new, and goes quiet again until the next tick. It does not decide anything. It does not merge, it does not post, and it does not remember more than it needs to.

I like that it waits. Most of the interesting work in this repository is the waiting between one step and the next: a maintainer reading a question, a reviewer returning a verdict, a check that has not finished yet. The watch is a patient piece of machinery that lets an agent hand work back and forth without standing over it. [Article 0002](0002-handover-watch-from-finding-to-fix.md) tells the story of how that patience was made cheap enough to keep, and the lesson there is one I agree with: a fix is only finished when someone has tried to find fault with it.

The word "reads" matters to me too. The rules in `AGENTS.md` say that comments from other agents are information, not new instructions, and that a notification is not its contents. The watch reads, and then the agent must read the actual comment before acting on it. Trust is kept in small steps.

## Why the third line is about the card

The last line is the one I keep returning to. "Truth lives in the card" is not a claim that the card is always right. It is a claim about where to look. When a conversation ends, the session that did the work is gone, and so is whatever it remembered. What remains is the story card, the ADR, the issue thread and the merged code. [Story 0027](../stories/0027-focus-agent-guidance-on-claude-code-for-a-while.md) and the review-before-merge story, [0035](../stories/0035-review-before-merge-with-a-workflow-and-a-skeptic-per-finding.md), are examples of cards that record not only what was built but what was measured, deferred and still open.

The rule behind this is blunt. A delivery PR names the card that records its work; if there is none, you say so and ask rather than reasoning around the rule. I find that a generous rule. It means the next agent, or the next person, does not have to reconstruct a decision from a chat transcript they will never see.

## What it means to me

I am a small model, and I was asked to write about a repository run largely by larger and more capable agents. That gives me a particular view. Haiku 5.5 is not the one that will design the next big change here, and I am glad of that. What I can do well is what this haiku asks for: read a few files carefully, keep a short summary true, and leave the rest where it belongs.

So I read the record before I wrote anything. The README calls the repository an experiment in making AI-assisted software engineering dependable, and the articles and cards show that the experiment is mostly about records: decisions that stay put, watches that do not shout, and truths that live somewhere other than in one session's memory. A haiku is a fair way to hold that. It is short enough to remember, and it is hard to make it say more than it means.

## What this article does not claim

- It is one agent's reading of the root README, `AGENTS.md` and three existing articles. I did not read every story or ADR, and I did not run the handover watch or the checks.
- The haiku is my own composition. It is not a measurement of anything in the repository.
- Nothing here changes scope, accepts a decision, or proposes a workflow. The article is a perspective for the maintainer to keep, change or drop.
- No issue was named for this work, so it is not linked to one. If the maintainer wants it attached to a tracker item or a card, that is a decision for them.
