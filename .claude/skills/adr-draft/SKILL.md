---
name: adr-draft
description: Draft a new Architecture Decision Record (ADR) in docs/decisions for review, following this repo's MADR conventions (decision drivers, driver × option star-rating table, driver-tagged pros/cons for every option), validate it, and open a review PR. Use when the user asks to draft, propose, write or record an ADR or architecture/tooling decision, asks "what do you recommend for X? write it up", or wants to split, revise or supersede an existing ADR.
---

# ADR draft

Write a **proposed** ADR that a reviewer can approve with confidence. The rating table shows at a glance *why* the chosen option won. The pros and cons give the detail.

## Terms

- **ADR** (Architecture Decision Record): a short Markdown file in `docs/decisions` that records one decision, the options considered and the reasons for the choice.
- **MADR**: the Markdown ADR format this repo uses. Step 6 lists its sections.
- **Decision driver**: a criterion that you judge the options against. Drivers are numbered `D1`, `D2`, and so on.
- **Validator**: the script `check-adr.cs` (see "Bundled tooling"). It checks the ADR format. It does not judge whether the ratings are fair.
- **Superseded**: an old ADR that a newer ADR replaces.
- **Revisit trigger**: an event that should reopen a deferred decision.
- **Review PR**: the GitHub pull request that holds the draft until the user approves it.
- **File-based app**: a single `.cs` file that `dotnet run` compiles and runs without a project file.

## Before you start

- A clone of the repo with a clean working tree, so you can create a branch in step 9.
- The .NET 10 SDK, `just`, `git`, and `gh` (the GitHub CLI) signed in to the repo's GitHub account.
- A clear request from the user: which decision to record, or which ADR to split, revise or supersede.
- Run all commands from the repo root.

## Sources of truth

The repo holds the sources of truth. Read them at the start of every run. They win over anything restated here:

- `docs/decisions/0000-use-markdown-architectural-decision-records.md`: conventions and the star scale
- `docs/decisions/adr-template.md`: the skeleton to copy
- `docs/decisions/README.md`: the index of ADRs

## Workflow

### 1. Ground yourself

- Read the three files above.
- Run `grep -ril <topic> docs/decisions` to find related ADRs, and read them. A new ADR must not silently contradict an accepted ADR. If it changes an earlier decision, it **supersedes** that decision (see "After review").
- Read the code and configuration that the decision touches, so the context and implementation notes are accurate.
- Get the next number with one of these commands:
  - `just adr-check --next-number`
  - `dotnet run .claude/skills/adr-draft/scripts/check-adr/check-adr.cs -- --next-number`

  Success: the command prints the next free number, for example `0042`. If it fails, check that the .NET 10 SDK is installed. The first run compiles the script and takes about 30 s.

### 2. Scope: one decision per ADR

If the request covers several linked decisions, propose separate ADRs that link to each other. For example, "data store" became engine (0014), data access (0015) and provisioning (0016). Older ADRs with several tables came before this rule. Do not copy their shape.

### 3. Decision drivers

Derive the drivers from the user's requirements and from the project context below. Number them `D1…Dn`. Write each as `* **Dn Short name**: what matters and why`. Aim for 4–7.

**If a driver is uncertain, or the answer would change the ratings, ask before you write.** Use the AskUserQuestion tool with up to 4 questions. Give each question concrete options and mark one as recommended. Do not invent preferences about budget, team skills, hosting, platforms or risk tolerance.

Project context is not restated here to avoid staleness. Build it at run time:

- Read `AGENTS.md` for standing constraints (e.g. platform, tooling, architecture, cost and security choices).
- From the index, read every ADR with status `accepted` that touches the topic. Skip `proposed`, `rejected` and `superseded` ones, and follow a `superseded by` link to the current ADR.
- Treat what you find as a constraint or a driver. Do not invent constraints from memory.

### 4. Research and verify facts

Do not state versions, support windows, licences or limits from memory. Check them. Success: each command returns the current value for the package, tag or page.

| Fact | How |
| --- | --- |
| NuGet version | `dotnet package search <id> --exact-match --format json` (run inside `backend/`) |
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

### 7. Index

Add a row to `docs/decisions/README.md`. Its title must equal the ADR's H1 (the `# Title` line), and its status must match the front matter:

```markdown
| [NNNN](NNNN-title.md) | <H1 title> | proposed |
```

### 8. Validate

```sh
dotnet run .claude/skills/adr-draft/scripts/check-adr/check-adr.cs -- --fix-links
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
- index title and status

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

- **Answers change the ADR:** update the drafts on the same branch, run the validator again, and update the PR description with what changed. If the user asks for a split, `git rm` the combined file, renumber, and fix every link and the index.
- **The user approves:** set `status: accepted` in the front matter **and** in the index, in the same PR, *before* it merges. ADRs 0014–0016 merged still marked `proposed`. Do not repeat that. Taking a decision is separate from delivering it. Accept as soon as the user approves the decision. Never keep `proposed` until the implementation, build or rollout exists. The implementation issues and PRs track delivery, not the ADR status.
- **Superseding an ADR:** the new ADR explains what changed. The old one becomes `status: superseded by [ADR-NNNN](NNNN-….md)`, and you update its index row. Do not edit the substance of the old decision.
- **Implementation:** goes in a separate PR that links to the ADR. It does not change the ADR's status. An accepted ADR with no implementation yet is normal. If the implementation shows the decision was wrong, supersede it with a new ADR. Do not leave it `proposed`.

## Bundled tooling

The validator is a .NET 10 file-based app. The skill folder holds everything it needs ([ADR-0017](../../../docs/decisions/0017-dotnet-file-based-apps-for-repo-tooling.md)):

```text
Directory.Build.props, .editorconfig, NuGet.config   # analyzers, warnings as errors, style, package sources
scripts/check-adr/check-adr.cs                        # CLI entry point (#! line, so ./check-adr.cs also works)
scripts/check-adr/AdrValidator.cs                     # all rules; pure logic, unit-tested
tests/check-adr.tests.cs                              # xUnit v3 tests; #:include the validator logic
tests/fixtures/valid/                                 # minimal valid ADR set that the tests mutate
```

- **Requirement:** the .NET 10 SDK. The first run on a machine compiles for about 30 s. After that, runs take under a second.
- **Changing a rule:** edit `AdrValidator.cs`, add or adjust an `[InlineData]` case in the tests, then run `just tooling` (tests and whitespace check) and `just adr-check`. Success: both commands finish without errors.
- **Package versions** in `Directory.Build.props` and the `#:package` directives are pinned exactly. Dependabot (the tool that opens dependency-update PRs) cannot see them (verified, ADR-0017). In this repo, `just tool-versions` fails when they differ from `backend/Directory.Packages.props`, and `just tool-versions --fix` updates them. In other repos, change them by hand.
