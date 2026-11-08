---
date: "2026-11-08"
author: "Claude Code (Claude Haiku 5.5)"
revision: "7e6c02270"
---

# 0006 The stack we change and photograph it with

*Written on 8 November 2026 by Claude Code, running the Claude Haiku 5.5 model, from revision `7e6c02270`. The maintainer asked for an article about the tools used to make changes here and to take screenshots of the UI for issues and pull requests, written for a developer who may not know the stack and who wants to know what the alternatives were. I read the decision records for each choice named below, the two skills that drive the app and publish its images, and the test and build configuration in `frontend/` and `backend/`. I did not run the app or the screenshot driver for this article, so the commands are described from the files rather than watched. The trade-offs are my reading of the records, and they are not agreed scope.*

Suppose you have just joined the project. You clone it, you want to change one button on the day view, and afterwards you want to show the reviewer what the button looks like before and after. Nothing in the repository tells you that you need a .NET SDK, a Node version pinned by a file, a tool called `just`, a headless browser, and a branch named `screenshots` that nobody will ever merge. Each of those is there for a reason, and most of them replaced something else that was perfectly reasonable.

This article walks through the stack in the order you meet it: the way you start work, the code, the tests, and finally the pictures. For each choice I try to say what the alternatives were and what we gave up. The decision records in `docs/decisions/` hold the full scoring; I link to them rather than repeat the tables.

## Starting from one command

Everything begins with `just`. It is a small task runner, a bit like `make` without the tab-and-dollar quirks. Running `just` alone lists the recipes; `just check` runs everything CI runs, and `just frontend dev` starts the web app.

The project used to use GNU Make for this job. [ADR-0011](../decisions/0011-make-as-top-level-task-runner.md) chose Make because it was already installed everywhere we work, and the choice was reasonable at the time. By the end of October the Makefile had grown to 35 targets, and several of them had shell logic full of `$$` escapes and backslash continuations. [ADR-0038](../decisions/0038-just-as-the-top-level-task-runner.md) replaced it with `just`. The maintainer dropped the "no extra install" requirement that Make had satisfied, so the cost is explicit: one more tool to install, in exchange for better argument handling, a readable recipe list and recipes that do not fight the shell. We pin the `just` version in a file, the same way the Node version is pinned, so CI and your laptop agree.

The other options were `Task`, a Go-based runner with a similar feel; plain npm scripts, which would have put .NET orchestration inside a JavaScript file; and shell scripts, which are powerful and hard for an agent or a newcomer to discover. The decision scored `just` and `Task` close together, and `just` won on the expressiveness of its recipes. The honest cost is that every contributor now installs one more small tool, and `just doctor` tells you when it is missing.

Underneath `just`, the recipes are thin. They call `dotnet` and `pnpm` directly. If you prefer, you can still run `dotnet test` yourself. That is deliberate: the task runner is a list of shortcuts, not a second build system.

## The backend: .NET 10 and a minimal API

The API is ASP.NET Core on .NET 10, written as a minimal API rather than with controllers ([ADR-0002](../decisions/0002-dotnet-10-minimal-api-backend.md)). Endpoints are small functions that map a route to a handler. The alternatives were the classic controller style, a different language entirely, or a framework such as Node with Express. The strongest argument for .NET is that the domain rules, the time-zone logic and the tests all benefit from strong types and a mature runtime. The other argument is less glamorous: a stack that the people maintaining it can debug in the middle of the night is part of the design.

Data lives in PostgreSQL, managed with Entity Framework Core ([ADR-0014](../decisions/0014-postgresql-database-engine.md) and [ADR-0015](../decisions/0015-ef-core-data-access.md)). The choice of a real database over SQLite was argued once and then closed. [ADR-0037](../decisions/0037-postgresql-only-no-sqlite-fallback.md) says so explicitly, so nobody quietly adds a SQLite path for tests. Migrations are applied only by a separate `calendar_migrator` role, and the running app connects as a less-privileged `calendar_app` role. That split costs a little setup, and it is the reason a migration can never be run by accident from a web request.

The API's contract is the part I would ask you to understand first. Rather than hand-writing request and response types on both sides, the backend writes an OpenAPI document, `contracts/openapi.json`, every time it builds ([ADR-0004](../decisions/0004-openapi-contract-and-generated-client.md)). The frontend generates a typed client from that file. If you change a field on the server, the client stops compiling until you fix the caller. The main alternative was a contract-first OpenAPI file that the server had to implement, which gives you a nicer review story but more work on the server. Another was gRPC or GraphQL, which we rejected because the browser and the future mobile clients would need more machinery to use them. The cost is that a stale contract fails CI, so after you change an endpoint you run `just contracts` and commit the result. It is a small chore that prevents a large class of drift.

Tests use xUnit v3 with Shouldly for assertions and NSubstitute for fakes ([ADR-0007](../decisions/0007-backend-testing-stack.md)). The database-backed tests run PostgreSQL in a container through Testcontainers, so you need Docker to run the full API tests. That is a real requirement, and the sandboxed agents in this repo sometimes lack it; the story and skill docs say so instead of pretending those tests ran.

## The frontend: React, Vite and a router we picked on purpose

The web app is React 19 with TypeScript, built by Vite ([ADR-0003](../decisions/0003-react-vite-typescript-web-ui.md)). The main alternatives were Angular, Blazor WebAssembly, Next.js and Vue or Svelte. We picked React for two boring reasons: most of the examples a coding agent has seen are React, and the calendar ecosystem is largest there. Next.js would have given us server rendering we do not need; the app is a single-page tool behind a sign-in, and the single container that serves it is simpler without a Node server in front. Blazor would have kept the whole stack in C#, which is a tempting argument on its own. We judged that the calendar components, and the willingness of the next developer to read examples, mattered more.

Routing uses TanStack Router, and the data layer uses TanStack Query ([ADR-0026](../decisions/0026-client-side-routing-with-tanstack-router.md)). React Router was the obvious alternative and is widely known. The reason we chose TanStack Router is that routes, parameters and links are fully typed without a code generation step, and the project already used TanStack Query from the same family. The cost is that fewer people have seen it, so the agents and newcomers read a little more documentation than they would for React Router.

The language is TypeScript 6.0, and the linter is ESLint 9, both pinned to a range rather than the newest release ([ADR-0010](../decisions/0010-toolchain-version-pins.md)). The pins look conservative, and they are. The record compared them with TypeScript 7 and ESLint 10, which would have meant dropping the type-aware lint rules and the accessibility plugin, so the project stays on the older pair until those rules are available again. I think that trade is right for now, and the record is the place to revisit it.

Styling is plain CSS with a set of semantic custom properties, switched by a `data-theme` attribute on the root element ([ADR-0047](../decisions/0047-semantic-css-tokens-selected-by-a-data-theme-attribute.md)). A utility-class framework such as Tailwind was the obvious alternative. It would have been quick at the start and a large, lasting change for two themes. The fonts are self-hosted through packages rather than fetched from a font service ([ADR-0048](../decisions/0048-self-host-theme-fonts-with-fontsource-packages.md)), so the page does not depend on a third party to render.

## Tests that run in a fake browser and a fake server

Frontend tests use Vitest, React Testing Library, and Mock Service Worker, called MSW ([ADR-0008](../decisions/0008-frontend-testing-stack.md)).

Vitest shares Vite's configuration, so a test sees the same aliases and transforms as the app. Jest was the familiar alternative, but it would have needed its own transform setup for TypeScript and modern modules. Testing Library asks what a user would see, such as a button with a given name, rather than poking at component internals. That makes refactors less painful. MSW answers HTTP requests inside the test, using handlers typed against the same contract the client uses, so the real client and the real query code run. The alternative was mocking the client module, which is quicker to write and tells you less when the contract changes.

Here is the honest limit that the record spells out. Tests run in jsdom, which is a simulation of a browser that does not lay anything out. A calendar grid whose events overlap, or a drag that depends on pixel positions, cannot be checked by those tests. The decision defers full browser end-to-end tests until there are real user flows, and it names the gap. That gap turns out to matter for the next part.

## Pictures: why the screenshots need their own stack

A reviewer reading a pull request about the day view wants to see it. The jsdom tests can tell them that a checkbox is checked. They cannot tell them whether the new buttons overlap the date picker on a phone. So we take screenshots.

The screenshot tooling is a small program that drives the running app in headless Chromium. It lives in `.claude/skills/run-calendar/scripts/browse/browse.cs`. You can read it as a file-based .NET app, one `.cs` file that `dotnet run` executes directly, with a NuGet reference to Microsoft's Playwright package at the top. It reads one command per line from its input, such as `nav /`, `click`, `fill`, `screenshot`, and it stops at the first command that fails. It signs in through a development seed key rather than Google, so the screenshot run does not need a real account.

The reason it is .NET rather than a Node script is a rule from [ADR-0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md). That record says repo tooling is written in the repo's own two languages, C# and TypeScript, with no Python, Node or shell scripts for tools. Tools get the same analysers and tests as the product code, and one language covers the whole repo. The alternatives it weighed were a Python script with `unittest`, a TypeScript program run by Node, and Bash. Each would have been a reasonable tool on its own. The cost shows up in the details: the driver needs a .NET SDK newer than the one Ubuntu's package installs, so the skill spells out how to get it, and an agent that has seen far more Node Playwright snippets has to be careful with the .NET API.

The alternatives for the browser driver are the usual list. Node's Playwright is the most common and would have worked well. Puppeteer is Chromium-only. Selenium is older and heavier. Cypress is built around its own runner. The choice came down to the repo's language rule rather than a verdict that one library is much better than another.

There is a second alternative that deserves a sentence: the desktop "computer use" approach, where an agent looks at a screen and clicks. That works for a person's own machine and is good at exploring. It is slow, depends on what is on the display, and cannot be replayed the same way. A script with named selectors produces the same picture each time, which matters when you want a before and an after that differ only by your change.

The driver is for agents and people reproducing a view. It is not the test suite. [ADR-0008](../decisions/0008-frontend-testing-stack.md) deferred Playwright end-to-end tests until there are real user flows, and the screenshots are evidence for a reviewer, not an automated check that will fail a build.

## Putting the picture on GitHub

Here is the part that surprises people. GitHub has a drag-and-drop box for images in issues and comments. The `gh` command-line tool that our agents use cannot attach an image to an issue, and the drag-and-drop box is not scriptable in a way we would want to depend on. So the `github-screenshots` skill does something less obvious.

Images go on a branch called `screenshots`, which is an orphan branch with no shared history with `main`. Each issue or pull request number gets a directory, such as `259/add-event-before.png`. The skill adds files with git's low-level commands, so you never check that branch out. It writes a new commit on top of the previous one, pushes it, and prints the commit's hash. Posts then link each image by that commit, as a raw GitHub URL, which stays put even as the branch grows.

The rules around it matter as much as the mechanism. The branch is never merged, rebased, force-pushed or deleted. A file is never replaced; a retaken screenshot gets a new name. That way an earlier comment still shows what the reviewer saw at the time. A UI pull request describes its change with a table, before on one side and after on the other, and says which revision each was taken at.

Why not the alternatives? Committing images to `main` would put binary files into the product history, and every reviewer would download them forever. Git LFS would solve the size problem for a larger project, but it adds a service and a setup step that every clone needs. An external image host is easy until you wonder who owns the data and whether the link will still work in a year. GitHub's web uploader works, but it is a manual, browser-only step, which is exactly what an agent cannot do. The orphan branch is an odd solution. It keeps images out of `main`, it uses only plumbing that every git installation has, and its links do not change. The cost is that the branch will grow for as long as the project runs, and its history is a pile of pictures, which is an acceptable price for a repository whose screenshots are small.

## The thread that connects them

If you look at the stack as one thing, it follows a single idea. The repository is the source of truth, and everything that agents and people need is either in it or generated from it: the contract, the client, the task list, the decision records, the screenshots' links. The tools were chosen to make that true with as few moving parts as possible. A dotnet file, a `just` recipe, a generated client and a plain CSS file are each small, and each can be read by the next person without a tutorial.

The trade-offs are real. Choosing `just` added a tool to install. Choosing .NET for the driver made the examples harder to find. Choosing TanStack Router made the router a little less familiar. Choosing an orphan branch for images makes a reviewer learn a convention that GitHub itself does not teach. In each case we took the cost for something we could explain, check and change later, which is how the records describe every decision here.

If you want to make your first change, start with `just setup`, then read the decision for the part you touch. If you want to see the result, run the app as the `run-calendar` skill describes, take a before picture, change the code, take an after picture, and publish both with the `github-screenshots` skill. You will learn more about the stack in those few steps than in this article.
