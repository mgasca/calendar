---
date: "2026-11-11"
author: "Claude Code (Claude Opus 5.5)"
revision: "56b17db9b"
---

# 0008 A knowledge graph, an architecture model, and what each one noticed

*Written on 11 November 2026 by Claude Code, running the Claude Opus 5.5 model. The maintainer asked me to build a graphify knowledge graph of the repository, then to use it to check the architecture model in `docs/architecture/calendar.architecture.json` for drift and gaps, and finally to write up how that went, honestly, for developers who know neither tool. I built the graph from revision `fb9deefa0`. By the time I fixed the model, `main` had moved to `56b17db9b`, so I re-ran every check there; the findings below are as of that revision. The fixes are in issue [#689](https://github.com/mgasca/calendar/issues/689) and pull requests [#690](https://github.com/mgasca/calendar/pull/690) and [#691](https://github.com/mgasca/calendar/pull/691), which were open and unmerged when I wrote this. The numbers come from the tools' own output in that session. My judgements about where the value lay are my reading and are not agreed scope.*

Every project with an architecture diagram has the same quiet problem. The diagram is right on the day it is drawn, and then the code keeps moving. Nobody decides to let it go stale. It happens one reasonable pull request at a time, until someone new reads the diagram, believes it, and goes looking for a class that was deleted a month ago.

This repository takes that problem more seriously than most. It keeps its architecture as a machine-checked model rather than a picture. This week the backend was rewritten from .NET to Rust, which is about the hardest test a model can face. So it was a good moment to ask whether the model still told the truth, and whether a knowledge-graph tool could help us find out.

The short answer is that the model was mostly right, but its prose had drifted more than any of us expected. The graph helped less than I hoped, and it helped in one specific way that I want to describe accurately rather than generously.

## Two tools, briefly

### CALM: the architecture written as data

CALM is the [Common Architecture Language Model](https://calm.finos.org/) from FINOS, the open-source foundation of the financial-services industry. Instead of drawing boxes in a diagramming tool, you describe the system in a JSON file that follows a published schema. [ADR-0039](../decisions/0039-architecture-model-and-visualization-tooling.md) chose it for this project, and the documentation site renders the file as its **Architecture** section.

Our model has five kinds of content:

* **Nodes** are the parts of the system: the web app, the API, the database, the migrator, the CI system, each Azure resource, the documentation site, and the people who use them. There are 24 of them.
* **Interfaces** sit on nodes and say how you reach them: a port, a URL, a list of API operations, a set of commands.
* **Relationships** connect nodes (`connects`), group them (`composed-of`) and place them where they run (`deployed-in`). There are 32.
* **Controls** record the non-functional promises: how authentication works, how data is scoped to its owner, how the day is defined, what the logs look like, which quality gates every change passes.
* **Flows** walk through business processes, such as signing in or adding an event, as numbered steps over the relationships.

A command-line tool validates the file against the CALM schema, and the docs-site tests check that every decision record it mentions exists, with the right title and status. That catches broken structure. It cannot catch a sentence that says "Kestrel listens on port 8080" after Kestrel has left the building. Nothing checks prose against code.

### graphify: the repository as a graph

graphify (installed here from the `graphifyy` Python package and driven by a Claude Code skill) turns a folder into a knowledge graph. It has two ways of reading files:

* **Code goes through a parser.** For source files it uses tree-sitter grammars to pull out classes, functions, imports and calls. This costs no model tokens, and on our repository it produced 8,313 nodes and 19,646 edges.
* **Documents go to a language model.** For Markdown, images and the like, it splits the files into chunks and hands each chunk to a model, which reads it and writes down the named concepts and how they relate. Here that meant 247 files, mostly decision records, story cards and runbooks, split across 13 parallel agents.

It then merges the two halves and runs community detection, a clustering step that groups nodes that link to each other more than to the rest. It writes out the graph as JSON, an HTML view and a report listing the most connected nodes, the bridges between clusters and some suggested questions. Afterwards you can ask it things: `graphify query` for a broad question, `graphify path A B` for the shortest route between two concepts, and `graphify explain X` for everything attached to one node.

The appeal is obvious. A decision record says "the API uses Diesel", and the graph can connect that sentence to the Rust files that actually use Diesel. If the model of the architecture and the model of the code live in the same graph, the places where they disagree ought to stand out.

## Building the graph

The build was more eventful than the description suggests, and the details matter for judging the result.

* **The corpus.** graphify found 688 files and about 627,000 words, which is past the size where it warns you. It skipped one file, `frontend/packages/theme/src/tokens.css`, as possibly sensitive. It holds the theme's colour tokens, so that was a false alarm, but a harmless one.
* **Code gaps.** The 16 SQL migrations added nothing, because the SQL grammar was not installed. Another 41 code files produced no symbols at all.
* **An interruption.** Most of the document agents hit the account's weekly usage limit partway through. Five chunks finished before the limit and eight were resumed after it reset that evening. Every file was eventually read to its last line, which graphify checks by comparing each agent's reported line counts with the real ones.
* **Inconsistent names.** Each agent named document nodes its own way. One wrote `docs_decisions_0014_postgresql_database_engine_adr`, another left off the `_adr`, and a third put a leading underscore on everything under `.github/`. Links between documents in different chunks therefore pointed at nodes that did not exist: 278 broken endpoints in all. I wrote a small normalisation step that gave each document one canonical ID, which brought that down to 2.
* **The result.** The finished graph had 9,635 nodes, 20,867 edges and 480 communities. The token cost is at least 1.57 million. That is a lower bound, because only 9 of the 13 agents reported their usage.

A graph that large does not draw well, so the HTML view collapsed each community into a single dot. I named the 140 largest communities by hand, with labels like "Agenda, Time Zones, Theme ADRs" and "Owner-Scoped Events and Tasks", and let the rest take the name of their best-connected node.

## Warming up: two questions, two different kinds of answer

Before touching the architecture model, I asked the graph two questions from its own list of suggestions. They turned out to be a fair preview of everything that followed.

The first was why a node called "browse.cs Playwright screenshot driver" was such a strong bridge between the agent-guidance decisions and the stack decisions. The graph's answer was real. Article [0006](0006-the-stack-we-change-and-photograph-it-with.md) explains that the screenshot driver is written in C# rather than Node because of the repository's tooling-language rule, and the graph had faithfully linked the article, the rule and the driver's source file. It had also missed the article's second point, that a frontend testing decision deferred browser tests, so the driver produces evidence for reviewers rather than tests. And the bridge looked important mostly because very few edges connect the documents to the skill code at all. A thin graph makes any single link look central.

The second was an import cycle that the report flagged between `calendar-domain/src/error.rs` and `calendar-infrastructure/src/error.rs`. If it were real, the domain crate would depend on infrastructure, which would break the project's layering. It was not real. The domain file says `use thiserror::Error;`, the `Error` derive macro from the `thiserror` crate. The parser matched the name `Error` to the infrastructure crate's own `Error` enum and recorded an import that does not exist. The domain crate's `Cargo.toml` has no dependency on any other calendar crate, and Cargo would refuse to build a cycle between crates anyway.

So within the first half hour I had one real but thin insight and one confident, plausible and wrong edge. I kept that in mind for the main job.

## Checking the model against the repository

My first step was to ask the graph about the model itself. The answer was disappointing in an instructive way. graphify had treated the JSON file as code, and for JSON the parser records the keys: `metadata`, `nodes`, `relationships`, `flows`, `controls`. It does not record the CALM content inside them. The node for the web app, the interface listing the API operations and the control describing the session cookie were all invisible to the graph. As far as the graph knew, the architecture model was a file with nine top-level keys.

That meant the model's side of the comparison had to come from reading the file directly. I wrote short scripts that parsed it and listed what it claimed. The repository's side came from wherever each fact was most reliable:

| What the model claims | Checked against | Result |
| --- | --- | --- |
| 58 decision records with titles and statuses | The front matter of every file in `docs/decisions/` | All 58 match |
| 17 operations in the OpenAPI contract | `contracts/openapi.json` | All 17 match |
| The API's routes | The router in `calendar-api/src/app.rs` | All 14 present; one Development-only route missing from the model |
| 7 web routes | The router of the web app | Exact match |
| The CI workflows | `.github/workflows/` | `ci-trend.yml` missing |
| Every Azure resource | The `resource` lines in `infra/` | All covered |
| 148 repository paths in the model's text | The file system | All exist |

None of those rows came from the graph. Each was a few lines of script or a `grep`, and each was more reliable than a graph query would have been, because it read the source of truth rather than a model's summary of it.

## Where the graph did earn its place

There was one question the graph answered well, and it was a question I would not have thought to ask without it. The graph knows, for every node, which file it came from. So I could ask: which parts of the code base produce graph nodes in files that no element of the architecture model mentions at all?

The answer, weighted by node count, was a short and readable list. Most of it was developer tooling: the agent hooks (564 nodes), the handover watcher (386), the version checker (237), the development seeder (235) and the environment doctor (198). The model leaves those out, as it always has, because they are not parts of the running system. But two entries stood out:

* **`frontend/packages` (61 nodes)** turned out to be `@calendar/theme`, a shared package of colour tokens, fonts and theme storage. Both the web app and the documentation site depend on it, and two decision records ([ADR-0047](../decisions/0047-semantic-css-tokens-selected-by-a-data-theme-attribute.md) and ADR-0048) describe it. It had no node in the model. #691 adds one.
* **`backend/crates` (61 nodes)** turned out to be `calendar-testing`, the test-database helper crate. It is mentioned in passing in a description but has no node, which is reasonable for test infrastructure.

I want to be precise about how much credit the graph deserves for this. The list of files could have come from `git ls-files`, and a careful person comparing it with the model by hand would have found the theme package too. What the graph added was the weighting. Seeing "61 nodes of shared frontend code that the model never mentions" next to "564 nodes of agent tooling" made the one gap that mattered stand out from the ones that did not. That is a modest contribution, but a genuine one, and it is the only gap in the final pull request that I can honestly attribute to graphify.

## The drift was in the sentences

The larger finding came from somewhere else entirely, and it is the one I would most like readers to take away.

On my first pass I looked for .NET vocabulary I knew to be suspicious (Kestrel, ForwardLimit, Entity Framework) and found seven stale fields. While I was fixing them, I checked how the agenda's overdue list is actually queried. The model said "combined with EF Concat (UNION ALL)", and in my first report I had written that the Rust code uses a single `OR` predicate instead. That was wrong. The `OR` predicate I had found belongs to the task list's overdue view, a different query. The agenda still uses `UNION ALL`, now through Diesel's `union_all`, so only the names in that field were stale. I had trusted a search result without reading the function it pointed to.

That mistake made me distrust my own list, so I tried something blunter. I extracted every PascalCase identifier from the model, words like `CalendarDbContext` or `UseHsts`, and checked whether each one still appeared anywhere in the backend, frontend, tool, Bicep or workflow sources. It took a dozen lines of Python and a few seconds. It found about twenty more, among them:

* the ASP.NET authorization fallback policy, where the Rust API now uses a `CurrentUser` extractor;
* the EF Core global query filter, where every repository function now takes an explicit owner id;
* `UseHsts` and `UseHttpsRedirection`, now a few functions in `hosting.rs`;
* `KnownProxies`, `AsNoTracking`, `LoggerMessage` and `Microsoft.AspNetCore.OpenApi`;
* C# class names like `AgendaBuilder` and `TaskListQueries` in the steps of the flows.

Checking one of those also turned up a claim that was simply false: the observability control said the API sends telemetry to Application Insights. The Application Insights resource exists in the Bicep, but the container app is given no connection string and the Rust API has no telemetry SDK. Whether that should change is a decision for the maintainer, so the model now says what is true, and the question is noted on the issue.

In the end #691 rewrites about 27 fields. Almost all the descriptions had been kept faithfully up to date in meaning: the Rust port preserved the behaviour, and the person doing it updated the model's decision links. Only the vocabulary was left behind, and vocabulary is exactly what a schema validator cannot see.

The graph played no part in this. In principle it could have, since it holds the label of every function and type in the code. But the model's prose was not in the graph, so there was nothing to compare against. A plain-text scan did the job.

## What I would tell a colleague

Here is my honest accounting.

**What graphify brought:**

* One real gap, the theme package, found by asking which areas of the code the model never mentions. The graph's node counts made it easy to separate the gap that mattered from the tooling the model leaves out on purpose.
* Quick orientation. `graphify explain` on the CALM decision record listed its 32 connections in one command, including the stories that built the architecture pages and the decisions that cite it.
* A useful warm-up result, the browse.cs bridge, even if it was thinner than it first looked.

**What it cost, or got wrong:**

* At least 1.57 million tokens and an afternoon, including a usage-limit interruption and a clean-up pass on node IDs before the graph was coherent.
* One false import cycle, presented with the same confidence as the true edges.
* No visibility into the content of the JSON model, which was the very thing under review.

**What actually found the drift:** reading the model directly, short comparison scripts against the real sources of truth, a name scan against the code, and reading the functions those pointed to. A mistake in my own first report was caught the same way.

If you only want to check this model again, do not build a knowledge graph for it. A name scan and a handful of inventory comparisons take minutes and found nearly everything. I think those checks are worth turning into a small repeatable test one day, and story 0060 notes that as a possible follow-up.

The case for a graph is different. It pays off when you expect to ask many questions of the same corpus, when the questions cross between documents and code, or when you need to see the shape of the whole repository: which areas cluster together, what bridges them, and what is left out. "What does the architecture model not cover?" was that kind of question, and the graph answered it better than I would have unaided. "Is this sentence still true?" was not, and no amount of graph structure substitutes for opening the file and checking.

The model, for its part, came out of the exercise in good shape. Its structure had survived a complete rewrite of the backend without losing a node, which says something for writing architecture down as data. What it needed was someone to read its sentences against the code. That part is still a person's job, or an agent's, and it went faster with simple tools than with clever ones.
