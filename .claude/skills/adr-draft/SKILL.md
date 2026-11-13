---
name: adr-draft
description: Draft a new Any Decision Record (ADR, any significant decision, not only architecture) in docs/decisions for review, following this repo's MADR conventions (decision drivers, driver × option star-rating table, driver-tagged pros/cons for every option), validate it, and open a review PR. Use when the user asks to draft, propose, write or record an ADR or architecture/tooling decision, asks "what do you recommend for X? write it up", or wants to split, revise or supersede an existing ADR.
---

# ADR draft

Write a **proposed** ADR that a reviewer can approve with confidence. The rating table shows at a glance *why* the chosen option won. The pros and cons give the detail.

## Terms

- **ADR** (Any Decision Record): a short Markdown file in `docs/decisions` that records one significant decision, the options considered and the reasons for the choice. The "A" means *any*: product, process and tooling decisions qualify, not only architecture.
- **MADR**: the Markdown ADR format this repo uses. Step 6 lists its sections.
- **Decision driver**: a criterion that you judge the options against. Drivers are numbered `D1`, `D2`, and so on.
- **Validator**: the script `check-adr.ts` (see "Bundled tooling"). It checks the ADR format. It does not judge whether the ratings are fair.
- **Superseded**: an old ADR that a newer ADR replaces.
- **Revisit trigger**: an event that should reopen a deferred decision.
- **Review PR**: the GitHub pull request that holds the draft until the user approves it.
- **Deno script**: a TypeScript entry point run with the skill's own `deno.json` and frozen `deno.lock`.

## Before you start

- A clone of the repo with a clean working tree, so you can create a branch in step 9.
- Deno matching the host repository's `.deno-version` (see "Bundled tooling"), `just`, `git`, and `gh` (the GitHub CLI) signed in to the repo's GitHub account.
- A clear request from the user: which decision to record, or which ADR to split, revise or supersede.
- Run all commands from the repo root.

## Sources of truth

The repo holds the sources of truth. Read them at the start of every run. They win over anything restated here:

- `docs/decisions/0000-use-markdown-architectural-decision-records.md`: conventions and the star scale
- `docs/decisions/adr-template.md`: the skeleton to copy
- `docs/decisions/README.md`: the conventions page (there is no index table: the log is derived from the files, [ADR-0040](../../../docs/decisions/0040-derive-the-decision-log-from-the-adr-files.md))

## Workflow

### 1. Ground yourself

- Read the three files above.
- Run `grep -ril <topic> docs/decisions` to find related ADRs, and read them. A new ADR must not silently contradict an accepted ADR. If it changes an earlier decision, it **supersedes** that decision (see "After review").
- Read the code and configuration that the decision touches, so the context and implementation notes are accurate.
- Get the next number with one of these commands:
  - `just tools adr --next-number`
  - `deno task --config .claude/skills/adr-draft/deno.json check-adr --next-number`

  Success: the command prints the next free number, for example `0042`. The first run downloads pinned dependencies; later runs use Deno's cache. Check `deno --version` against the host repository's runtime pin if it fails.

### 2. Scope: one decision per ADR

If the request covers several linked decisions, propose separate ADRs that link to each other. For example, "data store" became engine (0014), data access (0015) and provisioning (0016). Older ADRs with several tables came before this rule. Do not copy their shape.

### 3. Decision drivers

Derive the drivers from the user's requirements and from the project context below. Number them `D1…Dn`. Write each as `* **Dn Short name**: what matters and why`. Aim for 4–7.

**If a driver is uncertain, or the answer would change the ratings, ask before you write.** Use the AskUserQuestion tool with up to 4 questions. Give each question concrete options and mark one as recommended. Do not invent preferences about budget, team skills, hosting, platforms or risk tolerance.

Project context is not restated here to avoid staleness. Build it at run time:

- Read `AGENTS.md` for standing constraints (e.g. platform, tooling, architecture, cost and security choices).
- From `ls docs/decisions` and the front matter, read every ADR with status `accepted` that touches the topic. Skip `proposed`, `rejected` and `superseded` ones, and follow a `superseded by` link to the current ADR.
- Treat what you find as a constraint or a driver. Do not invent constraints from memory.

### 4. Research and verify facts

Do not state versions, support windows, licences or limits from memory. Check them. Success: each command returns the current value for the package, tag or page.

| Fact | How |
| --- | --- |
| JSR version | Read the package's registry metadata at `https://jsr.io/@<scope>/<name>/meta.json` |
| Crate version | `cargo search <crate> --limit 1`, or `cargo info <crate>` (run inside `backend/`) |
| npm version and peer deps | `npm view <pkg> version peerDependencies` |
| GitHub Action tags | `git ls-remote --tags --refs https://github.com/<owner>/<repo>.git` |
| Container image tags | `https://hub.docker.com/v2/repositories/library/<image>/tags?name=<filter>` |
| Support policy, licence | Vendor docs via WebSearch/WebFetch, quoting the source |

Record versions "at the time of writing" under More Information. **Do not quote prices** unless you verified them on the vendor's own page. Describe cost in relative terms instead, for example "paid, per-committer". An earlier draft wrongly said that .NET STS releases get 18 months of support. They get 24. Always verify.

### 5. Options

- List realistic alternatives, usually 3–5. Include the status quo or "do nothing" when it is a real choice.
- If the user wants an option kept as a fallback, keep it in the table. Give it its own subsection in Decision Outcome that says when the team would use it and what keeps it viable.

### 6. Write the ADR

Copy `adr-template.md` to `docs/decisions/NNNN-lowercase-kebab-title.md`, where `NNNN` is the number from step 1. Use the Write tool, not shell heredocs: unquoted heredocs mangle backticks and `$`.

**Front matter**

- `status: proposed`
- `date:` today's absolute date
- `decision-makers:` the user's handle and `Claude (AI assistant)`. Match existing ADRs.

**Sections, in this order** (the validator enforces the order)

1. `# Title`: names the problem and the solution.
2. `## Context and Problem Statement`: 2–4 sentences that end in the question being decided. Link related ADRs.
3. `## Decision Drivers`
4. `## Considered Options`: one bullet per option.
5. `## Decision Outcome`, containing:
   - `Chosen option: "…", because …`, justified with driver IDs.
   - The **rating table**, in exactly this shape:

     ```markdown
     | Driver | **Option A (chosen)** | Option B | Option C |
     | --- | :---: | :---: | :---: |
     | D1 Short name | ★★★ | ★★☆ | ☆☆☆ |
     ```

     Rules for the table:
     - Drivers are rows and options are columns.
     - The chosen option is the **first** option column, in bold, and its name ends with `(chosen)`.
     - Every driver appears in the table.
     - Use only these ratings: `★★★` (fully meets), `★★☆` (mostly), `★☆☆` (partially) and `☆☆☆` (does not meet).
     - Ratings are relative to the other options.
   - Optional implementation plan or conventions: concrete packages, files, Make targets, CI changes and security measures. Use subheadings and short bullets, not dense paragraphs.
   - `### Consequences`: Good, Bad and Neutral bullets. State the costs of the chosen option honestly.
   - `### Confirmation`: concrete enforcement that someone can check (a CI job, test, analyzer or review rule).
6. `## Pros and Cons of the Options`: a `### <Option>` subsection for **every** considered option, in the same order as in Considered Options. Write every bullet as `* Good|Bad|Neutral, because **Dn Name**: argument`. Argue every driver at least once. Justify every star rating that is not obvious with a bullet.
7. `## More Information` (optional): related ADRs, versions checked, **open questions for the reviewer**, and when to revisit.

**Cross-references**

Write every `ADR-NNNN` mention as a relative Markdown link, for example `[ADR-0014](0014-postgresql-database-engine.md)`. Step 8 shows how `--fix-links` converts bare mentions.

**Revisit triggers**

If the decision defers something until an event happens (for example "adopt Aspire when a second backing service is added"), record the trigger in the ADR **and** wherever a future contributor will look. Possible places:

- the checklist in `.github/pull_request_template.md`
- `README.md`
- a comment in the relevant config file (for example `compose.yaml`)

Say in the ADR where the trigger is recorded.

### 7. Architecture model

There is no index row to add: the docs site derives the decision log from the files. Add the ADR to `metadata.adrs` in `docs/architecture/calendar.architecture.json` instead (id, title equal to the H1, status, file and site URL, like the neighbouring entries). The docs build fails if an entry differs from the ADR file.

### 8. Validate

```sh
deno task --config .claude/skills/adr-draft/deno.json check-adr --fix-links
```

`--fix-links` rewrites bare `ADR-NNNN` mentions into links in the ADR files, so check `git diff` afterwards.

The validator checks every ADR, plus these repo-level rules:

- contiguous numbering
- front matter
- section order
- driver format
- table shape, the chosen column and star values
- options matched one-to-one with pros/cons subsections
- driver-tagged bullets, and every driver rated and argued
- bare or broken links
- the `adr-sweep` checks that read only the branch, each error prefixed with its catalogue id: the architecture model's `metadata.adrs` entry matches each record and the model cites no missing or superseded record (M2; a superseded record whose entry has a `note` saying what still stands may be cited); a `superseded by` link resolves and the newer record names the old one (M3); no number is used by two files (M6); every `### Amendment, YYYY-MM-DD: …` heading is dated and has its `* **Amendment, YYYY-MM-DD:**` bullet in More Information (M7); no `planned` story card lists a superseded record in `adrs:` (J6)

`--inventory` prints the `adr-sweep` inventory as JSON instead of validating: one entry per record with its number, file, title, date, status, superseded-by, amendments, first date on `origin/main` (when git has that ref), model entry and the paths, commands and versions its Decision Outcome cites.

Success: every ADR prints `OK` and the exit code is 0. On failure, it prints `FAIL` and the file name, then the rules that failed. Fix every failure and run it again. Do not hand off an ADR that fails.

The validator cannot judge whether the ratings are fair. Read the table again against the pros and cons yourself.

### 9. Deliver for review

`main` is protected: it needs a PR and the green `CI result` check. Never push to it. Write the PR body to a file first (it is the `<file>` below).

```sh
git switch main && git pull --ff-only
git switch -c docs/adr-NNNN-short-slug
git add docs/decisions .github README.md   # whatever changed
git commit                                  # include the repo's Co-Authored-By trailer
git push -u origin docs/adr-NNNN-short-slug
gh pr create --base main --title "ADR-NNNN (proposed): <title>" --body-file <file>
```

Success: `gh pr create` prints the URL of the new PR. If `git pull --ff-only` fails, your local `main` has diverged. Stop and ask the user.

The PR body has:

- a summary of the recommendation
- a table of the decisions (one row per ADR when there are several)
- the open questions for the reviewer
- a checklist

Do not merge the PR. The user decides when to merge.

If `gh pr edit` fails on an old `gh` (Projects-classic error), use `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -f title=… -F body=@file`.

Then tell the user, in plain language:

- the recommendation and its main reasons
- what you verified
- the open questions, numbered so the user can answer briefly
- the PR link

## After review

For user-requested issue-driven handovers, the `issue-handover` skill (`.claude/skills/issue-handover/SKILL.md`) overrides this skill's question placement: each open question goes in its own PR comment, and agreed answers go in the ADR. Explicit user authorization to merge overrides the default to leave merging to the user; required checks still apply. Outside that mode, use this skill's normal workflow.

- **Answers change the ADR:** update the drafts on the same branch, run the validator again, and update the PR description with what changed. If the user asks for a split, `git rm` the combined file, renumber, and fix every link and the architecture model entry.
- **The user approves:** set `status: accepted` in the front matter **and** in the architecture model entry, in the same PR, *before* it merges. ADRs 0014–0016 merged still marked `proposed`. Do not repeat that. Taking a decision is separate from delivering it. Accept as soon as the user approves the decision. Never keep `proposed` until the implementation, build or rollout exists. The implementation issues and PRs track delivery, not the ADR status.
- **Superseding an ADR:** first ask whether the drivers and their weights changed, not only the facts (`docs/decisions/README.md`, "Reopening a decision"). The new ADR explains what changed. The old one becomes `status: superseded by [ADR-NNNN](NNNN-….md)`, and its architecture model entry becomes `superseded`. Do not edit the substance of the old decision.
- **Implementation:** goes in a separate PR that links to the ADR. It does not change the ADR's status. An accepted ADR with no implementation yet is normal. If the implementation shows the decision was wrong, supersede it with a new ADR. Do not leave it `proposed`.

## Bundled tooling

The validator is TypeScript on Deno. The skill folder holds everything it needs ([ADR-0058](../../../docs/decisions/0058-typescript-on-deno-for-repository-tooling.md)):

```text
deno.json, deno.lock                   # strict types, lint/format/test settings, pinned dependencies
scripts/check-adr/check-adr.ts         # CLI entry point
scripts/check-adr/adr-validator.ts     # record/numbering/sweep rules and inventory
tests/check-adr_test.ts                # original rule cases and inventory checks
tests/cli_test.ts                      # copied skill and CLI behavior
tests/fixtures/valid/                  # minimal valid ADR set that the tests mutate
```

- **Requirement:** use the host repository's exact Deno runtime pin (this repository uses `.deno-version`). Copy this whole skill folder, including its config and lockfile, to share it. It imports no repository tooling. From outside a repository, pass `--dir PATH`; `--model` and `--stories` override the optional sibling defaults.
- **Changing a rule:** edit `adr-validator.ts`, add or adjust a case in the tests, then run `just tools test` and `just tools adr`. In a copied skill, use `deno fmt --check`, `deno lint`, `deno check scripts/check-adr/*.ts tests/*_test.ts`, and `deno task test` from its folder.
- **Package versions** in `deno.json` are exact and `deno.lock` is committed and frozen. In this repo, `just tools versions` detects different pins for the same JSR/npm package across independent configurations (including executable task dependencies); `--fix` updates older pins and refreshes affected lockfiles. Review and commit both config and lock changes. In other repositories, update pins explicitly with `deno install --frozen=false` and rerun the checks.
