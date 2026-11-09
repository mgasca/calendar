---
status: planned
date: 2026-11-08
issue: https://github.com/mgasca/calendar/issues/559
pr:
  - https://github.com/mgasca/calendar/pull/566
adrs: ["0017", "0039", "0040", "0044"]
---

# 0051 Sweep only what changed, and check each finding before it reaches me

## Story

> As a maintainer who works through AI coding agents, I need the ADR and issue sweeps to judge every item within a bounded number of runs, spend each run on what changed, and have each finding checked before I read it, so that a sweep report is complete enough to trust and the decisions it asks of me are real ones.

Tracked in epic [#559](https://github.com/mgasca/calendar/issues/559), with PR 0 as [#560](https://github.com/mgasca/calendar/issues/560). The card is the source of truth from here on. The proposal was first written as an agent-thoughts post in [#558](https://github.com/mgasca/calendar/pull/558). That PR was closed in favour of this card. The maintainer answered the open questions in conversation on 2026-11-08, as recorded below.

## Background

The [`adr-sweep`](https://github.com/mgasca/calendar/blob/main/.claude/skills/adr-sweep/SKILL.md) and [`issue-sweep`](https://github.com/mgasca/calendar/blob/main/.claude/skills/issue-sweep/SKILL.md) skills each run in a single context: read `origin/main`, build an inventory, check each item, classify, compare with the previous report, and hand off. Both are read-only until the hand-off.

The ADR sweep has a catalogue of fifteen checks: seven mechanical (M1 to M7) and eight judgement checks (J1 to J8). The mechanical checks are cheap and need the whole inventory. The judgement checks are per record and carry the largest payoff, because they catch a record that is well formed and wrong. They are also the checks one context cannot finish. The sweep of 2026-11-07 ([0045](0045-resolve-the-adr-sweep-findings-of-2026-11-07.md)) passed every mechanical check, and its own record says that "the judgement review was selective". Its seven Decide records became seven child issues for the maintainer to answer.

The issue sweep sorts each open issue into Safe to close, Nearly done or Still open, and hands the first two to `issue-closeout`, which posts on the issue, writes a card and opens a PR. A wrong "safe to close" is the expensive mistake. There were 12 open issues on 2026-11-08, a set one context handles well.

Both sweeps re-read everything on every run. Neither has a watermark, so neither can say which items it has not judged lately.

[0035](0035-review-before-merge-with-a-workflow-and-a-skeptic-per-finding.md) added the repository's first workflow: reviewers in parallel, skeptics per finding, structured data back to the session, which does the posting. [0025](0025-consolidate-what-agent-sessions-learned-into-guidance.md) added the watermark pattern to `dream-weaver`. This story reuses both. It changes neither `skeptic` nor `review-before-merge.js`.

[ADR-0044](../decisions/0044-claude-first-agent-automation.md) lets skills use Claude Code mechanisms during the Claude-first period. It also says that scheduled work "is scheduled and run in mj on a non-Claude harness", and it deferred whether the skills that scheduled work runs must stay harness-neutral ([#366](https://github.com/mgasca/calendar/pull/366)). The maintainer has since said that the sweep schedule runs in mj and may start Claude Code or another harness. So the sweeps need both paths, and ADR-0044 needs an amendment that says so.

### Agreed scope

* **ADR-0044 amendment first** ([#561](https://github.com/mgasca/calendar/issues/561)). This is a dated amendment, written with `adr-draft`. It answers the deferred question for `issue-sweep` and `adr-sweep`: the schedule runs in mj, on Claude Code or another harness. In Claude Code these skills may use workflows and agent definitions, and each keeps a short by-hand path any harness can follow. The report says which path ran. The chosen option is unchanged, so no new record is written. `dream-weaver` is out of scope.
* **The branch-only mechanical checks move into `check-adr`** ([#562](https://github.com/mgasca/calendar/issues/562)):
  * M2: model drift, including cited ADRs that are missing or superseded;
  * M3: supersession integrity;
  * the branch half of M6: a number already on `main`;
  * M7: amendment form;
  * J6: a `planned` card citing a superseded record.

  Each fails the PR that introduces the drift. M1, M4, M5 and the open-PR half of M6 stay sweep steps, because they need judgement or `gh`.
* **`check-adr --inventory`** prints the ADR sweep's step 2 inventory as JSON: number, title, status, superseded-by, amendment headings and dates, the date first on `main`, the model entry, and the paths, commands and versions each record cites.
* **A watermark in both reports** ([#563](https://github.com/mgasca/calendar/issues/563)). The last line of the report holds the `origin/main` SHA read, the UTC time, and the SHA at which each item was last judged. **Reports live in `docs/sweeps/adr/` and `docs/sweeps/issue/`**, one file per run named by its UTC time (`2026-11-08T1415Z.md`). Each run publishes its report in one docs-only PR that adds only that file. A "No change" run publishes too, because the watermark moves. The docs site does not publish the folder. A run without an appended report reads the newest file on `main`, or a newer one in an open report PR, before it falls back to a full run. Agreed on #568, 2026-11-08.
* **Delta only.** A run judges only the items selected below. Every other item keeps its class from the previous report and is marked "carried". The report names each item that was not judged and when it was last judged.
  * ADR sweep:
    * records changed since the watermark;
    * records whose cited tokens changed, found through a reverse index built from the inventory;
    * records with deferral or trigger phrases (J3), when a story, ADR or named issue moved;
    * records named by issues or PRs updated since the watermark (M5);
    * the *k* records judged longest ago.
  * Issue sweep:
    * issues updated since the watermark;
    * issues referenced by PRs merged or closed since the watermark;
    * the parents of either;
    * new issues;
    * a rotation of the issues judged longest ago.
* **An ADR judgement workflow** ([#564](https://github.com/mgasca/calendar/issues/564)), `.claude/workflows/adr-sweep-judge.js`, Claude Code only.
  * **Selection:** the session passes the previous watermark, the records the previous report left over, and the inventory. The workflow selects the delta itself, by the rules above, and returns it with each record's reason. One read-only agent on Sonnet does the parts that need `git` and `gh`. The left-over records and the rotation over the watermark come from plain code. Without a watermark it is a full run. The session can still pass records selected by hand. Changed in review of [#570](https://github.com/mgasca/calendar/pull/570), 2026-11-08.
  * **Judges:** the workflow runs one judge per delta record, on Sonnet, (J1 to J5, plus J7 on request) against `origin/main`. Each judge returns findings with the check id, class, evidence as file and line, and whether the finding was inferred.
  * **Skeptics:** each Fix now or Decide finding goes to two `sweep-skeptic` agents, one per lens. *True* asks whether the claim holds on `origin/main`. *Matters* asks whether a reader of the record would act differently. Watch findings are not verified. A finding is confirmed only if both skeptics decline. Uncertainty refutes and says so, as in 0035.
  * **Two caps, both logged:**
    * **Per record, 12 agents:** the judge plus that record's skeptics. Findings past this cap come back as unexamined, highest class first (Fix now, then Decide).
    * **Per run, 40 agents:** records are admitted in this order: the previous run's left-over records, then up to *k* rotation records, then the selected records in order of their reason. Selected records past this cap come back as left over, so the next run takes them first. So does a record whose judge returned nothing (#570, 2026-11-08). A rotation record past the cap is not left over: it keeps its judged date, so the next rotation picks it again. Each admitted record reserves its judge and one pair of skeptics, so at most 13 records are judged at the default. Changed by [#581](https://github.com/mgasca/calendar/issues/581): ordering by reason alone let a busy selection push left-over and rotation records past the cap on every busy run. A record's first finding goes to its skeptics as soon as its judge returns. Its further findings draw on the reserves that records left unused, granted in record order once every judge has returned ([#582](https://github.com/mgasca/calendar/issues/582)).
    * **The rotation:** *k* = 6 records per sweep, so every record is judged at least once every nine sweeps of the 49-record log, while each run's left-over list leaves the rotation its *k* slots: at most 13 − 6 = 7 records at the defaults. A longer list takes rotation slots first, and one longer than the 13 admitted records holds the rotation off until it drains. The run logs it.

    All three are workflow `args` with these defaults.
  * **The workflow returns data and never writes to GitHub.**
* **A `sweep-judge` agent definition**, `.claude/agents/sweep-judge.md`: read-only, on Sonnet, for the select agent and the judges, which read issue and PR text that anyone can write. Its ground rules mirror `sweep-skeptic`. Added after the review of [#570](https://github.com/mgasca/calendar/pull/570) found both ran without an agent type ([#580](https://github.com/mgasca/calendar/issues/580)).
* **A `sweep-skeptic` agent definition**, `.claude/agents/sweep-skeptic.md`: read-only, on Haiku, for one claim about `origin/main` or GitHub state through one lens. It is separate from `skeptic`, which starts from a branch diff and which the review before a merge depends on.
* **Option B in both skills.** In Claude Code, the per-item judgement runs the workflow, and the skill's instruction counts as the opt-in, as `issue-handover` does for the review. Any other harness follows the by-hand steps. The session keeps the work that needs every result or writes to GitHub:
  * fetch and inventory;
  * the remaining mechanical steps, and the delta on the by-hand path;
  * grouping findings that share a cause across records;
  * the comparison with the previous report, the report itself and the watermark;
  * hand-offs one PR or closeout at a time.
* **An issue verification workflow** ([#565](https://github.com/mgasca/calendar/issues/565)), `.claude/workflows/issue-sweep-verify.js`, Claude Code only. The session still classifies inline. The workflow runs two `sweep-skeptic` agents on each Safe to close or Nearly done issue. The lenses are *done on main* (every cited item, child and criterion holds) and *nothing left in the thread* (no later owner request, no open child, no unanswered question). An issue is handed to `issue-closeout` only when both skeptics decline. A refuted one is reported as Still open, with the reason.
* **Measured, not assumed.** A benchmark record gives the agent count, tokens and wall-clock time of the first three ADR workflow runs. It compares their coverage with the 2026-11-07 by-hand sweep's coverage line. No paired by-hand run is made, so the by-hand side has no token figure, and the record says so.

### Not in this story

* **Fanning out the issue classification** (one agent per issue). It pays off only once open issues pass about 30. That is a follow-up issue when the count is reached, not this story.
* **`dream-weaver`.** It already has a watermark. Whether it should use a workflow is its own question, and the ADR-0044 amendment does not cover it.
* **J8, external links, in the workflow.** It needs network access and stays a session step that runs when network is available.
* **The routine's installation.** The timer, prompt file and script live on the maintainer's machine, as the `dream-weaver` routine sketch says. This story changes the skills that the routine runs, not the routine.
* **Changes to `skeptic`, `review-before-merge.js` or the reviewer agents.**
* **Changing what any check looks for.** The catalogue's checks keep their meaning. Only where they run changes.

### Dependencies

* [#561](https://github.com/mgasca/calendar/issues/561), [#562](https://github.com/mgasca/calendar/issues/562) and [#563](https://github.com/mgasca/calendar/issues/563) touch different files and can be delivered in parallel after this card.
* [#564](https://github.com/mgasca/calendar/issues/564) stacks on #563, because both rewrite step 3 of `adr-sweep`. It needs #561 accepted, because the skill must not require a workflow before the ADR allows it on the schedule. It reads #562's `--inventory`.
* [#565](https://github.com/mgasca/calendar/issues/565) comes after #564 and reuses `sweep-skeptic`.

### Acceptance criteria

1. **Given** ADR-0044 on `main`, **when** I read it, **then** a dated amendment says that the `issue-sweep` and `adr-sweep` schedule runs in mj on Claude Code or another harness, that these skills may use workflows in Claude Code, and that they keep a by-hand path any harness can follow. A More Information bullet matches the amendment, and `just tools adr` passes.
2. **Given** a branch where the model's status for a record differs from the file, a `superseded by` target that does not name its predecessor, an amendment heading without a date, a number that `main` already has, or a `planned` card citing a superseded record, **when** CI runs `just tools adr`, **then** it fails and names the record and the rule. The decision log on `main` passes.
3. **Given** `main`, **when** I run `just tools adr --inventory`, **then** it prints one JSON entry per record, with number, title, status, superseded-by, amendments, first date on `main`, model entry and cited tokens.
4. **Given** a previous sweep report with a watermark, **when** either sweep runs again, **then** it judges only the items its delta selects. It marks every other item "carried", lists each item it did not judge with when it was last judged, and ends with a new watermark.
5. **Given** no previous report is supplied, **when** a sweep runs, **then** it reads the newest report in `docs/sweeps/<adr|issue>/` on `main` (or a newer one in an open report PR), and says whether it found one before it falls back to a full run.
6. **Given** a record whose cited path or command changed on `main` since the watermark, but whose own file did not change, **when** the ADR sweep runs, **then** that record is in the delta and its reason names the change.
7. **Given** a Claude Code session, **when** the ADR sweep reaches its judgement checks, **then** it runs `adr-sweep-judge`, and the report lists confirmed, refuted (with the skeptics' reasons) and unexamined findings, and says that the workflow path ran.
8. **Given** a harness without the Workflow tool, **when** either sweep runs, **then** it follows the by-hand steps, completes, and says in the report that the by-hand path ran and which items it did not judge.
9. **Given** more delta records than the run cap of 40 agents allows, or a record whose findings need more than 12 agents, **when** the workflow runs, **then** the records or findings past the cap are returned as unexamined. The run's log names how many were left at each cap, and the next run's rotation takes the left-over records first.
10. **Given** a judge or skeptic that returns nothing, **when** the workflow finishes, **then** the affected record or finding is listed as unexamined, not as passed or refuted.
11. **Given** the scheduled mj routine starts Claude Code, **when** the ADR sweep runs, **then** the workflow and `sweep-skeptic` are available and run. The run is recorded, or the gap is filed as an issue.
12. **Given** a Safe to close or Nearly done issue, **when** the issue sweep runs in Claude Code, **then** `issue-sweep-verify` runs two skeptics on it. It is handed to `issue-closeout` only when both decline, and a refuted issue is reported as Still open with the reason.
13. **Given** the first three ADR workflow runs, **when** the benchmark record is written, **then** it gives each run's agent count, tokens and wall-clock time, each marked measured. It also compares the records each run judged with the coverage line of the 2026-11-07 by-hand sweep.
14. **Given** a sweep run finishes, **when** it publishes, **then** one docs-only PR adds exactly one file, `docs/sweeps/<adr|issue>/<UTC stamp>.md`, whose last line is the watermark, and changes nothing else.
15. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0044](../decisions/0044-claude-first-agent-automation.md) | Claude-first period: automation may be Claude Code only, while guidance stays readable by every agent; scheduled work runs in mj | The workflows and agent are Claude Code only. The scheduled sweeps need an amendment (#561) before a skill they run may require a workflow path. |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | Repo tooling is .NET file-based apps; harness-dictated scripts are exempt | `check-adr` stays .NET with tests. The workflow scripts are JavaScript under the exemption that 0035 first used. |
| [0040](../decisions/0040-derive-the-decision-log-from-the-adr-files.md) | The decision log is derived from the ADR files | The new `check-adr` rules and `--inventory` read the same files the log is derived from, rather than keeping a second list. |
| [0039](../decisions/0039-architecture-model-and-visualization-tooling.md) | The FINOS CALM architecture model | M2 moves into `check-adr`, so CI keeps the model's copy of each status in step. Today only the sweep notices drift. |

An amendment to ADR-0044 is expected (#561). No new record is expected.

### Other decisions (not ADR-worthy)

* **Option B, not Claude Code only:** the schedule may start a non-Claude harness, so a skill that only runs a workflow would leave that run with nothing to follow. The by-hand path is today's sweep, which works, and its report names what it did not reach. This is the same split as the review step in `issue-handover`. Agreed 2026-11-08.
* **Delta only, with a rotation:** an ADR goes stale when the repository moves, not when the record is edited, and an issue gets finished by commits that never mention it. So the delta follows cited tokens, and the rotation bounds how long any item goes unjudged. Agreed 2026-11-08.
* **Mechanical checks in `check-adr`, not in agents:** they are deterministic, free, and run in CI on every PR, which turns "found at the next sweep" into "refused at the PR" for every harness. The skill already named them as candidates. Agreed 2026-11-08.
* **An epic with a child per deliverable:** each deliverable touches different files and can be reviewed and merged on its own, as in 0045. Agreed 2026-11-08.
* **The session posts, not the script:** every GitHub write stays behind the public-post guard and the session's judgement, as in 0035.
* **Sonnet judges, Haiku skeptics:** the judges run on Sonnet (pinned in the `sweep-judge` front matter since [#580](https://github.com/mgasca/calendar/issues/580); before, the workflow's per-agent `model`), which keeps the per-record J checks cheap. `sweep-skeptic` is pinned to Haiku in its front matter, like `skeptic`. This differs from the reviewers, which run on Opus. The benchmark record shows whether Sonnet misses findings that matter. Answered on #566, 2026-11-08.
* **Caps of 12 per record and 40 per run, rotation 6:** the per-record cap stops one record with many findings from using up the run's budget. The run cap bounds a day with a large refactor. Answered on #566 and in conversation, 2026-11-08.
* **No paired by-hand baseline:** the comparison uses the 2026-11-07 report, so the first runs cost no more than the workflow itself. The price is that the by-hand path has no token figure. Answered on #566, 2026-11-08.
* **Two lenses, not three:** *reproduces* has nothing to run for a claim about a document or an issue thread.
* **A new skeptic agent, not a second mode of `skeptic`:** the review before a merge depends on `skeptic` as it is. The 0035 lesson about agent definitions applies: the first run after adding `sweep-skeptic` starts from a fresh session on a checkout that already has the file.
* **Cross-record grouping stays in the session:** it needs every result at once but is a cheap read of a short list, so a barrier agent would add latency for little.
* **The issue classification stays inline for now:** at 12 open issues, one context is the right size, and it keeps a tracker and its children in one reading.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| ADR-0044 amendment | `docs/decisions/0044-claude-first-agent-automation.md` |
| Mechanical checks and `--inventory` | `.claude/skills/adr-draft/scripts/check-adr/` (`AdrValidator.cs`, `check-adr.cs`) and its tests |
| Sweep skills | `.claude/skills/adr-sweep/SKILL.md`, `.claude/skills/issue-sweep/SKILL.md` |
| Workflows | `.claude/workflows/adr-sweep-judge.js`, `.claude/workflows/issue-sweep-verify.js` |
| Select and judge agent | `.claude/agents/sweep-judge.md` |
| Skeptic agent | `.claude/agents/sweep-skeptic.md` |
| Measurements | a new record in `docs/benchmarks/` |
| Sweep reports | `docs/sweeps/adr/`, `docs/sweeps/issue/` and their `docs/sweeps/README.md` (not published) |

### API

No changes.

### Testing

* `check-adr`: one xUnit test per new rule that fails without it, run by `just tools test`, plus the current log passing.
* The workflows are scripts, which no test harness covers. Like 0035, they are checked by recorded runs: three real ADR sweeps, one seeded past the cap, one with a failing agent, and one inside the scheduled routine on Claude Code.
* The skills, card and record are covered by the docs corpus tests and the site build.

### Lessons learned, known issues and follow-ups

* To be written on delivery.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Reading a sweep report

* The report's last line is the **watermark**. Pass the whole report to the next run, or let the routine append it, and the next sweep judges only what changed since then.
* Items the run did not judge are marked **carried**, with the date each was last judged. Every item is judged at least once every few runs.
* In Claude Code, each finding is checked by two skeptics before it reaches the report. **Confirmed** findings come first. **Refuted** findings follow with the skeptics' reasons, so you can catch a wrong refutation. **Unexamined** findings are named, with the reason.
* The report says whether the **workflow** or the **by-hand** path ran. A by-hand run is today's sweep, and it lists what it did not reach.

### Asking for a sweep

* Ask any agent "are the ADRs current?" or "which issues are done?". The sweep picks the path its harness supports.
