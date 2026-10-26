---
name: adr-draft
description: Draft a new Architecture Decision Record (ADR) in docs/decisions for review, following this repo's MADR conventions (decision drivers, driver × option star-rating table, driver-tagged pros/cons for every option), validate it, and open a review PR. Use when the user asks to draft, propose, write or record an ADR or architecture/tooling decision, asks "what do you recommend for X? write it up", or wants to split, revise or supersede an existing ADR.
---

# ADR draft

Produce a **proposed** ADR that a reviewer can approve with confidence. The rating table shows at a glance *why* the chosen option won; the pros and cons give the detail.

The sources of truth are in the repo. Read them at the start of every run, because they win over anything restated here:

- `docs/decisions/0000-use-markdown-architectural-decision-records.md`: conventions and the star scale
- `docs/decisions/adr-template.md`: the skeleton to copy
- `docs/decisions/README.md`: the index of ADRs

## Workflow

### 1. Ground yourself

- Read the three files above.
- `grep -ril <topic> docs/decisions` to find related ADRs; read them. A new ADR must not silently contradict an accepted one. If it changes an earlier decision, it **supersedes** it (see "After review").
- Look at the code and config the decision touches, so the context and implementation notes are accurate.
- Get the next number: `make adr-check ARGS=--next-number` or `dotnet run .claude/skills/adr-draft/scripts/check-adr/check-adr.cs -- --next-number`.

### 2. Scope: one decision per ADR

If the request covers several linked decisions, propose separate, cross-linked ADRs. For example, "data store" became engine (0014), data access (0015) and provisioning (0016). Older multi-table ADRs (0004, 0007, 0008, 0009, 0012) predate this rule; don't copy that shape.

### 3. Decision drivers

Drivers are what the options are judged against. Derive them from the user's stated requirements and the project context below, numbered `D1…Dn`, each as `* **Dn Short name**: what matters and why`. Aim for 4–7.

**If a driver is uncertain, or the answer would change the ratings, ask before writing.** Use AskUserQuestion with up to 4 questions, each with concrete options and a recommended one. Don't invent preferences about budget, team skills, hosting, platforms or risk tolerance.

Project context recorded in earlier ADRs. Re-check it, because it may have changed:

- Code is mostly written by AI agents, so favour mainstream, well-documented, strongly typed tools ([ADR-0003](../../../docs/decisions/0003-react-vite-typescript-web-ui.md)).
- Future clients: mobile, desktop, CLI and third-party integrations. They consume `contracts/openapi.json` ([ADR-0001](../../../docs/decisions/0001-monorepo-layout.md), [ADR-0004](../../../docs/decisions/0004-openapi-contract-and-generated-client.md)).
- Development happens on Linux/WSL only, with Docker available ([ADR-0011](../../../docs/decisions/0011-make-as-top-level-task-runner.md)).
- The app is deployed as a single container in which the API serves the SPA ([ADR-0002](../../../docs/decisions/0002-dotnet-10-minimal-api-backend.md)).
- The repo is public on GitHub with rulesets, CodeQL and Dependabot ([ADR-0012](../../../docs/decisions/0012-ci-and-dependency-updates.md), [ADR-0013](../../../docs/decisions/0013-public-repository-for-github-security-features.md)).
- The project is cost-conscious: managed PostgreSQL is the target, with SQLite on a volume as the budget fallback ([ADR-0014](../../../docs/decisions/0014-postgresql-database-engine.md)).

### 4. Research and verify facts

Never state versions, support windows, licences or limits from memory. Check them:

| Fact | How |
| --- | --- |
| NuGet version | `dotnet package search <id> --exact-match --format json` (run inside `backend/`) |
| npm version and peer deps | `npm view <pkg> version peerDependencies` |
| GitHub Action tags | `git ls-remote --tags --refs https://github.com/<owner>/<repo>.git` |
| Container image tags | `https://hub.docker.com/v2/repositories/library/<image>/tags?name=<filter>` |
| Support policy, licence | Vendor docs via WebSearch/WebFetch, quoting the source |

Record versions "at the time of writing" under More Information. **Don't quote prices** unless verified from the vendor's own page; describe cost relatively instead (e.g. "paid, per-committer"). An earlier draft wrongly said .NET STS releases get 18 months of support; they get 24. Verify.

### 5. Options

- List realistic alternatives, usually 3–5, including the status quo or "do nothing" when it's viable.
- An option the user wants kept as a fallback stays in the table and gets its own subsection in Decision Outcome, saying when it would be used and what keeps it viable.

### 6. Write the ADR

Copy `adr-template.md` to `docs/decisions/NNNN-lowercase-kebab-title.md`. Use the Write tool, not shell heredocs: unquoted heredocs mangle backticks and `$`.

**Front matter**

- `status: proposed`
- `date:` today's absolute date
- `decision-makers:` the user's handle and `Claude (AI assistant)`. Match existing ADRs.

**Sections, in this order** (the validator enforces it)

1. `# Title`: names the problem and the solution.
2. `## Context and Problem Statement`: 2–4 sentences ending in the question being decided. Link related ADRs.
3. `## Decision Drivers`
4. `## Considered Options`: one bullet per option.
5. `## Decision Outcome`, containing:
   - `Chosen option: "…", because …`, justified in terms of driver IDs.
   - The **rating table**, in exactly this shape:

     ```markdown
     | Driver | **Option A (chosen)** | Option B | Option C |
     | --- | :---: | :---: | :---: |
     | D1 Short name | ★★★ | ★★☆ | ☆☆☆ |
     ```

     Drivers are rows and options are columns. The chosen option is the **first** option column, in bold, ending with `(chosen)`. Every driver appears in the table. Only `★★★` (fully meets), `★★☆` (mostly), `★☆☆` (partially) and `☆☆☆` (does not meet) are allowed. Ratings are relative to the other options.
   - Optional implementation plan or conventions: concrete packages, files, Make targets, CI changes and security measures. Use subheadings and short bullets, not dense paragraphs.
   - `### Consequences`: Good, Bad and Neutral bullets. Be honest about the chosen option's costs.
   - `### Confirmation`: concrete, checkable enforcement (CI job, test, analyzer, review rule).
6. `## Pros and Cons of the Options`: a `### <Option>` subsection for **every** considered option, in the same order. Every bullet is `* Good|Bad|Neutral, because **Dn Name**: argument`. Every driver is argued at least once, and every star rating that isn't obvious is justified by a bullet.
7. `## More Information` (optional): related ADRs, versions checked, **open questions for the reviewer**, and when to revisit.

**Cross-references**

Every `ADR-NNNN` mention is a relative Markdown link: `[ADR-0014](0014-postgresql-database-engine.md)`. Run the validator with `--fix-links` to convert any bare mentions.

**Revisit triggers**

If the decision defers something until an event happens (e.g. "adopt Aspire when a second backing service is added"), record the trigger in the ADR **and** wherever a future contributor will look. Possible places:

- `.github/pull_request_template.md` checklist
- `README.md`
- a comment in the relevant config file (e.g. `compose.yaml`)

Say in the ADR where the trigger is recorded.

### 7. Index

Add a row to `docs/decisions/README.md`. Its title must equal the H1 and its status must match the front matter:

```markdown
| [NNNN](NNNN-title.md) | <H1 title> | proposed |
```

### 8. Validate

```sh
dotnet run .claude/skills/adr-draft/scripts/check-adr/check-adr.cs -- --fix-links
```

It checks every ADR plus repo-level rules:

- contiguous numbering
- front matter
- section order
- driver format
- table shape, the chosen column and star values
- options matched one-to-one with pros/cons subsections
- driver-tagged bullets, and every driver rated and argued
- bare or broken links
- index title and status

Fix every failure; don't hand off a failing ADR. The validator can't judge whether the ratings are fair. Re-read the table against the pros/cons yourself.

### 9. Deliver for review

`main` is protected (PR plus the green `CI result` check required), so never push to it.

```sh
git switch main && git pull --ff-only
git switch -c docs/adr-NNNN-short-slug
git add docs/decisions .github README.md   # whatever changed
git commit                                  # include the repo's Co-Authored-By trailer
git push -u origin docs/adr-NNNN-short-slug
gh pr create --base main --title "ADR-NNNN (proposed): <title>" --body-file <file>
```

The PR body has:

- a summary of the recommendation
- a table of the decisions (one row per ADR when there are several)
- the open questions for the reviewer
- a checklist

Don't merge it; merging is the user's call.

If `gh pr edit` fails on an old `gh` (Projects-classic error), use `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -f title=… -F body=@file`.

Then tell the user, in plain language:

- the recommendation and its main reasons
- what was verified
- the open questions, numbered so they can answer briefly
- the PR link

## After review

- **Answers change the ADR:** update the drafts on the same branch, re-run the validator, and update the PR description with what changed. If the user asks for a split, `git rm` the combined file, renumber, and fix every link and the index.
- **The user approves:** set `status: accepted` in the front matter **and** the index, in the same PR, *before* it merges. ADRs 0014–0016 were merged still marked `proposed`; don't repeat that.
- **Superseding an ADR:** the new ADR explains what changed. The old one becomes `status: superseded by [ADR-NNNN](NNNN-….md)`, and the index row is updated. Don't edit the old decision's substance.
- **Implementation:** goes in a separate PR after the ADR is accepted. Its description links the ADR.

## Bundled tooling

The validator is a .NET 10 file-based app, and the skill folder carries everything it needs ([ADR-0017](../../../docs/decisions/0017-dotnet-file-based-apps-for-repo-tooling.md)):

```text
Directory.Build.props, .editorconfig, NuGet.config   # analyzers, warnings as errors, style, package sources
scripts/check-adr/check-adr.cs                        # CLI entry point (#! line, so ./check-adr.cs also works)
scripts/check-adr/AdrValidator.cs                     # all rules; pure logic, unit-tested
tests/check-adr.tests.cs                              # xUnit v3 tests; #:include the validator logic
tests/fixtures/valid/                                 # minimal valid ADR set that the tests mutate
```

- **Requirement:** the .NET 10 SDK. The first run on a machine compiles for about 30 s; after that, runs take under a second.
- **Changing a rule:** edit `AdrValidator.cs`, add or adjust an `[InlineData]` case in the tests, then run `make tooling` (tests and whitespace check) and `make adr-check`.
- **Package versions** in `Directory.Build.props` and the `#:package` directives are pinned exactly. Bump them by hand alongside `backend/Directory.Packages.props` until Dependabot support is confirmed (ADR-0017).
