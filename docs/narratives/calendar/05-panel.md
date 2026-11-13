## Appendix: Expert panel

The narrative was reviewed by a panel of expert agents, one per driving characteristic plus an end-user and a business expert. The panel asked questions after Act 1, rated the 23 alternatives of Act 2 and reviewed Act 3. In Act 2 the chosen alternative had the highest average rating for every decision; the closest was CI time, where path-scoped jobs with run-time gates scored 2.1 of 3 against 2.0 for every job on every change.

| Expert | Verdict | Objections and their outcome |
| --- | --- | --- |
| Verifiability | object | The decisions are credited with proving a change, without evidence of what causes correction rounds, and review is optional: revision (characteristics table, D7). The baseline is a single count with no source, repeat or response: revision (the checkpoint; risk 1 impact raised to high). Nobody notices a missed target: revision (the checkpoint). |
| Auditability | object | "Nothing enforces" ignored the hook on the completing pull request, and the likelihood had no figure: revision (characteristics table; the checkpoint measures the link rate). D7 merged without an ADR and "significant" is undefined: revision (known exception) and open question. The status of ADR-0057: checked, accepted, no change. |
| Portability of the method | object | D2 was credited with making the bundle portable: revision (characteristics table, D2). The portability test has no pass criterion: open question. The bundle's prerequisites are undocumented: risk 11. |
| Delivery speed | object | A missed ceiling was rated low impact, with re-pinning as the mitigation: revision (risk 6 impact raised to medium; the checkpoint). Per-job gates cannot bound total CI time: revision (D6, characteristics table). The wait for reviewers has no metric: open question (the cost of the method). |
| Correctness of time | object | The matrix is not sized: open question. Time tests can be skipped by design: open question. Divergence of time-zone data rated low likelihood: declined by the maintainer, the rating stands (risk 7). No risk for a wrong clock, a stale Today or an unknown zone: risk 12. |
| End user | sign-off | None. |
| Business | object | No risk had a checkpoint: revision (the checkpoint, tied to the next story card). The limit to Claude Code was not tied to adoption: revision (D2). The cost of the method is not sized: open question. |
