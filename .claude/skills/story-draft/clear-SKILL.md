---
name: story-draft
description: Draft or update a user story card in docs/stories for review, following this repo's conventions (story statement, agreed scope, Given-When-Then acceptance criteria, ADR table, implementation notes, user guide), keep the stories index and the docs-site validation green, and open a review PR. Use when the user asks to draft, write, add, plan, split or schedule a story or story card, turns a GitHub issue or feature idea into a story, or asks to finish, update or mark implemented an existing story card (test links, lessons learned, user guide), even if they don't say "card".
---

# Story draft

A story card is the long-lived record of a feature: what was asked, what was agreed, how it was decided and built, and how a user uses it. GitHub issues drive day-to-day execution; the card in `docs/stories/` is the durable truth ("PR 0" adds it, a later PR completes it). Write the card so a reviewer can approve the scope before any code exists, and so a future reader can trust it after delivery.

## Terms

- **Card**: one Markdown file in `docs/stories/` that describes one story.
- **PR 0**: the first pull request of a story. It is docs-only and adds the card.
- **ADR**: Architecture Decision Record, a file in `docs/decisions/` that records a significant technical choice. Cards link to ADRs by number (for example 0018).
- **Index**: the table in `docs/stories/README.md` that lists every card.
- **Front matter**: the block of `key: value` lines between the two `---` lines at the top of a card.
- **Given-When-Then**: the format of one acceptance criterion: a starting state, an action, an observable result.
- **`XXXX` card**: a planned story that has no number yet because it is not scheduled.

## Before you start: read these parts

Do this at the start of every run. These files win over anything restated here. Read only the parts listed:

- `docs/stories/README.md`: the whole file (it is short): naming, "Source of truth", sections, front matter, the index table
- `docs/stories/story-template.md`: the whole file; the skeleton to copy, with the front matter rules in its leading comment
- `AGENTS.md`: the "Stories and issues" section (PR 0 workflow), and in "Architecture" only the **Backend**, **Frontend** and **ADRs** bullets, for the conventions the card must not contradict. Skip the practices sections unless the story touches them
- `README.md`: only the opening paragraphs before `## Layout`, so the story is described in the product's terms
- One finished card as a model: `docs/stories/0007-*.md`; and for a planned one, `docs/stories/XXXX-*.md`. Read the `##` sections you are about to write, not the whole card

## Pick the mode

Choose one. Each mode says where to go next.

- **New card (PR 0):** the story is new or comes from an issue. Produce a docs-only PR with a `planned` card. Follow steps 1 to 7 under "New card". A story that starts as an issue always begins this way.
- **Completing a card:** code has landed or is about to. Set the status, fill implementation notes, link tests, write the user guide. Go to "Completing a card".
- **Split or reschedule:** a planned `XXXX` card gets its number when it is scheduled. Go to step 3, "Numbering and filename".

## New card

### 1. Ground yourself

You need: the repo checked out, and `gh` signed in if the story comes from an issue.

- If the story comes from an issue, read it **and all its comments** (`gh issue view N --comments`): approvals and changes of direction arrive there.
- Read the neighbouring stories (`ls docs/stories`) and grep for the topic. State how this story relates to earlier ones: what it reuses, what it leaves to them, and what it must come after. Cards are linked by number, e.g. `[0004](0004-add-event-entries.md)`.
- Skim the code the story touches so "what exists today" is accurate. Don't write the implementation; the card describes behaviour and agreed scope.
- Find relevant ADRs (`grep -ril <topic> docs/decisions`, and the index). Common ones: 0018 time representation, 0020 agenda read models, 0021 client-supplied `today`/`timeZone`, 0026 routing, 0027 auth. A story must not contradict an accepted ADR; if it needs to, that is an ADR (use `adr-draft`), not a story detail.

You are done with this step when you can say what exists today, how the story relates to earlier stories, and which ADRs apply.

### 2. Settle the open questions before writing

Ask with AskUserQuestion (up to 4 questions, concrete options, a recommended one) when the answer changes scope or acceptance criteria: who the user is, what is explicitly out of scope, deadlines or limits, behaviour on errors. Don't invent product preferences. If the user can't answer yet, write the best reading and mark it "(proposed)" or "to be confirmed by the product owner", as the planned cards do.

### 3. Numbering and filename

The file name is `docs/stories/NNNN-lowercase-kebab-title.md`.

- Numbers follow delivery order. A story that is not yet scheduled is `XXXX-…md` with the heading `# XXXX Title`. It gets the next number when it is scheduled. To renumber, rename the file, fix the heading, fix the index row and fix every link.
- Next number = highest existing + 1, **after fetching** (`git fetch`), so two stories don't take the same number.
- Say in the card when an `XXXX` story must come after other stories.

### 4. Write the card

Copy `docs/stories/story-template.md` and fill it with the Write tool (shell heredocs mangle backticks and `$`). Delete its HTML comments.

The five `##` sections must be present, in this order: Story, Background, Design decisions, Implementation notes, User guide. A docs test enforces this. Extra `##` sections are allowed. Keep the template's subsections and the ADR table. Drop a subsection only when the story is as small as 0005, and say "No changes" rather than deleting `### API`.

**Front matter** (validated by `frontend/apps/docs/src/lib/adr.ts`, `parseStories`)

- `status`: `planned`, `in-progress` or `implemented`; must equal the index row.
- `date`: `YYYY-MM-DD`, the day the card is created.
- `issue`: URL of the GitHub issue the story started from (`https://github.com/<owner>/<repo>/issues/N`, validated). Omit the line only if there was no issue.
- `pr`: a **list** of PR URLs in delivery order; `[]` while there are none. A scalar (a single value that is not a list) is rejected by the build. Add each PR as it is opened, including the card's own PR 0.
- `adrs`: **quoted** four-digit strings, `["0018", "0021"]` (YAML reads a bare `0016` as a different number). Every number must exist. Use `[]` if none.

**`# NNNN Title`**: must equal the index title prefixed with the number. Phrase it as the outcome ("Add event entries so I know when my appointments are"), not the implementation.

**`## Story`**: one blockquote, `> As a <role>, I need <capability> so that <benefit>.` Use the role names the existing cards use (calendar editor, forward planner, calendar owner) unless the user gives another. Below it, add "Tracked in issue #N." when there is one, and for derived wording a note such as "to be confirmed by the product owner".

**`## Background`**: what exists today and why this story is next, in a few short paragraphs. Then:

- `### Agreed scope` (or `### Scope`): bullets of concrete user-visible behaviour, bold lead-in then the detail. Include limits and rules (caps, ordering, validation, DST handling) that reviewers would otherwise have to guess.
- `### Not in this story`: bullets of what a reader might assume is included, with where it goes (another story, a follow-up). This is what stops scope creep during review, so be specific.
- `### Dependencies` when the story must follow others.
- `### Acceptance criteria`: see below.

**Acceptance criteria**: a numbered list, each `**Given** … **when** … **then** …`, one observable outcome per criterion. Reasons:

- Each criterion should map to at least one test later; vague criteria ("works well") can't be linked or failed. Write from the user's point of view, but be exact about numbers, states and error behaviour.
- Cover the happy path, the main failure or edge case (validation, empty state, stale data, DST or time zone when time is involved), keyboard and accessibility when the UI is new, and persistence/refresh when data changes.
- End with the delivery criterion: `**Given** the change is complete, **when** I run `make check`, **then** it passes` (add "including the regenerated contract" when the API changes).
- While `planned`, criteria carry no test links. Links are added on completion.

**`## Design decisions`**

- A table of ADRs the story relies on: `| ADR | Decision | Why it matters for this story |`, with links `[0018](../decisions/0018-….md)` (relative, and the file name must exist; the docs build fails on broken document links). Say "No new ADR is expected." or name the decision that needs one.
- `### Other decisions (not ADR-worthy)`: small choices with a reason, bold lead-in. A choice that is hard to reverse, affects several stories or picks a dependency belongs in an ADR instead.

**`## Implementation notes`**: for a planned card, start with the italic line *Planned. This section is completed as the story is built.* Then add the template's subsections:

- `### Where things live`: a table of area to path. While the card is planned, this is a forecast.
- `### API`: endpoints, or "No changes expected".
- `### Testing`: the layers and cases that matter, e.g. pure tests, MSW (Mock Service Worker, a library that fakes HTTP calls in tests) component tests, API tests with Testcontainers, agreement tests.
- `### Lessons learned, known issues and follow-ups`: filled in on delivery.

Check paths and endpoint names against the code. Do not guess them.

**`## User guide`**: written for end users, since these sections are mined for user documentation. For a planned card, start with the italic line *Planned behaviour. This section is finalised when the story is implemented.* Then describe the behaviour in plain language: bold UI labels (**Add event**), steps, what the user sees, current limitations. No file paths, no jargon from the codebase.

### 5. Index

Add a row to `docs/stories/README.md`. The title and status must equal the card's heading and front matter exactly:

```markdown
| [NNNN](NNNN-title.md) | <title without the number> | planned |
```

Keep rows in number order, with `XXXX` rows last. If the card relies on a convention that README.md or AGENTS.md describe, link it instead of restating it. Update the product summary in `README.md` only when the story is delivered and user-visible, as story 0003 did.

### 6. Validate

Story files are checked by the docs site's parser. It checks the index against the files, the status, the date, that the quoted `adrs` exist, and the links between documents. Run this from the repo root:

```sh
corepack pnpm --dir frontend --filter @calendar/docs test
```

It passes when the tests report no failures. A failure names the card and the rule it broke. Fix every failure and run it again.

Before delivery, also run `make build-docs` if the card links to other documents or code. It passes when the site builds with no broken-link errors.

The parser can't judge scope, so check it yourself. Re-read the acceptance criteria against the scope bullets. Check that no "not in this story" item reappears in the criteria.

If `pnpm` cannot run (no network or `node_modules`), say so and report what was not validated.

### 7. Deliver for review

You need: `git` and `gh` signed in, with permission to push a branch. `main` is protected, so never push to it.

```sh
git switch main && git pull --ff-only
git switch -c docs/story-NNNN-short-slug      # or docs/story-xxxx-short-slug
git add docs/stories README.md
git commit                                    # include the repo's Co-Authored-By trailer
git push -u origin docs/story-NNNN-short-slug
gh pr create --base main --title "Story NNNN: <title>" --body-file <file>
```

`gh pr create` prints the PR URL. If it prints no URL, the PR was not created.

This is PR 0. For an issue-driven story, the PR body must have these parts:

- `Refs #N` (not `Closes`: the PR that completes the story closes it)
- a summary of the story
- the agreed scope and out-of-scope lists
- open questions for the reviewer (numbered)
- a checklist

Then post a short comment on the issue. Link the card and summarise the scope decisions, so the decision trail stays on the issue. The typical order afterwards is PR 0 (card), backend, frontend, card update; plan those with the user if they ask. Don't merge; that is the user's call.

Tell the user, in plain language:

- the story as written
- the scope decisions you made on their behalf
- the numbered open questions
- what you validated and what you couldn't
- the PR link

## Completing a card

Do this in the PR that delivers the story or in a card-only PR; a story isn't done until its card is. `Closes #N` goes on the PR that completes the story. Before editing, re-read the issue comments and the merged PRs (`gh pr view`, `git log`), because the delivered behaviour may differ from the plan.

1. **Front matter:** set `status: implemented` (or `in-progress` while delivering in stages). Append every delivering PR to the `pr` list. Update `adrs` if new ones were relied on. Update the index row's status to match. Remove "(proposed)" markers and the *Planned* italics.
2. **Scope and criteria:** change them only to record what was actually agreed and shipped. If scope was dropped, move it to "Not in this story" or follow-ups rather than silently deleting it.
3. **Link every criterion to its tests**, with a relative link to the file and line or the test name, e.g. `[Redirect to sign-in](../../frontend/apps/web/src/features/auth/auth.test.tsx) (`redirects signed-out visitors…`)`. Verify each link points at a test that exists and asserts the criterion. Where a criterion isn't automatically tested, say so plainly ("checked by hand", "not exercised in a real browser"). Honest gaps beat a clean-looking card.
4. **Implementation notes:** write down where the code lives (key files and symbols), the API surface (endpoints, status codes, contract regenerated), persistence and migrations, testing, and the delivery plan with the PRs. Add what future contributors need: lessons learned, measurements (state whether measured or inferred, and with what data), known issues and limits, and follow-up stories (open an `XXXX` card or issue for deferred scope, don't leave it as a loose sentence).
5. **User guide:** finalise it against the real UI labels and behaviour, including current limitations. Run the app (`run` skill or `make dev-web`) if you can; otherwise derive labels from the components and tests and say so.
6. Validate as in step 6, then deliver as in step 7 (title `Story NNNN: implementation notes, test links and user guide`).

## Pitfalls seen in this repo

- A bare `0016` in `adrs`, a title that differs from the index, or an index status that differs from the card fails the docs build.
- Hard-coding the list of stories in tests: derive it from `docs/stories/`.
- Links to ADRs or other stories must be relative file links with a real file name; the site rewrites them to routes.
- Cards are read long after the issue is gone: spell out the reasoning behind scope decisions instead of writing "as discussed".
- Don't put implementation detail in the Story or Scope; that belongs in Implementation notes after the code exists.
