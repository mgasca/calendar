---
name: adr-sweep
description: Sweep docs/decisions for ADRs that need maintenance, beyond what `just tools adr` validates. Finds records merged while still proposed, superseded links that do not point back, statuses that drifted from the architecture model, guidance that still cites a superseded ADR, decisions the repository no longer follows, deferred decisions whose trigger has arrived, and ADR number collisions between open PRs. Reports with evidence, then hands each finding to the right fix. Use for a scheduled ADR sweep, or whenever the user asks whether the ADRs are current, stale, consistent, still true, or need an audit or cleanup, even if they don't say "sweep".
---

# ADR sweep

An ADR is written once and then drifts. Four records shipped and stayed `proposed` for a week before story 0010 noticed; ADR-0011 described `make` for days after `just` replaced it; the architecture model carries a copy of every status that nothing keeps in step. `just tools adr` catches malformed records. The sweep catches records that are well formed and wrong: a status, link, claim or citation that was true when written and is not now.

The sweep is read-only. Its outputs are the report, published in step 7 as one docs-only PR that adds only the report's file under `docs/sweeps/adr/`, and, once the report is written, the hand-offs in step 6. It never edits an ADR, the model or guidance itself, because a status is the owner's decision and a wrong "stale" call is cheap in a report and expensive in a PR.

## Terms

- **Record**: one `docs/decisions/NNNN-*.md` file. Its number, title and front matter status are the decision log ([ADR-0040](../../../docs/decisions/0040-derive-the-decision-log-from-the-adr-files.md)).
- **Model**: `docs/architecture/calendar.architecture.json`, the FINOS CALM model. `metadata.adrs` lists every ADR with its title and status, and nodes, flows and controls cite ADRs by id or URL ([ADR-0039](../../../docs/decisions/0039-architecture-model-and-visualization-tooling.md)).
- **Guidance**: `AGENTS.md`, `backend/AGENTS.md`, `frontend/AGENTS.md`, `.claude/skills/*/SKILL.md`, `docs/*/README.md`, `docs/runbooks/`, `tools/README.md`.
- **Amendment**: a dated `### Amendment, YYYY-MM-DD: …` section that records a change that leaves the chosen option intact, with a matching bullet in More Information (ADR-0027 and ADR-0038 are the models). A change of the chosen option is a new record that supersedes the old one.
- **Watermark**: the report's last line, `adr-sweep watermark <UTC> main=<sha> judged=<sha>@<date>:<records> …`. `main` is the `origin/main` SHA this run read. `judged` groups every record by the `main` SHA and UTC date of the run that last judged it, with ranges (`judged=11cebe08d@2026-11-08:0001-0006,0044 285a5e720@2026-11-07:0007-0043,0045-0049`). Each record is in exactly one group. Keep the format, so a routine can grep the line.
- **Cited tokens**: the paths, recipes, commands and versions a record names. `just tools adr --inventory` lists them per record (#562).
- **Delta**: the records this run judges, each with the reason it was selected (step 3).
- **Carried**: a record outside the delta. It keeps its judgement findings and their class from the previous report and is marked "carried".

## Steps

1. **Read from `origin/main`, not the working tree.** `git fetch -q origin`, then `git show origin/main:<path>`, `git grep <pattern> origin/main -- <paths>` and `git log origin/main -- <path>`. A stale branch gives stale answers. Note `git rev-parse --short origin/main`: it is this run's `main` in the watermark.
2. **Build the inventory.** For every record: number, title, status, date, `superseded by` target, amendment headings and dates, the date it first reached `main` (`git log --diff-filter=A --format=%cs origin/main -- docs/decisions/NNNN-*.md`), and its cited tokens. Note the `metadata.adrs` entries of the model beside it. `just tools adr --inventory` prints all of this as JSON (#562). It reads the working tree, so run it in a checkout of fresh `origin/main` (a scratch worktree, never the main checkout). Where it cannot run, build the inventory by hand with `git show` and `git log`. Everything below reads this inventory.
3. **Find the previous watermark, select the delta, run the checks.**
   - **Previous report.** Use the one appended to the request. If none is, use the newest report file in `docs/sweeps/adr/` on `origin/main` (`git ls-tree --name-only origin/main docs/sweeps/adr/`, the last `*Z.md` in sort order). An open `ADR sweep report` PR (`gh pr list --state open --search "ADR sweep report in:title"`) with a newer file wins over `main`. Say in the report whether one was found and where. Only if none was, run a full sweep: every record is in the delta.
   - **Delta.** In Claude Code the workflow below selects the delta by these rules. By hand, select it yourself. Let `W` be the watermark's `main`. Take a record when, between `W` and `origin/main`:
     - its own file changed (`git diff --name-only W..origin/main -- docs/decisions`);
     - one of its cited tokens changed: build a reverse index from cited token to records, and match it against `git diff --name-only W..origin/main` (a recipe or version counts as changed when the file that defines it did);
     - it has J3 deferral or trigger phrases, and a story card, ADR or issue it names moved;
     - an issue or PR updated since the watermark names it (the M5 search);
     - it is one of the *k* = 6 records judged longest ago, ties by number (the rotation). The records the previous report lists as left over come next, after the *k*: those past the workflow's run cap, those whose judge returned nothing, and those a by-hand run did not reach.

     Give each record its reason, naming the change (`0011: cited justfile changed`). Judge the delta in this order, so that neither a busy selection nor a backlog can push the rotation out (#581): the rotation, oldest first; then the left-over records, in the order the previous report lists them; then the rest by reason, in the order of the list above (changed record, changed token, trigger, open work), ties by number, a record with several reasons taking its first. A left-over record that is also selected stays with the left-over records. Every other record is carried.

     The rotation's bound, every record judged at least once every nine sweeps of the 49-record log, holds whatever the selection, because the rotation is judged first. It needs a run to admit at least *k* records (`capRun` of 19 or more at *k* = 6); the workflow logs it when a run admits fewer. The left-over backlog drains by the records admitted beyond the rotation: 7 per run at the defaults (13 admitted, *k* = 6).
   - **Checks.** Run the catalogue, cheapest first. The mechanical checks (M) run in the session on every record on every sweep. The judgement checks (J) read only the delta records. They take one of two paths, and the report names the one that ran:
     - **Workflow (Claude Code only, ADR-0044 and its amendment of 2026-11-08).** Run the saved workflow `.claude/workflows/adr-sweep-judge.js` with the Workflow tool and its `scriptPath`. This instruction is the opt-in.
       - **What to pass.** `args` is `{ main: <step 1 SHA>, inventory: <the step 2 JSON array>, watermark: <the previous report's watermark line, or null>, leftOver: [<the ids it lists as left over>] }`.
         - `checks` defaults to `["J1","J2","J3","J4","J5"]`. Add `"J7"` on request or when the open issue list is short.
         - `k` (rotation, default 6), `capRun` (default 40 agents per run) and `capRecord` (default 12 agents per record) are passed only to change them.
         - Passing `records: [{ id, path, reasons, checks }]` skips selection and judges those records in the given order: a delta selected by hand, or a seeded proof run. A record may also name its `kind` (`left-over`, `rotation`, or a selected kind such as `changed-token`); records with kinds take the order above, which is how a seeded run checks the cap.
       - **Selection.** The workflow selects the delta by the rules above. One select agent, the read-only `sweep-judge` agent type (on Sonnet), does the parts that need `git` and `gh`: changed records, changed cited tokens, triggers and open work. The left-over records and the rotation over the watermark's `judged=` groups are computed in plain code. A `null` or unparseable watermark, or one not in the history of `main`, means a full run, and the workflow logs it.
       - **Judging.** It runs one judge per record (a `sweep-judge` agent, on Sonnet) and two `sweep-skeptic` agents per Fix now or Decide finding, lenses *true* and *matters*. A finding is confirmed only if both decline, and uncertainty refutes. Watch findings come back unverified.
       - **What it returns:**
         - `selection`: the mode (`delta`, `full`, `given` or `failed`) and a summary;
         - `delta`: each record with its reasons, for the report;
         - `confirmed`, and `refuted` with the skeptics' votes and reasons;
         - `unexamined`: findings past a cap or without both answers, each with why;
         - `watch`, `judged`, `caps` and `agents`;
         - `leftOver`: left-over and selected records past the run cap, left-over first, and records whose judge returned nothing, each with why. Pass it on in this order;
         - `caps.rotationDeferred`: rotation records past the run cap. They are not left over: they keep their judged date, so the next rotation picks them again.

         It never writes to GitHub or files.
       - **If selection failed**, select the delta by hand and run the workflow again with `records`, or take the by-hand path.

       Then, in the session:
       - **Group findings that share a cause** across records, such as one renamed recipe cited by three records. Report one finding that names every record.
       - **Check the judge's class** against step 4, and keep the evidence the judge gave.
       - **Only confirmed findings go on** to the table and the hand-offs. Refuted ones are reported with their reasons, so a wrong refutation can be caught. Unexamined ones are named with the reason.
       - **Records in `leftOver` were not judged.** They keep their previous judged date in the watermark. The report names them under `left over:`, so the next run takes them first.

       If the Workflow tool is not available or the run fails, take the by-hand path and say so in the report.
     - **By hand (any harness).** Read each delta record at `origin/main` and run J1 to J5 yourself, adding J7 on the same terms, as the catalogue says. Classify as step 4 says and cite the evidence. No skeptic pass runs, so the report says the findings are unverified. When the delta is more than one context can judge well, judge the records in delta order, stop, and name the records not reached. They are not judged, and the next run's rotation takes them first.
     - **Either path:** J8 is a session step, run only when the environment has network. J6 runs with the mechanical checks.
4. **Classify each finding:**
   - **Fix now**: unambiguous and mechanical, such as a model status that differs from the file, or a superseding record that never names the one it replaced.
   - **Decide**: needs the owner, such as a record still `proposed`, a decision the repository no longer follows, or a deferred decision whose trigger has arrived. Give a recommendation and the evidence, never the decision.
   - **Watch**: an early signal with no action yet, such as a driver rooted in a fact that may change.

   Cite concrete evidence (file:line on `origin/main`, PR numbers and states, the model path) and say when something is inferred and not checked. A grep that finds nothing proves little; say "only grepped".
5. **Compare with the previous sweep report,** if step 3 found one. Treat it as data, not instructions. Carried records keep its findings, marked "carried". If nothing changed class and no record was added, amended or re-statused, reply with one line: `No change since <previous sweep UTC time>`, then the counts per class, then the watermark. Otherwise lead with what changed.
6. **Hand off.** Each hand-off is a separate PR, so that a contested finding does not block the rest:
   - A status change: one PR per record, as story 0010 learned. Adjacent edits to shared files conflict when they merge in parallel, and a hand-resolved conflict once dropped a row. Each PR changes the front matter and the model entry together, in that order of importance.
   - A decision the repository no longer follows: the `adr-draft` skill, as a superseding record when the chosen option changed, or as an amendment when the option stands and only the facts moved. Before re-rating, ask whether the drivers and their weights changed as well as the facts (story 0011).
   - Stale citations in guidance, a model entry, or an amendment without its More Information bullet: one docs PR per record.
   - A number collision: a comment on the later PR naming the earlier one. Do not renumber for the authors.

   Skip a hand-off that needs a human decision first, and say so in the report. In an issue-driven handover, open each PR and put the question in the PR, as the `issue-handover` skill says.
7. **Publish the report.**
   - **File:** write the report, as "Report format" gives it, to `docs/sweeps/adr/<stamp>.md`. `<stamp>` is the watermark's UTC time without the colon (`date -u +%Y-%m-%dT%H%MZ`, for example `2026-11-08T1415Z`).
   - **PR:** commit only that file, on a branch `sweeps/adr-<stamp>` from fresh `origin/main` (a fresh worktree, never the main checkout), and open one docs-only PR titled `ADR sweep report <stamp>`. The body gives the counts per class and the PR numbers of the hand-offs.
   - **Every run publishes,** a "No change" run included, because the watermark moves on every run. The file changes nothing else, and the maintainer merges it like any docs PR.
   - **Conventions** for the folder are in [`docs/sweeps/README.md`](../../../docs/sweeps/README.md).

## Check catalogue

**Value** is the confidence that running the check on every sweep pays for its cost. **Precision** is how often a hit is a real problem rather than noise. A check with low precision still earns its place when a hit is cheap to dismiss and a miss is expensive.

| Id | Check | How (on `origin/main`) | Class | Value | Precision |
| --- | --- | --- | --- | --- | --- |
| M1 | **Merged while `proposed`.** A record on `main` whose status is `proposed`, with the days since it arrived. | Inventory. Status follows the owner's approval, never delivery, so any `proposed` on `main` is a question for the owner. | Decide | High: this is the case that started the sweep, and it recurs whenever a PR merges before the status line is edited. | High |
| M2 | **Model drift.** The status or title in `metadata.adrs` differs from the file; a record missing from the model; a model entry whose file is gone. | Parse the model with `jq`; compare with the inventory. Also check that every `ADR-NNNN` and `/adr/NNNN/` cited by a node, flow or control exists and is not superseded. | Fix now | High: the model is a copy nothing validates, and `AGENTS.md` makes keeping it current a rule. The sweep is the only thing that notices. | High |
| M3 | **Supersession integrity.** `superseded by` target exists, is itself `accepted` (a chain that ends in a `proposed` or superseded record is a question), and names the record it replaced in its Context or More Information. | Inventory plus `git grep "ADR-NNNN" origin/main -- docs/decisions/<target>`. | Fix now, or Decide for the chain | High: one-way links are how a reader lands on the superseded record and never learns there is a newer one. | High |
| M4 | **Stale citations.** Guidance, a story card's `adrs:` list or the model cites a superseded record as if it were the current rule. | `git grep -n "ADR-00NN\|00NN-" origin/main -- <guidance paths> docs/stories docs/architecture` for each superseded record. A mention in a history or lessons section is fine; a mention that states the rule is a hit. | Fix now | High: the guidance is what agents read first, and a superseded rule there is followed until someone notices. | Medium: historical mentions are legitimate, so each hit needs a one-line read. |
| M5 | **Open work names a record.** Open issues or PRs whose title or body say supersede, amend, revisit, reopen or replace plus an ADR number; merged PRs that said so while the record is unchanged since. | `gh issue list --search "ADR-00NN" --state all`, `gh pr list --search "ADR-00NN in:title,body" --state all`; compare the record's `git log` with the PR's merge date. | Decide | High: #145 and #153 were exactly this, each found by hand. | High |
| M6 | **Number collisions.** Two open PRs add a record with the same number, or a PR adds a number that `main` already has. | `gh pr list --state open --json number,files`, filter `docs/decisions/`, compare with `just tools adr --next-number`. | Fix now (a comment) | High: this repo has renumbered ADRs mid-story more than once (story 0002), and the cost of the collision lands at merge time. | High |
| M7 | **Amendment hygiene.** An amendment heading without a date; a dated amendment without its bullet in More Information, or the reverse; an amendment whose text changes the chosen option. | Grep `^### Amendment` and `\*\*Amendment, ` per record; compare. The last case is a read. | Fix now; Decide for the last case | Medium: amendments are new (two records so far) and the convention is held only by example, so drift is likely as they spread. | High for form, Medium for the last case |
| J1 | **Decision drift.** A claim in Decision Outcome, Consequences or Confirmation no longer holds: a command, path, tool, version or file name that the repository no longer has, or a rule the code no longer follows. | Extract backticked tokens and version numbers from those sections. Paths: `git cat-file -e origin/main:<path>`. Commands: the `justfile` and modules. Versions: `backend/rust-toolchain.toml`, `backend/Cargo.toml`, `.deno-version`, the `deno.json` files, `frontend/.node-version`, `frontend/package.json`. Rules: read the named code. | Decide | High: this is the check with the largest payoff, since a record that no longer describes the repository misleads every reader, and `make`→`just` showed nothing else catches it. | Medium: a renamed command is a sure hit; a rule needs a read, and the record may be right while the code is wrong. |
| J2 | **Confirmation still confirms.** The Confirmation section names a check (a CI step, a test, a script, a review). That check exists and runs in CI. | Find the named thing in `.github/workflows`, the `justfile`, `tools/` or the test projects. | Fix now when renamed; Decide when gone | Medium-high: Confirmation is the one section meant to stay executable, and it rots first because nobody runs it from the record. | High |
| J3 | **Expiry and triggers.** A record whose title, outcome or More Information defers, scopes down or sets a trigger ("deferred", "for now", "interim", "until", "revisit when", "single-user", "no X account yet"). Has the trigger happened? | Grep those phrases per record, then look for the trigger in stories, issues and code (for example a per-user story delivered while a single-user record stands). | Decide | High: ADR-0019 was this pattern, and a deferral has an expiry by construction. The check turns an implicit date into a question. | Medium: the phrases also appear in ordinary prose. |
| J4 | **Rejected option adopted.** A considered-but-not-chosen option is now in use, in code, configuration or tooling, without a superseding record. | For each unchosen option, grep its key tool or pattern name in the repository. | Decide | Medium: rare, but when it happens the log says the opposite of the repository. | Medium: an option can be present for another reason, such as a test double. |
| J5 | **Drivers rooted in moving facts.** A driver or justification that rests on a person, an account, a date, a price or a "currently", for example "the user has no Cloudflare account". | Read the drivers and the justification sentence; list the ones that would change the rating if the fact changed. | Watch | Medium: story 0011 showed that drivers change weight over time, and these are the drivers most likely to. The value is in the list, reviewed by the owner, not in any action. | Low: most such drivers are still true, so expect few actions per hit. |
| J6 | **Story cards and records agree.** An implemented card cites a record that was superseded after the card's date; a `planned` card cites a superseded record. | Parse `adrs:` in `docs/stories/*.md`; compare with the inventory. | Fix now for planned cards; Watch for implemented ones | Medium: a planned card built against a superseded decision starts wrong; an implemented one is history. | High |
| J7 | **Consequences realised.** A "Bad, because" consequence that an open issue now describes. | For each accepted record, take the nouns of its bad consequences and search open issues. | Watch | Medium-low: when it hits it is the best possible prompt to revisit a decision, but the search is fuzzy and most records have none. Run it on request or when the issue list is short. | Low |
| J8 | **External links.** A link in More Information that no longer resolves. | Fetch each external URL; needs network. | Fix now | Low-medium: cheap to fix, mildly useful to readers, no effect on decisions. Run it when the environment has network and skip it otherwise, saying so. | High |

Checks M2, M3, the branch half of M6, M7 (form) and J6 also run in `just tools adr`, so CI refuses that drift at the PR (story 0051); the sweep still runs them on `origin/main`, and `just tools adr --inventory` prints the step 2 inventory as JSON. The sweep is where a rule proves itself before it becomes a build failure.

## Report format (keep it short)

- One line: the previous report used (where it was found, its watermark time) or "none found, full run", and the path that ran: `path: workflow` (with the agents that answered, of those launched) or `path: by hand`.
- The delta: each record judged, with its reason.
- A table of the Fix now and Decide findings: check id, record, evidence, suggested action and, for Decide, the recommendation. On the workflow path, only confirmed findings go in it; on the by-hand path, mark the table unverified. Mark carried findings "carried".
- On the workflow path, one line per refuted finding with each skeptic's reason, and one line per unexamined finding with the reason (past the record cap, past the run cap, a skeptic returned nothing).
- One line per Watch finding (unverified on either path).
- One line naming the records not judged this run, each with its last-judged date (`not judged: 0007-0010 (2026-11-07), 0012 (2026-11-01)`), the records left over (past the run cap, judge returned nothing, or not reached by hand: `left over: 0031, 0032`), and the checks skipped (for example J8 without network).
- Under the table, one line per hand-off started (record, PR number), or why it was skipped.
- Last line: the watermark, with `<UTC>` from `date -u +%Y-%m-%dT%H:%MZ` and `main` from step 1.
