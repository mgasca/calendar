---
status: implemented
date: 2026-11-12
issue: https://github.com/mgasca/calendar/issues/694
pr: []
adrs: []
---

# 0061 Commit the graphify knowledge graph

## Story

> As the maintainer, I need the knowledge graph that the graphify skill builds to live in the repository, so that any checkout or agent session can query it without rebuilding it, and so that a graphify run never leaves a folder of untracked files that a careless `git add` could commit by accident.

Tracked in issue #694.

## Background

The `graphify` skill (`/graphify .`) turns a folder into a knowledge graph and writes it to `graphify-out/` at the repository root. Its queries (`graphify query`, `path` and `explain`) read `graphify-out/graph.json`. Building the graph from nothing is slow and, for the Markdown documents, costs model tokens: the first build of this repository, 688 files, read 247 documents through 13 subagents and used at least 1.57 million tokens (article [0008](../agent-thoughts/0008-a-knowledge-graph-and-a-drifting-architecture-model.md) tells that story).

Before this story nothing in the repository said what to do with the output. It was not tracked and not ignored, so it showed in `git status` as `?? graphify-out/`, and a `git add -A` would have staged all 36 MB of it.

The folder holds more than the graph. On that first build it contained:

| Part | Size | What it is |
| --- | --- | --- |
| `graph.json` | 11 MB | The graph. Rewritten whole on every build |
| `graph.html`, `GRAPH_REPORT.md` | 0.5 MB, 0.1 MB | The interactive view and the written report |
| `manifest.json` | 0.2 MB | File hashes, so `--update` re-reads only what changed |
| `.graphify_labels.json` and its `.sig` | 33 KB | The community names and a signature over the clustering |
| `cache/` | 14 MB, 555 files | The extraction cache |
| `2026-11-11/` | 11 MB | A dated copy of the previous build, made by `graphify update` |
| `.graphify_python`, `.graphify_root`, `.graphify_build_state.json`, `.graphify_labels.pending.json`, `cost.json` | a few KB | State of one run. `.graphify_python` holds the absolute path of the interpreter on the machine that ran it |

The maintainer decided that the folder is not to be ignored. When asked how much of it to commit, they chose the graph and the report only, and this card records that choice.

### Agreed scope

* **Commit the graph and its readers:** `graph.json`, `graph.html`, `GRAPH_REPORT.md`, `manifest.json`, `.graphify_labels.json` and `.graphify_labels.json.sig`, about 12 MB on disk and about 0.8 MB compressed. The labels and their signature go together, because the signature covers the clustering that the labels name.
* **Keep local state out of git** with a `.gitignore` inside `graphify-out/`, so the rule travels with the folder and the root `.gitignore` is unchanged: the cache, the dated copies of earlier builds, and the five files of run state listed above. `.graphify_python` names a path on one machine, and a public repository is no place for that, as AGENTS.md says of public posts.
* **Treat `graph.json` and `graph.html` as generated files** in `.gitattributes`, as the lock files and `*.gen.ts` already are: GitHub collapses them in a review, and `git diff` does not print them.
* **Commit a graph rebuilt on this revision**, so the committed files describe a known tree.

### Not in this story

* **Keeping the graph fresh.** Nothing rebuilds it. It describes the revision it was built from, and it goes stale as the code changes. Refreshing code only is `graphify update .`, which parses source files with no model tokens. New or changed documents need `/graphify --update`, which does. A hook, a scheduled workflow or an `AGENTS.md` rule that does this is a separate story, if it is wanted.
* **Telling agents to use the graph.** The repository's guidance says nothing about graphify, and this story does not add any.
* **Committing the cache.** It is 14 MB and the next run recreates it. Whether an `--update` on a fresh checkout without it re-reads documents that have not changed was not tested.

### Acceptance criteria

1. **Given** a fresh checkout of `main`, **when** `graphify query "<question>"` runs in it, **then** it answers from the committed `graphify-out/graph.json` without a build. See "Testing" for how this was checked.
2. **Given** a new `/graphify` or `graphify update .` run, **when** `git status` runs, **then** it lists the six committed files as modified if they changed, and does not list `cache/`, a dated folder, `.graphify_python`, `.graphify_root`, `.graphify_build_state.json`, `.graphify_labels.pending.json` or `cost.json`.
3. **Given** the committed files, **when** they are searched for an absolute path to a home directory, **then** none is found.
4. **Given** a pull request that regenerates `graph.json`, **when** it is reviewed on GitHub, **then** `graph.json` and `graph.html` are collapsed as generated files.
5. **Given** the change, **when** `just docs test` and `just docs build` run, **then** they pass.

## Design decisions

### Any Decision Records

No ADR constrains this story, and none is needed: it adds files and ignore rules, and it is easy to reverse. If the graph becomes part of how the repository is worked on, with a rule that agents consult it or a job that rebuilds it, that is a decision for an ADR.

### Other decisions (not ADR-worthy)

* **Commit `graph.json`, although it is rewritten whole on every build.** An 11 MB file looks expensive, but it compresses to about 0.7 MB (gzip, measured), which is roughly what git stores, since git compresses with zlib too, and the `-diff` attribute keeps it out of reviews. The cost of a regeneration is small in the history and invisible in a diff.
* **Do not commit the cache or the dated copies.** Together they are 25 MB, they hold nothing the graph does not, and the next run recreates them.
* **A nested `.gitignore`, not the root one.** The rule is about the output of one tool and belongs beside it.
* **No ignore rule for the whole folder.** Ignoring all of `graphify-out/` was the first proposal on the issue. The maintainer rejected it. The issue's title was changed, and the change of direction is recorded in a comment on it.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| The committed graph | `graphify-out/` (`graph.json`, `graph.html`, `GRAPH_REPORT.md`, `manifest.json`, `.graphify_labels.json`, `.graphify_labels.json.sig`) |
| Local-only files | `graphify-out/.gitignore` |
| Generated-file attributes | `.gitattributes` |

### API

No changes.

### Testing

* The committed files were searched for `/home/grover` and for the maintainer's email address: no match in any of the six.
* `git add -A -n` lists exactly the six graph files, `graphify-out/.gitignore`, `.gitattributes` and this card. `git check-ignore -v` reports `.graphify_python`, a file under `cache/` and a file under the dated folder as ignored by `graphify-out/.gitignore`, and `graph.json` as not ignored.
* Criterion 1 was checked against an export of the committed tree, with no build: see the pull request for the command and its output.
* `just docs test` and `just docs build` pass.
* There is no committed test of the ignore rules. They are a short, static list, and a fixture for another tool's output folder would be more code than the rules.

### Lessons learned, known issues and follow-ups

* **What the graph describes.** The code part was built from revision `5fc1947fd`. The document part was extracted by the model on 2026-11-11, from the tree of that day, and is not refreshed by `graphify update .`. Documents added since, such as stories 0058 to 0061 and article 0008, are missing from it until someone runs `/graphify --update`.
* **Community names.** `graphify update .` re-clusters the graph. Of the 140 community names written by hand after the first build, 100 survived into the committed graph, where their clusters stayed the same. The other 389 communities carry names that were chosen automatically, from their best-connected node. The labels file and its signature are committed as graphify wrote them.
* **The report's title** carries the name of the directory it was built in. That is the name of a working directory here, not a path.
* **The graph can mislead.** Article 0008 records a false import cycle (the `Error` derive macro matched by name to a different `Error` type) and links that look central only because their neighbourhood is thin. Treat an answer from the graph as a lead to check in the source.

## User guide

### The task the user performs

Query the graph straight from a checkout: `graphify query "<question>"`, `graphify path "<A>" "<B>"` or `graphify explain "<concept>"`. Open `graphify-out/graph.html` in a browser for the interactive view, or read `graphify-out/GRAPH_REPORT.md`.

To refresh it, run `graphify update .` for code changes, or `/graphify --update` in Claude Code when documents changed too, then commit the changed graph files. Files you do not commit, such as the cache, stay out of `git status`.
