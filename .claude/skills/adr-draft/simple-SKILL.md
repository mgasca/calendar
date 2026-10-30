---
name: adr-draft
description: Draft a new Architecture Decision Record (ADR) in docs/decisions for review, following this repo's MADR conventions (decision drivers, driver × option star-rating table, driver-tagged pros/cons for every option), validate it, and open a review PR. Use when the user asks to draft, propose, write or record an ADR or architecture/tooling decision, asks "what do you recommend for X? write it up", or wants to split, revise or supersede an existing ADR.
---

# ADR draft

An ADR (Architecture Decision Record) is a short document that records one technical decision. Write a `proposed` ADR that a reviewer can approve with confidence. The rating table shows why the chosen option won. The pros and cons give the detail.

The repo holds the sources of truth. Read them at the start of every run. They win over anything restated here:

- `docs/decisions/0000-use-markdown-architectural-decision-records.md`: conventions and the star scale
- `docs/decisions/adr-template.md`: the skeleton to copy
- `docs/decisions/README.md`: the index of ADRs

## Workflow

### 1. Ground yourself

- Read the three files above.
- Run `grep -ril <topic> docs/decisions` to find related ADRs, and read them. A new ADR must not silently contradict an accepted ADR. If it changes an earlier decision, it must supersede that decision (see "After review").
- Read the code and configuration that the decision touches. Then the context and implementation notes are accurate.
- Get the next number with `make adr-check ARGS=--next-number` or `dotnet run .claude/skills/adr-draft/scripts/check-adr/check-adr.cs -- --next-number`.

### 2. Scope: one decision per ADR

If the request covers several linked decisions, propose separate ADRs that link to each other. For example, "data store" became engine (0014), data access (0015) and provisioning (0016). Older ADRs with several tables (0004, 0007, 0008, 0009, 0012) came before this rule. Do not copy their shape.

### 3. Decision drivers

Drivers are the criteria that you judge the options against. Derive them from the requirements of the user and from the project context below. Number them `D1…Dn`. Write each as `* **Dn Short name**: what matters and why`. Aim for 4–7 drivers.

If a driver is uncertain, or the answer would change the ratings, ask before you write. Use AskUserQuestion with up to 4 questions. Give each question concrete options and a recommended one. Do not invent preferences about budget, team skills, hosting, platforms or risk tolerance.

Earlier ADRs record this project context. Check it again, because it can change:

- AI agents write most of the code. Prefer mainstream, well-documented, strongly typed tools ([ADR-0003](../../../docs/decisions/0003-react-vite-typescript-web-ui.md)).
- Future clients are mobile, desktop, CLI and third-party integrations. They use `contracts/openapi.json` ([ADR-0001](../../../docs/decisions/0001-monorepo-layout.md), [ADR-0004](../../../docs/decisions/0004-openapi-contract-and-generated-client.md)).
- Development happens on Linux/WSL only, with Docker available ([ADR-0011](../../../docs/decisions/0011-make-as-top-level-task-runner.md)).
- The app deploys as a single container. In that container the API serves the SPA ([ADR-0002](../../../docs/decisions/0002-dotnet-10-minimal-api-backend.md)).
- The repo is public on GitHub with rulesets, CodeQL and Dependabot ([ADR-0012](../../../docs/decisions/0012-ci-and-dependency-updates.md), [ADR-0013](../../../docs/decisions/0013-public-repository-for-github-security-features.md)).
- The project is cost-conscious. The target is managed PostgreSQL. The budget fallback is SQLite on a volume ([ADR-0014](../../../docs/decisions/0014-postgresql-database-engine.md)).

### 4. Research and verify facts

Do not state versions, support windows, licences or limits from memory. Check them:

| Fact | How |
| --- | --- |
| NuGet version | `dotnet package search <id> --exact-match --format json` (run inside `backend/`) |
| npm version and peer deps | `npm view <pkg> version peerDependencies` |
| GitHub Action tags | `git ls-remote --tags --refs https://github.com/<owner>/<repo>.git` |
| Container image tags | `https://hub.docker.com/v2/repositories/library/<image>/tags?name=<filter>` |
| Support policy, licence | Vendor docs via WebSearch/WebFetch, quoting the source |

Record versions "at the time of writing" under More Information. Do not quote prices unless you verified them on the vendor's own page. Describe cost in relative terms instead, for example "paid, per-committer". An earlier draft wrongly said that .NET STS releases get 18 months of support. They get 24 months. Always verify.

### 5. Options

- List realistic alternatives, usually 3–5. Include the status quo or "do nothing" when it is a real choice.
- If the user wants to keep an option as a fallback, keep it in the table. Give it its own subsection in Decision Outcome. In that subsection, say when the team would use it and what keeps it viable.

### 6. Write the ADR

Copy `adr-template.md` to `docs/decisions/NNNN-lowercase-kebab-title.md`. Use the Write tool, not shell heredocs, because unquoted heredocs change backticks and `$`.

Front matter:

- `status: proposed`
- `date:` today's absolute date
- `decision-makers:` the handle of the user and `Claude (AI assistant)`. Match existing ADRs.

Sections, in this order (the validator enforces the order):

1. `# Title`: names the problem and the solution.
2. `## Context and Problem Statement`: 2–4 sentences. The last sentence is the question that you decide. Link related ADRs.
3. `## Decision Drivers`
4. `## Considered Options`: one bullet for each option.
5. `## Decision Outcome`, which contains:
   - `Chosen option: "…", because …`. Justify it with driver IDs.
   - The rating table, in exactly this shape:

     ```markdown
     | Driver | **Option A (chosen)** | Option B | Option C |
     | --- | :---: | :---: | :---: |
     | D1 Short name | ★★★ | ★★☆ | ☆☆☆ |
     ```

     Drivers are rows and options are columns. The chosen option is the first option column. It is bold and ends with `(chosen)`. Every driver appears in the table. Use only these ratings: `★★★` (fully meets), `★★☆` (mostly), `★☆☆` (partially) and `☆☆☆` (does not meet). Ratings are relative to the other options.
   - An optional implementation plan or conventions. Name concrete packages, files, Make targets, CI changes and security measures. Use subheadings and short bullets, not dense paragraphs.
   - `### Consequences`: Good, Bad and Neutral bullets. State the costs of the chosen option honestly.
   - `### Confirmation`: concrete enforcement that someone can check, such as a CI job, a test, an analyzer or a review rule.
6. `## Pros and Cons of the Options`: one `### <Option>` subsection for every considered option, in the same order. Write every bullet as `* Good|Bad|Neutral, because **Dn Name**: argument`. Argue every driver at least once. Justify with a bullet every star rating that is not obvious.
7. `## More Information` (optional): related ADRs, the versions that you checked, open questions for the reviewer, and when to revisit.

Cross-references:

Write every `ADR-NNNN` mention as a relative Markdown link, for example `[ADR-0014](0014-postgresql-database-engine.md)`. Run the validator with `--fix-links` to convert bare mentions.

Revisit triggers:

Sometimes the decision defers something until an event happens. For example: "adopt Aspire when a second backing service is added". Then record the trigger in the ADR. Also record it where a future contributor will look. Possible places:

- the checklist in `.github/pull_request_template.md`
- `README.md`
- a comment in the relevant configuration file (for example `compose.yaml`)

Say in the ADR where you recorded the trigger.

### 7. Index

Add a row to `docs/decisions/README.md`. The title must equal the H1. The status must match the front matter:

```markdown
| [NNNN](NNNN-title.md) | <H1 title> | proposed |
```

### 8. Validate

```sh
dotnet run .claude/skills/adr-draft/scripts/check-adr/check-adr.cs -- --fix-links
```

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

Fix every failure. Do not hand off an ADR that fails. The validator cannot judge whether the ratings are fair. Read the table again against the pros and cons yourself.

### 9. Deliver for review

`main` is protected. It needs a PR and the green `CI result` check. Never push to it.

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
- a table of the decisions (one row for each ADR when there are several)
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

- If the answers change the ADR, update the drafts on the same branch. Run the validator again. Update the PR description with what changed. If the user asks for a split, run `git rm` on the combined file, renumber, and fix every link and the index.
- When the user approves, set `status: accepted` in the front matter and in the index. Do this in the same PR, before it merges. ADRs 0014–0016 merged while still marked `proposed`. Do not repeat that. Taking a decision is separate from delivering it. Accept as soon as the user approves the decision. Never keep `proposed` until the implementation, build or rollout exists. The implementation issues and PRs track delivery, not the ADR status.
- To supersede an ADR, write a new ADR that explains what changed. Set the old ADR to `status: superseded by [ADR-NNNN](NNNN-….md)` and update its index row. Do not edit the substance of the old decision.
- Implementation goes in a separate PR that links to the ADR. It does not change the status of the ADR. An accepted ADR with no implementation yet is normal. If the implementation shows that the decision was wrong, supersede it with a new ADR. Do not leave it `proposed`.

## Bundled tooling

The validator is a .NET 10 file-based app. The skill folder holds everything it needs ([ADR-0017](../../../docs/decisions/0017-dotnet-file-based-apps-for-repo-tooling.md)):

```text
Directory.Build.props, .editorconfig, NuGet.config   # analyzers, warnings as errors, style, package sources
scripts/check-adr/check-adr.cs                        # CLI entry point (#! line, so ./check-adr.cs also works)
scripts/check-adr/AdrValidator.cs                     # all rules; pure logic, unit-tested
tests/check-adr.tests.cs                              # xUnit v3 tests; #:include the validator logic
tests/fixtures/valid/                                 # minimal valid ADR set that the tests mutate
```

- It needs the .NET 10 SDK. The first run on a machine compiles for about 30 s. After that, runs take under a second.
- To change a rule, edit `AdrValidator.cs`. Add or adjust an `[InlineData]` case in the tests. Then run `make tooling` (tests and whitespace check) and `make adr-check`.
- The package versions in `Directory.Build.props` and in the `#:package` directives are pinned exactly. Dependabot cannot see them (verified, ADR-0017). In this repo, `make tool-versions` fails when they differ from `backend/Directory.Packages.props`. `make tool-versions ARGS=--fix` updates them. In other repos, change them by hand.
