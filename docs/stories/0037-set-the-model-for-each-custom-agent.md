---
status: implemented
date: 2026-11-07
issue: https://github.com/mgasca/calendar/issues/412
pr:
  - https://github.com/mgasca/calendar/pull/413
  - https://github.com/mgasca/calendar/pull/414
  - https://github.com/mgasca/calendar/pull/416
adrs: ["0044", "0042"]
---

# 0037 Set the model for each custom agent so reviews cost what they are worth

## Story

> As a maintainer who works through AI coding agents, I need to set the model for each of my custom Claude agents, so that every agent has the right trade-off between cost and capability.

Tracked in issue [#412](https://github.com/mgasca/calendar/issues/412). The card is the source of truth from here on. The maintainer gave the story in conversation on 2026-11-07, in their words: "So I can have the right tradeoffs of cost/capability as a maintainer I need to set the model for my custom claude agents. The reviewers should use Opus and the Skeptic should use Sonnet." The statement above is that request in the card format. PR 0 ([#413](https://github.com/mgasca/calendar/pull/413)) posted three open questions (the delivery reviewer's model, aliases or pinned IDs, an enforcing test) and merged on 2026-11-07 with none answered, so the card's recommendation stands for each. The delivery PR ([#414](https://github.com/mgasca/calendar/pull/414)) changed only the skeptic's model, from Sonnet to Haiku, in the maintainer's review.

## Background

The repository defines four custom subagents in `.claude/agents/`: `performance-reviewer` and `security-reviewer`, which review a branch before merge ([0020](0020-restructure-agent-guidance.md)); `delivery-performance-reviewer`, the static pass of the delivery performance review ([0033](0033-review-how-long-delivery-automation-makes-us-wait.md)); and `skeptic`, which tries to refute one finding through one lens ([0035](0035-review-before-merge-with-a-workflow-and-a-skeptic-per-finding.md)). None of them picks a model. Three say `model: inherit` in their front matter and `security-reviewer` has no `model` line, which Claude Code also treats as inherit. Each agent therefore runs on whatever model the calling session runs on.

That stops being the right default once the review-before-merge workflow exists. A run starts two reviewers and up to 58 skeptics, so the skeptics are most of the agents and most of the cost. A skeptic answers one narrow question about one finding with evidence from the code, which a smaller, cheaper model can do; a reviewer has to find the defects in the first place, where a missed finding costs far more than the tokens. The maintainer asked for that split: reviewers on Opus, the skeptic first on Sonnet and then, in review of the delivery PR, on Haiku. Today the split also flips with the session: a session on Sonnet gets Sonnet reviewers, and a session on Opus pays Opus prices for every skeptic.

### Agreed scope

* **Each agent names its model.** Every file in `.claude/agents/` sets `model` in its front matter, so no agent inherits by accident.
* **Reviewers on Opus:** `performance-reviewer`, `security-reviewer` and `delivery-performance-reviewer` set `model: opus`. The request does not name `delivery-performance-reviewer`; it is a reviewer, so it gets Opus too.
* **The skeptic on Haiku:** `skeptic` sets `model: haiku`. The story asked for Sonnet; the maintainer changed it to Haiku in a review suggestion on [#414](https://github.com/mgasca/calendar/pull/414) on 2026-11-07.
* **Aliases, not pinned versions:** the files use the `opus` and `haiku` aliases, which follow the latest model of each family, so a model release needs no edit here. A pinned model ID would keep results comparable across a release, which no current record needs.
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
   *Checked by reading the files* (no automated test, see "Not in this story"): [performance-reviewer.md](../../.claude/agents/performance-reviewer.md), [security-reviewer.md](../../.claude/agents/security-reviewer.md) and [delivery-performance-reviewer.md](../../.claude/agents/delivery-performance-reviewer.md), line 5, on `main` at 22b75d95a.
2. **Given** the agent definitions on `main`, **when** I read the front matter of `skeptic`, **then** it sets `model: haiku`.
   *Checked by reading the file*: [skeptic.md](../../.claude/agents/skeptic.md), line 5.
3. **Given** any file in `.claude/agents/`, **when** I read its front matter, **then** it has a `model` line and none says `inherit`.
   *Checked by hand*: `git ls-files .claude/agents` lists the four files above, and each has one `model` line (`opus` or `haiku`); none says `inherit`.
4. **Given** a session started on a checkout that has the change, running on a model other than Opus, **when** it calls `performance-reviewer` or `security-reviewer`, **then** the agent runs on Opus.
   *Checked by hand on 2026-11-07* (see "Proof on a real run"). The app does not let a session switch its own model, so the session itself ran on Opus 5.5. The non-Opus caller was a `general-purpose` subagent started on Sonnet 5.5. It called both reviewers, and both ran on Opus 5.5 (`claude-opus-5-5`). The same reviewers called directly from the Opus session also ran on Opus.
5. **Given** a session started on a checkout that has the change, running on Opus, **when** the review-before-merge workflow judges at least one finding, **then** the skeptics run on Haiku and the run still returns the confirmed, refuted and unexamined lists of story 0035.
   *Checked by hand on 2026-11-07* (see "Proof on a real run"). The run judged one finding with three skeptics, and every skeptic turn ran on `claude-haiku-5-5`. The result had the `confirmed` list (one finding) and the empty `refuted` and `unexamined` lists.
6. **Given** the root `AGENTS.md`, **when** a contributor reads the reviewer bullet, **then** it says which model each custom agent runs on, why, and that the setting applies to Claude Code only.
   *Checked by reading*: [AGENTS.md](../../AGENTS.md), "Testing principles", "Reviewer subagents" bullet.
7. **Given** the change is complete, **when** I run `just check`, **then** it passes.
   The `CI` workflow, which runs `just check`, passed on `main` at 22b75d95a (#414's squash merge). This card PR is checked by its own CI run. Locally only the docs corpus tests and the docs build ran.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0044](../decisions/0044-claude-first-agent-automation.md) | Focus new agent automation on Claude Code for a while; guidance files stay agent-neutral | The `model` front matter is a Claude Code setting; the guidance must say so, and other harnesses keep running the agents by hand on their own model |
| [0042](../decisions/0042-layered-agent-guidance-and-hooks.md) | Layer agent guidance by scope | The model choice is recorded once, in the root reviewer bullet that already describes the agents, not repeated in each skill |

No new ADR is expected. The model per agent is a one-line setting that is easy to reverse and touches no other story's design.

### Other decisions (not ADR-worthy)

* **Opus for finding, Haiku for checking:** a reviewer's miss reaches `main`, so it gets the most capable model; a skeptic answers a bounded question about code it can read, runs dozens of times per review, and has two other skeptics beside it.
* **Explicit over inherit:** an agent that inherits changes cost and capability with the session that calls it; naming the model makes a review cost the same from any session.
* **No per-call override in the workflow:** one place (the agent definition) holds the choice, so a direct call and a workflow call of the same agent behave the same.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| Agent definitions | [performance-reviewer.md](../../.claude/agents/performance-reviewer.md), [security-reviewer.md](../../.claude/agents/security-reviewer.md), [delivery-performance-reviewer.md](../../.claude/agents/delivery-performance-reviewer.md) (`model: opus`) and [skeptic.md](../../.claude/agents/skeptic.md) (`model: haiku`), line 5 of each front matter |
| Guidance | root [AGENTS.md](../../AGENTS.md), "Testing principles", "Reviewer subagents" bullet |
| Workflow (unchanged) | [review-before-merge.js](../../.claude/workflows/review-before-merge.js) |

### API

No changes.

### Delivery

* [#413](https://github.com/mgasca/calendar/pull/413), PR 0: the card. It merged with its three open questions unanswered, so the card's recommendation stands for each: Opus for `delivery-performance-reviewer`, aliases rather than pinned IDs, and no enforcing test.
* [#414](https://github.com/mgasca/calendar/pull/414): the `model` line in the four agent files and the `AGENTS.md` bullet. In review, the maintainer changed the skeptic from `sonnet` to `haiku` with a suggestion, and #414 was merged as 22b75d95a. **The squash title still says "reviewers on Opus, skeptic on Sonnet", but the merged content says Haiku.** Trust the files, not the commit title.
* [#416](https://github.com/mgasca/calendar/pull/416): this completed card, with the proof run below. It closes #412.

### Proof on a real run

Run by hand on 2026-11-07 in a Claude Code session on Opus 5.5 (`claude-opus-5-5`). The project root checkout had been fast-forwarded to 22b75d95a before the session started. The model of each agent was read in two ways:

* **Harness:** the `message.model` field on every assistant turn in that agent's subagent transcript. This is the model the API call actually used.
* **Self-report:** in the direct calls, each agent was also asked to quote the model from its own system prompt.

The two agreed every time.

| Caller | Agent | Model (transcript; self-report where asked) |
| --- | --- | --- |
| Opus session, direct | `skeptic` (probe, before any change) | `claude-haiku-5-5`; "Haiku 5.5" |
| Opus session, direct | `performance-reviewer` | `claude-opus-5-5`; "Opus 5.5" |
| Opus session, direct | `security-reviewer` | `claude-opus-5-5`; "Opus 5.5" |
| `general-purpose` subagent on Sonnet 5.5 (`claude-sonnet-5-5`) | `performance-reviewer` | `claude-opus-5-5`; "Opus 5.5" |
| `general-purpose` subagent on Sonnet 5.5 | `security-reviewer` | `claude-opus-5-5`; "Opus 5.5" |
| review-before-merge workflow (`cap: 20`) | `performance-reviewer`, `security-reviewer` | `claude-opus-5-5` (transcript only) |
| review-before-merge workflow | three `skeptic`s, lenses true, reproduces and matters | `claude-haiku-5-5` on all 28 turns (transcript only) |

The workflow ran on a scratch branch from `origin/main`. It held one throwaway commit: an anonymous `GET /api/health/db` that returned the database connection string. The branch was deleted afterwards and never pushed. Results:

* `security-reviewer` reported the endpoint as one critical finding. `performance-reviewer` reported no performance finding and pointed to the leak as out of its scope.
* All three skeptics declined to refute the finding, so it came back as `confirmed`, with `refuted` and `unexamined` empty.
* The run used five agents and about 64 s.

What the run did and did not show:

* The workflow's skeptic prompt has no way to ask for the model, so inside the workflow the skeptics' model is shown only by their transcripts. The direct `skeptic` probe gave both forms.
* `delivery-performance-reviewer` was not called. No criterion asks for it, and its file says `model: opus` like the other two reviewers.
* The session itself could not run on a model other than Opus. Criterion 4's non-Opus caller was the Sonnet subagent, which covers the same case: the reviewers did not inherit their caller's model.

### Testing

* Criteria 1 to 3 and 6 are checked by reading the files. There is no automated test (see "Not in this story").
* Criteria 4 and 5 were checked by hand in the run above. The transcripts are local to the maintainer's machine; the numbers in the table are also on #412.
* `just check` covers this card through the docs corpus tests and the site build.

### Lessons learned, known issues and follow-ups

* **Agents are loaded at session start, from the project root checkout.** The proof needed a session started after that checkout was fast-forwarded to `main`. A worktree that only contains the edited agent files is not enough. Probe with one trivial call to the agent before relying on the registry.
* **Read the model from the transcript.** In a subagent's `.meta.json`, `pickedEffortModel` showed `claude-opus-5-5` even for the Haiku skeptics, so it is not the model the agent ran on. The `message.model` field of each assistant turn is.
* **A session cannot switch its own model** in the desktop app; the session-model tool refuses to act on its own session. To prove behaviour from a non-Opus caller, start the caller as a subagent with a `model` override, or start the session on that model.
* No follow-up issue. The cost difference is inferred from model prices, not measured (see "Not in this story").

## User guide

### Which model each custom agent runs on

In Claude Code, three agents run on **Opus**: the performance reviewer, the security reviewer and the delivery performance reviewer. The skeptic runs on **Haiku**. This holds whatever model your own session uses, so you do not need to switch your session's model before a review. The review-before-merge workflow uses the same models, because it starts these agents by type.

To change an agent's model:

1. Edit the `model` line at the top of the agent's file in `.claude/agents/`.
2. Merge the change and update the project's main checkout.
3. Start a new session. A running session keeps the agents it loaded when it started, and it loads them from the main checkout, not from a worktree.

In another coding agent, which reads the same files by hand, choose the model yourself.
