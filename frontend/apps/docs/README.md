# Documentation site

[![Documentation](https://img.shields.io/badge/Documentation-blue?style=flat-square&logo=readme)](https://mgasca.github.io/calendar/)

The Astro + Starlight site opens on the first agent thought, the report on why the repository exists (`/` redirects to the first report in the `docs/agent-thoughts/` index), and renders the canonical Markdown in `docs/agent-thoughts/` (the dated agent perspectives on the repository, at `/agent-thoughts/NNNN/`, in the **Agent thoughts** group directly after **Architecture**), `docs/decisions/` (each ADR at `/adr/NNNN/`, listed with its status in the sidebar; the decision log table itself is not a page) and `docs/stories/` (the user stories, at `/stories/NNNN/`), and the FINOS CALM model in `docs/architecture/` (the **Architecture** section, at `/architecture/`: context and container diagrams, a page per component and per business flow, and the controls, all generated from the model and linked to their ADRs; see [ADR-0039](../../../docs/decisions/0039-architecture-model-and-visualization-tooling.md)), the runbooks in `docs/runbooks/` (at `/runbooks/<name>/`, in the order of their index) and the benchmark records in `docs/benchmarks/` (at `/benchmarks/NNNN/`). Every ADR and story merged to `main` is published, including proposed and superseded decisions. Links between agent thoughts, ADRs, stories, runbooks and benchmarks, and from any of them to the code they reference, work on the published site. Edit the sources there; generated pages are build output and are not committed. Practices for changing the site's code are in the [frontend AGENTS.md](../../AGENTS.md#docs-site-appsdocs).

## Common tasks

These need Node and pnpm (run `just frontend install` first), but not the backend or database.

| Task                                                                             | Command                  |
| -------------------------------------------------------------------------------- | ------------------------ |
| Run the site (http://localhost:4321)                                             | `just docs dev`          |
| Build and verify the static output in `frontend/apps/docs/dist`                  | `just docs build`        |
| Preview the built site                                                           | `just docs preview`      |
| Run the site's tests (a file or pattern narrows them)                            | `just docs test`         |
| Validate the architecture model                                                  | `just docs architecture` |
| Run the docs benchmark by hand (results in `docs/benchmarks/`; never part of CI) | `just docs bench`        |

To reproduce the GitHub Pages project path locally:

```sh
DOCS_SITE_URL=https://mgasca.github.io/calendar/ just docs build
DOCS_SITE_URL=https://mgasca.github.io/calendar/ just docs preview
# Open http://localhost:4321/calendar/
```

`DOCS_SITE_URL` is the full public URL, including any project path. The site derives its origin and base path from this URL, so custom domains and root-hosted sites work without hard-coded `/calendar/` links. Local development defaults to the site root.

## Publishing

GitHub Pages uses **Settings → Pages → Build and deployment → Source: GitHub Actions**. CI builds and checks the site for pull requests, merge queues, and manual runs. Successful `main` push builds update production; successful same-repository PR builds update their preview. The separate **Publish ADR site** workflow accepts artifacts only from successful CI runs with a current source revision, then publishes through the `github-pages` environment. Keep its deployment branch rule restricted to `main`: the publisher runs trusted default-branch workflow code even when publishing PR artifacts.

The configured publication URL is [mgasca.github.io/calendar](https://mgasca.github.io/calendar/). The site becomes available after the workflow's first successful deployment from `main`; an unmerged branch or pull request does not update it.

## Pull request previews

After CI succeeds, a PR from this repository gets an **ADR preview** check and one sticky PR comment, both linking to `https://mgasca.github.io/calendar/pr-preview/pr-<number>/`. The comment is updated in place on each new preview. Each new successful revision replaces that PR's preview; closing or merging the PR removes it. Fork PRs run CI but do not publish previews. Manual CI runs and merge-queue runs do not publish either.

The publisher retains generated production files and preview directories on the `gh-pages` branch. That branch is storage for the combined artifact, **not** the Pages publishing source: leave Pages configured for GitHub Actions. A production update preserves open previews, a preview update preserves production, and queued publication serializes snapshot reads, updates, and deployment. The publisher also removes closed PR directories during subsequent publications. Do not edit the generated branch manually.

The privileged publisher downloads only static artifacts, rejects non-regular and reserved paths, and never checks out or executes PR code. It rechecks the current PR head or `main` revision before updating the snapshot. Previews share the production origin, so they are intended for trusted repository contributors; unreviewed preview JavaScript has the same origin as production documentation. No third-party hosting account or extra deployment secret is needed. See [ADR-0025](../../../docs/decisions/0025-github-pages-pr-previews.md).

**First setup:** merge the preview infrastructure into `main` first. Its successful CI run creates the initial production snapshot. Then rerun CI by pushing a commit to the UI PR branch (or use GitHub's **Re-run all jobs** on its `pull_request` run). GitHub loads `workflow_run` automation from the default branch, so an unmerged infrastructure PR cannot enable its own preview. A preview run arriving before the first production snapshot is skipped with a notice; rerun that PR's CI after production succeeds. The preview URL appears in the PR's **ADR preview** check and publisher run summary. If the publisher fails, inspect **Actions → Publish ADR site** and rerun that workflow; do not dispatch CI manually to publish.
