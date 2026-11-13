# Routing: where guidance lives in this repository

This file holds the repository-specific part of the skill. To use the skill in another repository, replace this file.

## Remembered set

Read these from `origin/main`. Together with the local memories they are what the agents already "know". A lesson is `documented` only if one of these states it; a transcript, a closed issue or a PR comment does not count, because no session loads them.

| Layer | Path on main | Loaded when |
| --- | --- | --- |
| Root guidance | `AGENTS.md` (imported by `CLAUDE.md`) | Every session |
| Area practice | `backend/AGENTS.md`, `frontend/AGENTS.md` | A file of that stack is read or edited (Claude Code); natively by Codex and Cursor |
| Skills | `.claude/skills/*/SKILL.md` and their `references/` | On request, or when the description matches |
| Reviewer agents | `.claude/agents/*.md` | On request |
| Folder conventions | `docs/decisions/README.md`, `docs/stories/README.md`, `docs/runbooks/README.md`, `docs/benchmarks/README.md`, `docs/architecture/README.md`, `tools/README.md` | When the root points at them |
| Hooks | `tools/agent-hooks/` (rules enforced for Claude Code; each has a one-line *(hook)* statement in the root) | Every matching command or edit |
| Durable evidence | `docs/stories/*.md` ("Lessons learned", "Delivery and acceptance evidence"), `docs/benchmarks/*.md` | When a story or benchmark is read |
| Decisions | `docs/decisions/*.md` | When an ADR is read |

Grep recipes:

```sh
git grep -n -i -E '<words>' origin/main -- AGENTS.md backend/AGENTS.md frontend/AGENTS.md .claude docs/*/README.md tools/README.md
git grep -n -i -E '<words>' origin/main -- docs/stories docs/decisions docs/benchmarks
git show origin/main:tools/agent-hooks/agent-hooks.ts | sed -n '1,40p'   # the usage comment lists every hooked rule
git show origin/main:tools/agent-hooks/bash-guard.ts | grep -n -i -E 'deny|ask'
git show origin/main:tools/agent-hooks/checks.ts | grep -n -i -E 'deny|ask'
```

## Local memory roots

Memory is written per worker. For this project every root matches:

```sh
ls -d ~/.local/share/mjolnir/workers/*/profile/projects/hel-ec62276e75f90324-*/memory
```

Each root holds `MEMORY.md` (the index) and one file per memory with front matter (`name`, `description`, `metadata.type`: `user`, `feedback`, `project`, `reference`). Memories with the same `name` in several roots are copies of one memory; compare their bodies, because copies drift. The worker ID in the path says which session wrote it; `mj sessions --all --json` maps IDs to titles.

Other harness profiles keep their own notes. Check `~/.local/share/mjolnir/workers/*/profile/` for a `memory` or `notes` directory outside `projects/` and say in the coverage line whether you read them.

## Routing table (ADR-0042)

| The lesson is … | Route | Capture |
| --- | --- | --- |
| An invariant that protects uncommitted work, shared resources or the public record | Hook in `tools/agent-hooks/` plus one *(hook)* line in root `AGENTS.md` | Name the command or edit pattern; the hook denies or asks; the prose line stays for agents without hooks |
| A rule every session needs and no hook can check | Root `AGENTS.md` (budget: 90 lines, 1,500 words) | One line or one bullet; remove or shorten something if the budget is exceeded |
| Practice for one stack (query shapes, render rules, analyzer traps) | `backend/AGENTS.md` or `frontend/AGENTS.md` | A bullet under the existing heading |
| A multi-step procedure used on request | A skill in `.claude/skills/<name>/` (new or existing) | A step, a mode, or a reference file; the drafting skills own numbering, PR 0 and card completion |
| A convention people read too (naming, index rules, record format) | The folder's `README.md` | A sentence in the existing list |
| A review checklist item | `.claude/agents/<reviewer>.md` | A bullet |
| A measured decision, a rejected option, or a historical result | The story card that owns the topic; `docs/benchmarks/` when the harness is retained | Provenance, sampling, limits, reconsideration condition; label a result whose harness is gone as reported evidence |
| A changed technical decision | An ADR (`adr-draft`), never a story detail | Supersede, do not edit the accepted one |
| True only for this machine, scheduler, worker or environment | A dated local memory (`type: project`) | Observation date, how to re-probe, what would make it stale |
| Wrong, fixed, or about a tool or version that is gone | Delete (memory) or remove with a PR (guidance), after verifying on main and in the environment | Say what was checked |

When two routes fit, prefer the one loaded less often: the root is the most expensive place to put a line.

## Delivery conventions this skill defers to

- `story-draft` for the card and its numbering (a fetch is a snapshot, not a reservation).
- `issue-handover` for watching, questions as PR comments, resume and close-out.
- "Verify delivery across a merge" and "Report what verification covered" in root `AGENTS.md`.
- `docs/benchmarks/README.md` for a new repeatable measurement.
- Story 0018 (`docs/stories/0018-preserve-transcript-insights.md`) as the model of a completed consolidation: one epic, one child and PR per lesson, evidence table with limits, memory disposition table.
