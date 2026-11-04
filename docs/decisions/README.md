# Architecture Decision Records

Decisions are recorded in [MADR 4.0](https://adr.github.io/madr/) format. To add one, copy [`adr-template.md`](adr-template.md) to `NNNN-short-title.md`.

Every record lists its **decision drivers**, rates each option against them in a table (drivers as rows, options as columns, ★★★ to ☆☆☆), and gives pros and cons for every option in terms of those drivers. See [ADR-0000](0000-use-markdown-architectural-decision-records.md) for the conventions.

- **Drafting with an AI agent:** the [`adr-draft`](../../.claude/skills/adr-draft/SKILL.md) skill walks through the whole process: drivers, research, writing, validation and the review PR.
- **Status:** `proposed` while the decision is under review, `accepted` as soon as the user approves it (set in the same PR, before it merges), then `superseded by [ADR-NNNN](NNNN-….md)` if replaced. Status records whether a decision was **taken**, not whether it has been **delivered**: never wait for the implementation, build or rollout before accepting. Track delivery in issues and PRs.
- **Validation:** `just tools adr` (also part of `just lint` and CI) checks numbering, structure, rating tables, driver coverage and links.
- **The log:** there is no hand-maintained list here ([ADR-0040](0040-derive-the-decision-log-from-the-adr-files.md)). The decision log is derived from the `NNNN-*.md` files: the file name gives the number and the order, the `# Title` gives the title and the front matter gives the status. Browse it on the [documentation site](https://mgasca.github.io/calendar/), under **Architecture decisions**, or with `ls docs/decisions`.
