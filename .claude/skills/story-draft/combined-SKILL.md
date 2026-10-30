---
name: story-draft
description: Draft or update a user story card in docs/stories for review, following this repo's conventions (story statement, agreed scope, Given-When-Then acceptance criteria, ADR table, implementation notes, user guide), keep the stories index and the docs-site validation green, and open a review PR. Use when the user asks to draft, write, add, plan, split or schedule a story or story card, turns a GitHub issue or feature idea into a story, or asks to finish, update or mark implemented an existing story card (test links, lessons learned, user guide), even if they don't say "card".
---

# Story draft

A story card is the long-lived record of a feature: what was asked, what was agreed, how it was decided and built, and how a user uses it. GitHub issues drive the daily work. The card in `docs/stories/` is the durable truth. "PR 0" adds the card. A later PR completes it. Write the card so that a reviewer can approve the scope before any code exists, and so that a future reader can trust it after delivery.

## Terms

- **Card**: one Markdown file in `docs/stories/` that describes one story.
- **PR 0**: the first pull request of a story. It is docs-only and adds the card.
- **ADR**: Architecture Decision Record, a file in `docs/decisions/` that records a significant technical choice. Cards link to ADRs by number (for example 0018).
- **Index**: the table in `docs/stories/README.md` that lists every card.
- **Front matter**: the `key: value` lines between the two `---` lines at the top of a card.
- **Given-When-Then**: the format of one acceptance criterion: a starting state, an action, an observable result.
- **`XXXX` card**: a planned story that has no number yet because it is not scheduled.

## Before you start: read these parts

At the start of every run, read only these parts. They win over anything restated here.

- `docs/stories/README.md`: the whole file (it is short). It covers naming, "Source of truth", sections, front matter, and the index table.
- `docs/stories/story-template.md`: the whole file. It is the skeleton to copy. Its leading comment holds the front matter rules.
- `AGENTS.md`: the "Stories and issues" section (the PR 0 workflow). In "Architecture", read only the **Backend**, **Frontend** and **ADRs** bullets. The card must not contradict their conventions. Skip the practices sections unless the story touches them.
- `README.md`: only the opening paragraphs before `## Layout`. Use them to describe the story in the terms of the product.
- One finished card as a model: `docs/stories/0007-*.md`. For a planned card, read `docs/stories/XXXX-*.md`. Read only the `##` sections that you are about to write.

## Pick the mode

Choose one. Each mode says where to go next.

- **New card (PR 0):** the story is new or comes from an issue. Produce a docs-only PR with a `planned` card. Follow steps 1 to 7 under "New card". A story that starts as an issue always begins this way.
- **Completing a card:** code has landed or is about to. Go to "Completing a card".
- **Split or reschedule:** a planned `XXXX` card gets its number when it is scheduled. Go to step 3, "Numbering and filename".

## New card

### 1. Ground yourself

You need the repo checked out, and `gh` signed in if the story comes from an issue.

- If the story comes from an issue, read the issue and **all its comments** (`gh issue view N --comments`). Approvals and changes of direction arrive in the comments.
- Read the neighbouring stories (`ls docs/stories`) and grep for the topic. State how this story relates to earlier ones: what it reuses, what it leaves to them, and what it must come after. Link cards by number, for example `[0004](0004-add-event-entries.md)`.
- Skim the code that the story touches, so that "what exists today" is accurate. Do not write the implementation. The card describes behaviour and agreed scope.
- Find the relevant ADRs (`grep -ril <topic> docs/decisions`, and the index). Common ones are 0018 time representation, 0020 agenda read models, 0021 client-supplied `today`/`timeZone`, 0026 routing, and 0027 auth. A story must not contradict an accepted ADR. If it must, that change is an ADR (use `adr-draft`), not a story detail.

You are done when you can say what exists today, how the story relates to earlier stories, and which ADRs apply.

### 2. Settle the open questions before writing

If the answer changes the scope or the acceptance criteria (who the user is, what is out of scope, deadlines or limits, behaviour on errors), ask with AskUserQuestion. Ask up to 4 questions, give concrete options, and mark one as recommended. Do not invent product preferences. If the user cannot answer yet, write the best reading and mark it "(proposed)" or "to be confirmed by the product owner", as the planned cards do.

### 3. Numbering and filename

The file name is `docs/stories/NNNN-lowercase-kebab-title.md`.

- Numbers follow delivery order. A story that is not yet scheduled is `XXXX-…md` with the heading `# XXXX Title`. It gets the next number when it is scheduled. To schedule it, rename the file, then fix the heading, the index row and every link.
- The next number is the highest existing number plus 1, found **after fetching** (`git fetch`), so that two stories do not take the same number.
- If an `XXXX` story must come after other stories, say so in the card.

### 4. Write the card

Copy `docs/stories/story-template.md` and fill it with the Write tool (shell heredocs mangle backticks and `$`). Delete its HTML comments.

A docs test requires the five `##` sections in this order: Story, Background, Design decisions, Implementation notes, User guide. Extra `##` sections are allowed. Keep the subsections and the ADR table of the template. Drop a subsection only when the story is as small as 0005. Write "No changes" instead of deleting `### API`.

**Front matter** (`parseStories` in `frontend/apps/docs/src/lib/adr.ts` validates it)

- `status`: `planned`, `in-progress` or `implemented`. It must equal the index row.
- `date`: `YYYY-MM-DD`, the day that you create the card.
- `issue`: the URL of the GitHub issue that the story started from (`https://github.com/<owner>/<repo>/issues/N`, validated). Omit the line only if there was no issue.
- `pr`: a **list** of PR URLs in delivery order. Use `[]` while there are none. The build rejects a scalar (a single value that is not a list). Add each PR when it is opened, including the PR 0 of the card.
- `adrs`: **quoted** four-digit strings, for example `["0018", "0021"]`. YAML reads a bare `0016` as a different number. Every number must exist. Use `[]` if there are none.

**`# NNNN Title`**: this must equal the index title with the number in front. Phrase it as the outcome, not the implementation. Example: "Add event entries so I know when my appointments are".

**`## Story`**: one blockquote, `> As a <role>, I need <capability> so that <benefit>.` Use the role names that the existing cards use (calendar editor, forward planner, calendar owner), unless the user gives another. Below the blockquote, add "Tracked in issue #N." when there is an issue. If the wording is derived, add a note such as "to be confirmed by the product owner".

**`## Background`**: write a few short paragraphs on what exists today and why this story is next. Then add these subsections:

- `### Agreed scope` (or `### Scope`): bullets of concrete behaviour that the user can see. Start each bullet with a bold lead-in, then give the detail. Include the limits and rules (caps, ordering, validation, DST handling) that reviewers would otherwise have to guess.
- `### Not in this story`: bullets of what a reader might assume is included, and where it goes (another story or a follow-up). Be specific. This list stops scope creep during review.
- `### Dependencies`: add it when the story must follow other stories.
- `### Acceptance criteria`: see below.

**Acceptance criteria** are a numbered list. Each item has the form `**Given** … **when** … **then** …` and has one observable outcome. The reasons:

- Each criterion must map to at least one test later. A vague criterion ("works well") cannot be linked or failed. Write from the point of view of the user, but be exact about numbers, states and error behaviour.
- Cover the happy path and the main failure or edge case (validation, empty state, stale data, and DST or time zone when time is involved). Cover keyboard and accessibility when the UI is new. Cover persistence and refresh when data changes.
- End with the delivery criterion: `**Given** the change is complete, **when** I run `make check`, **then** it passes`. If the API changes, add "including the regenerated contract".
- While the card is `planned`, the criteria carry no test links. Add the links on completion.

**`## Design decisions`**

- Add a table of the ADRs that the story relies on: `| ADR | Decision | Why it matters for this story |`. Write links like `[0018](../decisions/0018-….md)`. They must be relative, and the file name must exist (the docs build fails on broken document links). Write "No new ADR is expected." or name the decision that needs one.
- `### Other decisions (not ADR-worthy)`: list small choices, each with a reason and a bold lead-in. A choice that is hard to reverse, affects several stories, or picks a dependency belongs in an ADR.

**`## Implementation notes`**: for a planned card, start with the italic line *Planned. This section is completed as the story is built.* Then add the subsections of the template:

- `### Where things live`: a table of area to path. While the card is planned, it is a forecast.
- `### API`: the endpoints, or "No changes expected".
- `### Testing`: the layers and cases that matter, for example pure tests, MSW (Mock Service Worker, a library that fakes HTTP calls in tests) component tests, API tests with Testcontainers, and agreement tests.
- `### Lessons learned, known issues and follow-ups`: fill it in on delivery.

Check paths and endpoint names against the code. Do not guess them.

**`## User guide`**: write it for end users, because these sections are mined for user documentation. For a planned card, start with the italic line *Planned behaviour. This section is finalised when the story is implemented.* Then describe the behaviour in plain language: bold UI labels (**Add event**), steps, what the user sees, and current limitations. Use no file paths and no jargon from the codebase.

### 5. Index

Add a row to `docs/stories/README.md`. The title and status must equal the heading and the front matter of the card exactly.

```markdown
| [NNNN](NNNN-title.md) | <title without the number> | planned |
```

Keep the rows in number order, with `XXXX` rows last. If the card relies on a convention that README.md or AGENTS.md describes, link to it. Do not restate it. Update the product summary in `README.md` only when the story is delivered and visible to users, as story 0003 did.

### 6. Validate

The parser of the docs site checks the story files: index against files, status, date, quoted `adrs` that exist, and links between documents. Run this from the repo root:

```sh
corepack pnpm --dir frontend --filter @calendar/docs test
```

It passes when the tests report no failures. A failure names the card and the rule it broke. Fix every failure and run it again.

Before you deliver, also run `make build-docs` if the card links to other documents or code. It passes when the site builds with no broken-link errors.

The parser cannot judge scope. Compare the acceptance criteria with the scope bullets. Make sure that no "not in this story" item reappears in the criteria.

If `pnpm` cannot run (no network or no `node_modules`), say so and report what you did not validate.

### 7. Deliver for review

You need `git`, and `gh` signed in, with permission to push a branch. `main` is protected. Never push to it.

```sh
git switch main && git pull --ff-only
git switch -c docs/story-NNNN-short-slug      # or docs/story-xxxx-short-slug
git add docs/stories README.md
git commit                                    # include the repo's Co-Authored-By trailer
git push -u origin docs/story-NNNN-short-slug
gh pr create --base main --title "Story NNNN: <title>" --body-file <file>
```

`gh pr create` prints the PR URL. If it prints no URL, the PR was not created.

This is PR 0. For a story that comes from an issue, the PR body must have these parts:

- `Refs #N` (not `Closes`, because the PR that completes the story closes the issue)
- a summary of the story
- the lists of agreed scope and out-of-scope items
- numbered open questions for the reviewer
- a checklist

Then post a short comment on the issue. The comment links the card and summarises the scope decisions, so that the decision trail stays on the issue. The usual order afterwards is PR 0 (card), backend, frontend, card update. Plan those with the user if they ask. Do not merge. The user decides that.

Tell the user, in plain language:

- the story as written
- the scope decisions that you made for them
- the numbered open questions
- what you validated and what you could not validate
- the PR link

## Completing a card

Do this in the PR that delivers the story, or in a card-only PR. A story is not done until its card is. `Closes #N` goes on the PR that completes the story. Before you edit, read the issue comments again and read the merged PRs (`gh pr view`, `git log`). The delivered behaviour can differ from the plan.

1. **Front matter:** set `status: implemented` (or `in-progress` while you deliver in stages). Append every delivering PR to the `pr` list. Update `adrs` if the story relied on new ADRs. Update the status of the index row to match. Remove the "(proposed)" markers and the *Planned* italic lines.
2. **Scope and criteria:** change them only to record what was agreed and shipped. If scope was dropped, move it to "Not in this story" or to the follow-ups. Do not delete it silently.
3. **Link every criterion to its tests.** Use a relative link to the file and line, or to the test name. Example: `[Redirect to sign-in](../../frontend/apps/web/src/features/auth/auth.test.tsx) (`redirects signed-out visitors…`)`. Make sure that each link points at a test that exists and asserts the criterion. If a criterion has no automatic test, say so plainly ("checked by hand", "not exercised in a real browser"). An honest gap is better than a clean-looking card.
4. **Implementation notes:** write where the code lives (key files and symbols), the API surface (endpoints, status codes, contract regenerated), persistence and migrations, testing, and the delivery plan with the PRs. Add what future contributors need: lessons learned, measurements (state whether you measured or inferred them, and with what data), known issues and limits, and follow-up stories. For deferred scope, open an `XXXX` card or an issue. Do not leave it as a loose sentence.
5. **User guide:** finalise it against the real UI labels and behaviour, including current limitations. If you can, run the app (`run` skill or `make dev-web`). If you cannot, derive the labels from the components and tests, and say so.
6. Validate as in step 6. Then deliver as in step 7, with the title `Story NNNN: implementation notes, test links and user guide`.

## Pitfalls seen in this repo

- A bare `0016` in `adrs`, a title that differs from the index, or an index status that differs from the card fails the docs build.
- Do not hard-code the list of stories in tests. Derive it from `docs/stories/`.
- Links to ADRs or other stories must be relative file links with a real file name. The site rewrites them to routes.
- People read cards long after the issue is gone. Write out the reasoning behind scope decisions. Do not write "as discussed".
- Do not put implementation detail in the Story or in the Scope. It belongs in Implementation notes, after the code exists.
