---
status: planned
date: 2026-11-16
issue: https://github.com/mgasca/calendar/issues/964
pr: []
adrs: ["0042", "0044", "0058"]
---

# 0070 Agents edit PR bodies with a gh that works

## Story

> As a maintainer, I need `just doctor` to refuse a GitHub CLI that cannot edit a PR, and the agent hooks to check the REST fallback that agents use instead, so that a PR body can always be corrected in place and every route to it still gets the private-details and `Closes`/`Refs` checks.

Tracked in issue #964.

## Background

The repository's Linux/WSL setup gets `gh` from Ubuntu's apt archive, which ships 2.46.0. On that version, `gh pr edit` exits 1 with a GraphQL error: "Projects (classic) is being deprecated … (`repository.pullRequest.projectCards`)". `gh issue view` without `--json` fails the same way (`repository.issue.projectCards`). GitHub removed the Projects (classic) fields, and old `gh` releases still ask for them. Upstream, `gh` 2.73.0 started feature-detecting Projects (classic) in `gh pr view` and `gh pr edit`, and 2.82.1 fixed the last `gh pr edit` path that still queried them ([cli/cli#11983](https://github.com/cli/cli/issues/11983), [cli/cli#11987](https://github.com/cli/cli/pull/11987)). The issue was found while delivering story [0068](0068-pr-hooks-see-native-stack-prs.md): editing the bodies of #959, #960 and #963 failed, and `gh api -X PATCH repos/mgasca/calendar/pulls/N -F body=@file` worked.

The guidance still points agents at the command that fails. `AGENTS.md` ("Public GitHub posts") says to edit a post in place when a private detail slips through. The link check of story 0068 tells the agent to run `gh pr edit <n> --body-file <file>`. Only the `adr-draft` skill names the REST fallback.

That fallback has a gap. The bash guard ([ADR-0042](../decisions/0042-layered-agent-guidance-and-hooks.md)) already reads the files behind `gh api -F field=@file`, so private details in a PATCH body are refused. The link check reads only `gh pr create` and `gh pr edit`, so a body rewritten through `gh api` gets no `Closes`/`Refs` reminder.

The prerequisites table in the root `README.md` lists `gh` with no version, and `tools/doctor/doctor.sh` only checks that `gh` is on the `PATH`. Story 0068 left the `gh api` route out of scope (#894).

### Agreed scope

* **`just doctor` requires a minimum `gh`.** Doctor fails on a `gh` older than the minimum, prints the version it found and the minimum, and points to GitHub's own apt repository instead of Ubuntu's archive. The proposed minimum is **2.82.1**, the first release with every known `projectCards` fix. Delivery confirms it by running `gh pr edit --body-file` and `gh issue view` (without `--json`) on that release.
* **The README names the minimum.** The `gh` row of the prerequisites table gives the minimum version and the install route. It says why: Ubuntu's archive ships a release that cannot edit PRs.
* **The hook messages name the fallback.** Wherever a hook tells the agent to run `gh pr edit` (today the link check's note after `gh stack submit` and `gh stack link`), it also names `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -F body=@<file>` for a `gh` that cannot edit. `AGENTS.md` ("Public GitHub posts") names it once too, so the advice to edit a post in place works on any `gh`.
* **The link check reads a REST PR body.** A `gh api` command that writes a PR body gets the same `Closes`/`Refs` reminder as `gh pr edit` and `gh pr create`. That covers a PATCH to `repos/<owner>/<repo>/pulls/<n>` and a POST to `repos/<owner>/<repo>/pulls`. The body can come from `-F body=@file`, `--field body=@file`, `-f body=…` or `--raw-field body=…`. The base is the one the command sets (`-f base=…`), or else the PR's current base, read as `gh pr edit` reads it.
* **Private details stay refused on this route.** The bash guard keeps refusing a `gh api` PR body with private details, and a test pins that for the PATCH form named in the hook messages.

### Not in this story

* **Installing or upgrading `gh` for the user.** Doctor reports and points to the install route. It never runs `apt` or downloads anything.
* **A `gh api --input <json>` body.** The link check does not parse a JSON request file. The bash guard already reads it for private details. Agents use `-F body=@file` as the hook messages say.
* **Issue and comment bodies sent through `gh api`.** The `Closes`/`Refs` rule is about PRs. Issue and comment posts keep the bash guard's private-details check only.
* **Other GraphQL deprecations in `gh`.** Only the `projectCards` failure is in scope. A later failure gets its own issue.
* **Agents other than Claude Code.** The hooks are Claude Code only for now ([ADR-0044](../decisions/0044-claude-first-agent-automation.md)). Other agents follow the guidance by hand.

### Acceptance criteria

1. **Given** a `gh` older than the minimum on the `PATH`, **when** I run `just doctor`, **then** it fails, naming the version it found, the minimum, and GitHub's apt repository as the install route.
2. **Given** a `gh` at or above the minimum, **when** I run `just doctor`, **then** the `gh` line passes and shows the version.
3. **Given** `gh` at the minimum version, **when** I run `gh pr edit <n> --body-file <file>` and `gh issue view <n>` against this repository, **then** both succeed (checked by hand on delivery and recorded in this card).
4. **Given** a `gh stack submit` or `gh stack link` that leaves a layer without `Closes #N` or `Refs #N`, **when** the link check reminds me, **then** the reminder names both `gh pr edit <n> --body-file <file>` and the `gh api -X PATCH … -F body=@<file>` fallback.
5. **Given** `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -F body=@<file>`, where the file has neither `Closes #N` nor `Refs #N`, **when** the command runs, **then** the link check gives the same reminder as `gh pr edit` would for that PR and base.
6. **Given** the same PATCH with a body that carries `Closes #N` or `Refs #N`, **when** the command runs, **then** no reminder appears.
7. **Given** a `gh api` POST to `repos/<owner>/<repo>/pulls` with `-f base=main` and a body without `Closes`/`Refs`, **when** the command runs, **then** the link check reminds me as it would for `gh pr create`.
8. **Given** a `gh api` PATCH of a PR body whose file holds an absolute machine path or a session handle, **when** the command is about to run, **then** the bash guard refuses it.
9. **Given** a `gh api` call that sets no PR body (a GET, or a PATCH to an issue or a comment), **when** it runs, **then** the link check stays silent.
10. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0042](../decisions/0042-layered-agent-guidance-and-hooks.md) | Layered agent guidance, with hooks enforcing the rules marked *(hook)* | The link check and the bash guard are those hooks; this story extends what they read |
| [0044](../decisions/0044-claude-first-agent-automation.md) | Claude-first agent automation | The hooks may stay Claude Code only; the guidance in `AGENTS.md` stays readable by every agent |
| [0058](../decisions/0058-typescript-on-deno-for-repository-tooling.md) | Repository tooling in TypeScript on Deno | The hook changes are Deno code with Deno tests; `tools/doctor/doctor.sh` stays the one shell exception |

No new ADR is expected: a minimum tool version in doctor follows the existing `git` 2.36 check.

### Other decisions (not ADR-worthy)

* **Both a doctor check and the fallback:** the minimum version fixes the cause on every machine that runs doctor. The fallback and its check cover a machine that has not rerun doctor since it upgraded, and close the one PR-body route that skipped the link check.
* **A minimum, not an exact pin:** `gh` is a client of a moving API, and newer releases are the fix. An exact pin would make doctor fail on every upgrade.
* **The minimum lives in `doctor.sh`, next to the `git` minimum,** not in a new version file. `gh` is not installed by a repo recipe, so no other tool reads the number.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| Doctor check | `tools/doctor/doctor.sh`, `tools/doctor/tests/doctor_test.ts` |
| Prerequisites table | `README.md` ("Prerequisites") |
| Link check | `tools/agent-hooks/pull-request-link-check.ts`, `tools/agent-hooks/tests/` |
| Bash guard | `tools/agent-hooks/bash-guard.ts`, `tools/agent-hooks/body-sources.ts` |
| Guidance | `AGENTS.md` ("Public GitHub posts"), `.claude/skills/adr-draft/SKILL.md` |

### API

No changes.

### Testing

* Doctor tests with fake `gh` executables below, at and above the minimum.
* Link-check tests for the PATCH and POST forms, each body source (`-F`, `--field`, `-f`, `--raw-field`), the base set in the command and the base read from the PR, and the silent cases (GET, issue and comment PATCH, a body with `Closes` or `Refs`).
* A bash-guard test for a PATCH body file with private details.
* A by-hand run of `gh pr edit --body-file` and `gh issue view` on the minimum release.

### Lessons learned, known issues and follow-ups

* To be filled in on delivery.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Getting a GitHub CLI that can edit PRs

Run **just doctor**. If it reports that `gh` is too old, install the GitHub CLI from GitHub's own apt repository, as the message and the prerequisites table describe, and run **just doctor** again. Ubuntu's own package is too old to edit PRs or show issues.

### Editing a PR body when `gh pr edit` fails

If `gh pr edit` fails with a "Projects (classic) is being deprecated" error, upgrade `gh`. Until then, write the new body to a file and run `gh api -X PATCH repos/<owner>/<repo>/pulls/<number> -F body=@<file>`. The agent hooks check that command as they check `gh pr edit`: they refuse private details, and they remind you when a PR body has neither `Closes #N` nor `Refs #N`.
