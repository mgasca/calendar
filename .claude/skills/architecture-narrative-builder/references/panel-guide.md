# Panel guide

How the facilitator names the expert panel, proposes the synergy/conflict map, calls the `narrative-panel` workflow and uses what comes back. The role briefs and their six fields (concern, voice, standing question, evidence, pushback, tensions) are in [experts/](experts/README.md); the workflow's argument and return shapes are the contract posted on issue #708 and implemented in `.claude/workflows/narrative-panel.js`.

## Naming the panel

- One **characteristic** expert per driving characteristic (three to five), named after it ("Elasticity expert").
- One **end-user** expert: speaks for the people who use the system day to day.
- One **business** expert: speaks for the sponsor, budget, deadline and outcome.

Show the panel to the user with one line per expert (its concern in the user's own terms) before proposing the map.

## Proposing the synergy/conflict map

For every pair of experts, propose one relation with a one-line reason grounded in this narrative, not in general:

- **synergy**: their concerns reinforce each other here (Availability and Fault tolerance: both want the partner outage contained).
- **conflict**: satisfying one costs the other here (Elasticity and Cost: scale-out capacity for the term-start peak raises the monthly bill the Business expert caps).
- **neutral**: their concerns do not meet in this system.

Mark only the pairs whose concerns genuinely meet; most pairs are neutral. Present the map as a table (pair, relation, reason) and ask the user to confirm or correct it, with options: confirm; change a pair; add a reason. Save the confirmed map in the ledger. Rebuttal rounds send an expert only the verdicts of the experts it is in synergy or conflict with, so a wrong map means a missed debate or wasted context.

## Building the arguments

Call `.claude/workflows/narrative-panel.js` with the Workflow tool and its `scriptPath`, and these `args`:

```js
{
  phase: "questions",                         // or "alternatives", "review"
  parts: ["docs/narratives/<system>/01-setup.md"],
  experts: [
    {
      id: "elasticity", role: "characteristic", name: "Elasticity expert",
      characteristic: "elasticity",
      requirement: "<the business requirement, quoted from the ledger>",
      target: "<the measurable target>",
      // brief: { concern, voice, question, evidence, pushback, tensions } only to override a field of the reference brief
      // for this system (an override replaces the field), for example to name the real end users or the sponsor
    },
    { id: "end-user", role: "end-user", name: "End-User expert" },
    { id: "business", role: "business", name: "Business expert" },
  ],
  map: [{ a: "elasticity", b: "business", relation: "conflict", reason: "<from the confirmed map>" }],
  alternatives: [{ id: "A1", title: "<title>", summary: "<trade-offs>" }], // alternatives phase only
  focus: "<what this round is about: the act, a decision, an open gap>",
}
```

- `parts` names only the parts the round needs (see the table in SKILL.md); experts read nothing else.
- A characteristic expert without `requirement` or `target` is told that is a gap: close it with the user before the round rather than sending it empty.
- List neutral pairs too when the user discussed them; an unlisted pair is treated as neutral.
- `{ invalid: [reasons] }` means no agent ran: fix the arguments and call once more.

## Using the results

The return has one entry per expert (`initial`, `final` after its rebuttal, `status`), the `routing` (who saw whose verdict) and a `log`. Work from each expert's `final` payload.

- **questions**: merge the experts' questions, drop those the ledger already answers, merge duplicates, and keep each question's `gap` and suggested `options`. Add new gaps to the ledger. Ask them in AskUserQuestion batches of at most four, high priority first. Mention an expert's role only when it helps the user understand why the question matters.
- **alternatives**: each verdict rates an alternative from 0 (does not meet the expert's concern) to 3 (fully meets it) in half steps, the star scale of the ADR tables. Summarise per alternative the ratings and stances, and the strongest reason for and against. Present the trade-off to the user as a question (which alternative, or what would change the verdict); record the reasons in Act 2.
- **review**: for each objection, propose its `outcome` (revision, risk or open question) to the user, settle it, and apply it to the part, the risk table or the open questions. An expert with `sign-off` needs no action. Criterion: every objection is visible in the narrative.

Record each round in the ledger: phase, date, experts that answered, experts that `returned nothing`, and what changed. Never paste raw panel output into a part; `05-panel.md`, when asked for, summarises sign-offs and objections with their outcomes, by role.
