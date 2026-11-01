---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# Use Markdown Architectural Decision Records

## Context and Problem Statement

We want to record the architectural and tooling decisions made in this project, together with their reasons, so that later contributors (human or AI) understand why things are the way they are. Which format should we use, and where should records live?

## Decision Drivers

* **D1 Rationale capture**: records must show *why* an option won, including the alternatives and trade-offs, not just *what* was chosen.
* **D2 Proximity to code**: records are versioned and reviewed in the same PRs as the changes they justify.
* **D3 Low authoring effort**: writing a record should be quick enough that it actually happens.
* **D4 Machine & human readability**: plain, consistently structured text that both people and AI agents can read, search and update.

## Considered Options

* MADR 4.0 in `docs/decisions/`, extended with a driver rating table
* Michael Nygard's ADR template in `docs/decisions/`
* No formal records (commit messages, PR descriptions and README)
* External wiki (GitHub Wiki / Confluence)

## Decision Outcome

Chosen option: "MADR 4.0 in `docs/decisions/`, extended with a driver rating table", because it scores best on rationale capture (D1) and proximity to code (D2), and the extra effort over Nygard (D3) is small.

| Driver | **MADR 4.0 + rating table (chosen)** | Nygard ADR | No formal records | External wiki |
| --- | :---: | :---: | :---: | :---: |
| D1 Rationale capture | ★★★ | ★★☆ | ☆☆☆ | ★★☆ |
| D2 Proximity to code | ★★★ | ★★★ | ★★☆ | ☆☆☆ |
| D3 Low authoring effort | ★★☆ | ★★★ | ★★★ | ★★☆ |
| D4 Machine & human readability | ★★★ | ★★☆ | ★☆☆ | ★☆☆ |

Project conventions on top of MADR:

* Every record lists **Decision Drivers** with short IDs (`D1`, `D2`, …).
* Every considered option has **pros and cons**, each stated in terms of a driver (`Good, because **D1 …**: …`).
* The Decision Outcome contains a **rating table**: drivers as rows, options as columns, with the chosen option in bold and marked "(chosen)". Records covering several related decisions have one table per decision.
* Star scale: ★★★ fully meets · ★★☆ mostly meets · ★☆☆ partially meets · ☆☆☆ does not meet. Ratings are relative to the other options considered, not absolute.

### Consequences

* Good, because a reader can see from the table why an option won, then read the pros and cons for detail.
* Good, because records change in the same PRs as the code they affect.
* Bad, because records take more effort than a plain Nygard ADR. Mitigated by [`adr-template.md`](adr-template.md).
* Neutral: superseded decisions get a new record, and the old one's status becomes "superseded by ADR-NNNN".

### Confirmation

New significant decisions arrive in PRs as `docs/decisions/NNNN-title-with-dashes.md`, copied from the template (or drafted with the `adr-draft` agent skill in `.claude/skills/adr-draft/`). The skill's validator, `scripts/check-adr/check-adr.cs` (a .NET file-based app with its own tests, per [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)), runs as `just adr-check`, in `just lint` and in the CI `Tooling` job. It enforces front matter, section order, driver format, rating-table shape and star values, one pros/cons section per option, driver coverage, linked cross-references and the index. Reviewers still judge whether the ratings are fair. The PR template includes an ADR checklist item.

## Pros and Cons of the Options

### MADR 4.0 + rating table

* Good, because **D1 Rationale capture**: options, pros and cons, and a rating table make the reasoning explicit and comparable.
* Good, because **D2 Proximity to code**: Markdown in the repo, reviewed in PRs.
* Good, because **D4 Machine & human readability**: fixed headings and tables are easy to scan and for agents to parse and update.
* Bad, because **D3 Low authoring effort**: more sections to fill in than Nygard; the rating table adds work.

### Nygard ADR

* Good, because **D3 Low authoring effort**: only Context / Decision / Consequences.
* Good, because **D2 Proximity to code**: also Markdown in the repo.
* Bad, because **D1 Rationale capture**: no structured place for rejected alternatives, so trade-offs are often lost.
* Bad, because **D4 Machine & human readability**: free-form prose is less consistent across records.

### No formal records

* Good, because **D3 Low authoring effort**: nothing extra to write.
* Bad, because **D1 Rationale capture**: reasoning is scattered or never written down.
* Bad, because **D4 Machine & human readability**: requires mining commit history to answer "why".
* Neutral, because **D2 Proximity to code**: commit messages are versioned with code but not discoverable by topic.

### External wiki

* Good, because **D1 Rationale capture**: any structure can be used.
* Bad, because **D2 Proximity to code**: not versioned or reviewed with code; drifts out of date.
* Bad, because **D4 Machine & human readability**: not in the checkout, so coding agents cannot see it.
* Neutral, because **D3 Low authoring effort**: similar to MADR, plus context switching.

## More Information

* <https://adr.github.io/madr/>
