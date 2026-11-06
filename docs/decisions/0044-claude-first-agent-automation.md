---
status: proposed
date: 2026-11-06
decision-makers: mgasca, Claude (AI assistant)
---

# Focus new agent automation on Claude Code for a while, keeping the guidance files agent-neutral

## Context and Problem Statement

[ADR-0042](0042-layered-agent-guidance-and-hooks.md) layered the agent guidance and made **agent neutrality** a decision driver (its D3): every rule, including one a Claude Code hook enforces, keeps a form that Codex, Cursor and other agents can read and follow by hand. Since then the exploration of cross-harness subagent dispatch that motivated neutrality has ended, and the repository already holds automation only Claude Code runs: the hooks in `tools/agent-hooks`, the reviewer subagents, the parallel-children pattern and the skills that drive issue handovers. Each new piece still pays for a portable twin, and Claude Code mechanisms that have no hand-followable form (recurring loops, scheduled routines, workflows, hooks that act rather than remind) stay at arm's length. Story [0027](../stories/0027-focus-agent-guidance-on-claude-code-for-a-while.md) asks for a period in which the guidance focuses on Claude Code so its native benefits can be explored. How much neutrality should the repository keep during that period, and what ends it?

## Decision Drivers

* **D1 Native capability**: new automation can use Claude Code mechanisms directly (hooks that deny, ask or inform; loops and routines; workflows; subagents) instead of the subset that has a portable equivalent.
* **D2 Authoring and upkeep cost**: the effort to write, and keep in step, a hand-followable twin for every rule and automation, which [ADR-0042](0042-layered-agent-guidance-and-hooks.md) already counted as a cost (its D6).
* **D3 Reach to other agents**: Codex, Cursor and other agents can still read the repository's rules and work in it without breaking its invariants.
* **D4 Reversibility**: the work it takes to return to full neutrality, or to adopt a second harness, when the period ends.
* **D5 Protection of invariants**: the rules that protect uncommitted work, the shared database, generated files and the public record keep holding for every agent that works here.
* **D6 Honest record**: the repository says plainly which parts are Claude Code only, so neither a person nor an agent is misled into expecting enforcement or automation that is not there.

## Considered Options

* Claude-first period: new automation may be Claude Code only, the guidance files stay agent-neutral, with a revisit trigger
* Full neutrality (status quo): every rule and automation keeps a hand-followable twin
* Claude-only repository: fold `AGENTS.md` into `CLAUDE.md` and drop the twins
* Neutral automation layer: automation as `just` recipes and repo tools any harness can call, with a thin adapter per harness

## Decision Outcome

Chosen option: "Claude-first period: new automation may be Claude Code only, the guidance files stay agent-neutral, with a revisit trigger", because it gives new automation the native mechanisms (D1) and stops the cost of twins (D2) while keeping the files other agents read unchanged (D3) and every existing invariant enforced or stated (D5), says in one place what is Claude-only (D6), and names the event that reopens the question (D4). Full neutrality keeps paying for twins the exploration no longer needs; a Claude-only repository throws away the neutral layer that costs nothing to keep; a neutral automation layer is the most work for the least native benefit.

| Driver | **Claude-first period (chosen)** | Full neutrality (status quo) | Claude-only repository | Neutral automation layer |
| --- | :---: | :---: | :---: | :---: |
| D1 Native capability | ★★★ | ★☆☆ | ★★★ | ★★☆ |
| D2 Authoring and upkeep cost | ★★★ | ★☆☆ | ★★★ | ☆☆☆ |
| D3 Reach to other agents | ★★☆ | ★★★ | ☆☆☆ | ★★★ |
| D4 Reversibility | ★★☆ | ★★★ | ☆☆☆ | ★★☆ |
| D5 Protection of invariants | ★★★ | ★★★ | ★★★ | ★★☆ |
| D6 Honest record | ★★★ | ★★☆ | ★★★ | ★★☆ |

### What stays agent-neutral

* The root `AGENTS.md`, `backend/AGENTS.md`, `frontend/AGENTS.md`, the folder READMEs, the story cards and the ADRs. They are the layer any agent reads, and nothing in this decision shrinks them.
* The one-line *(hook)* statements that already exist in the root for the four hooked invariants. They stay, and any **new deny hook** gets one too: a rule that protects work or the public record must reach an agent without hooks (D5).

### What may be Claude Code only

* New **ask** and **inform** hooks, which remind rather than refuse, need no prose twin.
* Skills may require Claude Code mechanisms (loops, scheduled routines, workflows, `spawn_task`, subagents) and describe no hand-followable alternative.
* Saved workflows under `.claude/workflows/` and reviewer subagents under `.claude/agents/` are Claude Code only by nature.
* Repo tools under `tools/` stay callable from any shell, as [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md) already makes them; the Claude-only part is what calls them.

### Marking and record

* The root `AGENTS.md` gains one sentence in its overview: automation under `.claude/` and `tools/agent-hooks` is Claude Code only during the period of this ADR, with a link to it.
* A PR that adds a Claude-only piece says so where the piece is described: the skill's description, the `tools/README.md` row or the hook's `.claude/settings.json` comment line.
* Story [0027](../stories/0027-focus-agent-guidance-on-claude-code-for-a-while.md) and its epic (#318) deliver the first uses: the `issue-handover` skill's polling moves to a harness loop or routine, its watch to a repo tool, its `Closes` rule to an inform hook, and its reference sections to the places their readers start.

### The period and its end

* The period is revisited when either event happens first: a second harness is used for real work in this repository for more than one story, or the closing PR of epic #318 records that the exploration of Claude Code's native benefits is over. The trigger is recorded here and in `tools/README.md` next to the agent-hooks revisit triggers from [ADR-0042](0042-layered-agent-guidance-and-hooks.md); the `adr-sweep` skill reports deferred decisions whose trigger has arrived.
* Ending the period is a new ADR, not an edit of this one: it either returns to [ADR-0042](0042-layered-agent-guidance-and-hooks.md) as written or supersedes both records with what the period taught.

### Consequences

* Good, because a handover, a review or a sweep can use the mechanism that fits (a loop, a routine, a workflow, a hook) without first inventing a portable version of it.
* Good, because every new rule has one home again where it is an ask or inform hook or a Claude-only skill, which removes the duplication [ADR-0042](0042-layered-agent-guidance-and-hooks.md) accepted.
* Good, because the files other agents read are unchanged, so an agent that arrives tomorrow works as it did yesterday, with the same four invariants stated in prose.
* Bad, because a Codex or Cursor session gets no help from the new automation, and a reminder a hook would have given is simply absent for it.
* Bad, because returning to neutrality later means writing twins for everything built in the period, or accepting that the period's automation is dropped; the record of Claude-only pieces keeps that bill visible.
* Neutral, because the four deny hooks and their prose lines are untouched; the protection other agents had, they keep.

### Confirmation

* `just tools adr` validates this record and the amendment note in [ADR-0042](0042-layered-agent-guidance-and-hooks.md); the docs build fails if the architecture model entry differs from this file.
* Review rule: a PR that adds a hook, skill, subagent or workflow either marks it Claude-only where it is described or, for a deny hook, adds the one-line root statement. Reviewers check the root sentence still points here.
* The closing PR of epic #318 states whether the revisit trigger has arrived; the `adr-sweep` skill reports it if that PR does not.

## Pros and Cons of the Options

### Claude-first period: new automation may be Claude Code only, the guidance files stay agent-neutral, with a revisit trigger

* Good, because **D1 Native capability**: loops, routines, workflows and acting hooks become ordinary tools for new automation.
* Good, because **D2 Authoring and upkeep cost**: no twin for ask and inform hooks or for Claude-only skills; only new deny hooks keep a prose line.
* Neutral, because **D3 Reach to other agents**: other agents keep every file they read today and every stated invariant, but gain nothing from the new automation.
* Neutral, because **D4 Reversibility**: the neutral layer is intact, so returning costs only twins for what the period built, and the marking rule keeps that list visible.
* Good, because **D5 Protection of invariants**: existing deny hooks and their prose lines are untouched, and new deny hooks still get a line.
* Good, because **D6 Honest record**: one sentence in the root and a mark on each piece say what is Claude-only, which is more than the repository says today.

### Full neutrality (status quo): every rule and automation keeps a hand-followable twin

* Bad, because **D1 Native capability**: a mechanism with no hand-followable form (a recurring loop, a workflow) cannot be adopted without inventing a prose stand-in that no other agent runs.
* Bad, because **D2 Authoring and upkeep cost**: every new rule is written twice and reviewed for drift, the cost [ADR-0042](0042-layered-agent-guidance-and-hooks.md) accepted when the exploration still needed it.
* Good, because **D3 Reach to other agents**: every rule reaches every agent in the same form.
* Good, because **D4 Reversibility**: nothing to reverse.
* Good, because **D5 Protection of invariants**: unchanged.
* Neutral, because **D6 Honest record**: the repository claims a neutrality it already lacks, since the hooks, subagents and handover skills run only under Claude Code.

### Claude-only repository: fold `AGENTS.md` into `CLAUDE.md` and drop the twins

* Good, because **D1 Native capability**: same as the chosen option.
* Good, because **D2 Authoring and upkeep cost**: one file, one copy, no twins at all.
* Bad, because **D3 Reach to other agents**: Codex and Cursor read `AGENTS.md` natively and would find nothing; the neutral layer costs nothing to keep and would be thrown away for no gain.
* Bad, because **D4 Reversibility**: rebuilding the nested files and prose lines later is the whole of [ADR-0042](0042-layered-agent-guidance-and-hooks.md)'s restructuring again.
* Good, because **D5 Protection of invariants**: hooks are unaffected for Claude Code.
* Good, because **D6 Honest record**: a Claude-only repository that says so is honest, if poorer.

### Neutral automation layer: automation as `just` recipes and repo tools any harness can call, with a thin adapter per harness

* Neutral, because **D1 Native capability**: a repo tool can do the mechanical part, but the harness-side half (when to fire, how to wait, how to refuse an action) differs per harness and the adapter can only expose what each harness offers.
* Bad, because **D2 Authoring and upkeep cost**: every mechanism needs the neutral core plus an adapter per harness, for harnesses the repository does not currently use.
* Good, because **D3 Reach to other agents**: in principle every harness gets the same automation.
* Neutral, because **D4 Reversibility**: the neutral core survives any switch, but adapters for unused harnesses rot.
* Neutral, because **D5 Protection of invariants**: a pre-action deny depends on the harness having a hook point; where it has none, the adapter can only remind.
* Neutral, because **D6 Honest record**: the repository would say it supports harnesses nobody runs here, which is tested by no one.

## More Information

* Related: [ADR-0042](0042-layered-agent-guidance-and-hooks.md) (the layers and the agent-neutrality driver this record relaxes; it carries an amendment note pointing here), [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md) (repo tools stay shell-callable), story [0027](../stories/0027-focus-agent-guidance-on-claude-code-for-a-while.md) and epic #318 (first uses), story [0020](../stories/0020-restructure-agent-guidance.md) (the restructuring that created the layers).
* Open questions for the reviewer: (1) is the revisit trigger right, a second harness in real use or the epic's closing PR, or should it be a date; (2) should new **deny** hooks keep a one-line root statement, as proposed, or may they too be Claude-only; (3) may the existing *(hook)* lines in the root be removed during the period, or do they stay as proposed.
* Revisit when the trigger above fires, and also if a second harness is tried for even one story: that trial is the moment to measure what the Claude-only pieces cost it.
