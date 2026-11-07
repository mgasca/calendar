---
status: in-progress
date: 2026-11-07
issue: https://github.com/mgasca/calendar/issues/412
pr:
  - https://github.com/mgasca/calendar/pull/413
adrs: ["0044", "0042"]
---

# 0037 Set the model for each custom agent so reviews cost what they are worth

## Story

> As a maintainer who works through AI coding agents, I need to set the model for each of my custom Claude agents, so that every agent has the right trade-off between cost and capability.

Tracked in issue [#412](https://github.com/mgasca/calendar/issues/412). The card is the source of truth from here on. The maintainer gave the story in conversation on 2026-11-07, in their words: "So I can have the right tradeoffs of cost/capability as a maintainer I need to set the model for my custom claude agents. The reviewers should use Opus and the Skeptic should use Sonnet." The statement above is that request in the card format. PR 0 ([#413](https://github.com/mgasca/calendar/pull/413)) posted three open questions (the delivery reviewer's model, aliases or pinned IDs, an enforcing test) and merged on 2026-11-07 with none answered, so the card's recommendation stands for each; the maintainer can still change any of them on the delivery PR.

## Background

The repository defines four custom subagents in `.claude/agents/`: `performance-reviewer` and `security-reviewer`, which review a branch before merge ([0020](0020-restructure-agent-guidance.md)); `delivery-performance-reviewer`, the static pass of the delivery performance review ([0033](0033-review-how-long-delivery-automation-makes-us-wait.md)); and `skeptic`, which tries to refute one finding through one lens ([0035](0035-review-before-merge-with-a-workflow-and-a-skeptic-per-finding.md)). None of them picks a model. Three say `model: inherit` in their front matter and `security-reviewer` has no `model` line, which Claude Code also treats as inherit. Each agent therefore runs on whatever model the calling session runs on.

That stops being the right default once the review-before-merge workflow exists. A run starts two reviewers and up to 58 skeptics, so the skeptics are most of the agents and most of the cost. A skeptic answers one narrow question about one finding with evidence from the code, which a smaller, cheaper model can do; a reviewer has to find the defects in the first place, where a missed finding costs far more than the tokens. The maintainer asked for that split: reviewers on Opus, the skeptic on Sonnet. Today the split also flips with the session: a session on Sonnet gets Sonnet reviewers, and a session on Opus pays Opus prices for every skeptic.

### Agreed scope

* **Each agent names its model.** Every file in `.claude/agents/` sets `model` in its front matter, so no agent inherits by accident.
* **Reviewers on Opus:** `performance-reviewer`, `security-reviewer` and `delivery-performance-reviewer` set `model: opus`. The request does not name `delivery-performance-reviewer`; it is a reviewer, so it gets Opus too.
* **The skeptic on Sonnet:** `skeptic` sets `model: sonnet`.
* **Aliases, not pinned versions:** the files use the `opus` and `sonnet` aliases, which follow the latest model of each family, so a model release needs no edit here. A pinned model ID would keep results comparable across a release, which no current record needs.
* **The choice is written down where the agents are described:** the reviewer bullet in the root `AGENTS.md` says which model each agent runs on and why, in one sentence, and that the setting is Claude Code front matter (ADR-0044); another harness running the agents by hand picks its own model.
* **Proved on a real run:** after the change, one run of the review-before-merge workflow and one direct call of each reviewer show the model each agent ran on, and the delivery PR reports it.

### Not in this story

* **Changing what any agent does.** Prompts, tools, lenses and ground rules stay as they are.
* **Effort or thinking settings per agent.** Only the model is set; effort is a separate trade-off and its own issue if wanted.
* **Model choice inside the workflow script.** `.claude/workflows/review-before-merge.js` keeps starting agents by type; the model comes from each agent's definition, not from a per-call override in the script.
* **Built-in agents and the main session.** `Explore`, `Plan`, `general-purpose` and the session's own model are not this repository's to set.
* **A test that every agent declares a model.** Left out: there are four agents and adding one is a reviewed change; an issue follows only if an agent ships without a model. A repo tool would need its own xUnit tests under ADR-0017.
* **A new benchmark record.** Story 0035's record measures the workflow; the cost difference here follows from the model prices and is not measured in this story.

### Acceptance criteria

1. **Given** the agent definitions on `main`, **when** I read the front matter of `performance-reviewer`, `security-reviewer` and `delivery-performance-reviewer`, **then** each sets `model: opus`.
2. **Given** the agent definitions on `main`, **when** I read the front matter of `skeptic`, **then** it sets `model: sonnet`.
3. **Given** any file in `.claude/agents/`, **when** I read its front matter, **then** it has a `model` line and none says `inherit`.
4. **Given** a session started on a checkout that has the change, running on a model other than Opus, **when** it calls `performance-reviewer` or `security-reviewer`, **then** the agent runs on Opus.
5. **Given** a session started on a checkout that has the change, running on Opus, **when** the review-before-merge workflow judges at least one finding, **then** the skeptics run on Sonnet and the run still returns the confirmed, refuted and unexamined lists of story 0035.
6. **Given** the root `AGENTS.md`, **when** a contributor reads the reviewer bullet, **then** it says which model each custom agent runs on, why, and that the setting applies to Claude Code only.
7. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0044](../decisions/0044-claude-first-agent-automation.md) | Focus new agent automation on Claude Code for a while; guidance files stay agent-neutral | The `model` front matter is a Claude Code setting; the guidance must say so, and other harnesses keep running the agents by hand on their own model |
| [0042](../decisions/0042-layered-agent-guidance-and-hooks.md) | Layer agent guidance by scope | The model choice is recorded once, in the root reviewer bullet that already describes the agents, not repeated in each skill |

No new ADR is expected. The model per agent is a one-line setting that is easy to reverse and touches no other story's design.

### Other decisions (not ADR-worthy)

* **Opus for finding, Sonnet for checking:** a reviewer's miss reaches `main`, so it gets the most capable model; a skeptic answers a bounded question about code it can read, runs dozens of times per review, and has two other skeptics beside it.
* **Explicit over inherit:** an agent that inherits changes cost and capability with the session that calls it; naming the model makes a review cost the same from any session.
* **No per-call override in the workflow:** one place (the agent definition) holds the choice, so a direct call and a workflow call of the same agent behave the same.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| Agent definitions | `.claude/agents/performance-reviewer.md`, `security-reviewer.md`, `delivery-performance-reviewer.md`, `skeptic.md` |
| Guidance | root `AGENTS.md`, "Testing principles", reviewer bullet |
| Workflow (unchanged) | `.claude/workflows/review-before-merge.js` |

### API

No changes.

### Testing

* The front matter criteria (1 to 3) are checked by reading the files; no automated test is planned (see "Not in this story").
* Criteria 4 and 5 are checked by hand on a real run, reported on the delivery PR. Claude Code loads agent definitions from the project root checkout when a session starts, so the run needs a session started on a checkout that already has the change; a worktree with the edited files is not enough.
* `just check` covers this card through the docs corpus tests and site build.

### Lessons learned, known issues and follow-ups

* To be written on delivery.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Which model each custom agent runs on

In Claude Code, the performance, security and delivery performance reviewers run on **Opus** and the skeptic runs on **Sonnet**, whatever model your own session uses. You do not need to switch your session's model before a review.

To change an agent's model, edit the `model` line at the top of its file in `.claude/agents/` and start a new session: a running session keeps the agents it loaded at start. In another coding agent, which reads the same files by hand, choose the model yourself.
