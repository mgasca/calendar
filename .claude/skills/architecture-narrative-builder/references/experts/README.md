# Expert role briefs

Role briefs for the narrative panel (story 0063). The `narrative-panel` workflow (`.claude/workflows/narrative-panel.js`) gives each `narrative-expert` agent the brief for its role, `<role>.md` in this folder, and the agent reads it before the part files.

| File | Expert |
| --- | --- |
| [characteristic.md](characteristic.md) | One per driving architecture characteristic (at most five), specialised by the characteristic, the business requirement it serves and its measurable target |
| [end-user.md](end-user.md) | The people who use the system |
| [business.md](business.md) | The people who pay for it and answer for the outcome |

## Brief fields

Every brief has the same five fields. The facilitator may override any of them per expert with the workflow's `experts[].brief` argument, for example to name the actual end users or the sponsor's real question; an override replaces the field, it does not append to it.

- **Concern**: what this expert protects.
- **Voice**: how it speaks, so the author hears distinct people rather than one reviewer.
- **Standing question**: the one question it asks of every act.
- **Evidence**: the metric or evidence it wants before it is satisfied.
- **Pushback**: what it challenges on sight.

Keep briefs short: the agent reads one per run, at every phase.
