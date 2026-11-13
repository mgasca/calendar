## Appendix: Expert panel

The narrative was challenged by a panel of six experts: one per driving characteristic (verifiability, delivery speed, correctness of time, and security and privacy), plus an end-user expert and a business expert. Rebuttals were limited to the pairs whose concerns meet: verifiability conflicts with delivery speed and with the end user; delivery speed conflicts with correctness of time and with security; security conflicts with the end user; the end user conflicts with the business; the remaining related pairs are in synergy.

For this first narrative the expert agents could not run (they were not available to the session that built it), so the facilitator voiced each expert from its brief, and the narrator settled every disagreement. The independent panel dialogue is still to be verified on a later revision.

| Expert | Verdict | Objections and their outcome |
| --- | --- | --- |
| Verifiability | object | The correction-rounds outcome is not measured: a risk, with a dashboard measure as mitigation. The failing-test rule is enforced by guidance and review, not automation: revised in Act 3. |
| Delivery speed | object | Rust builds lengthen CI: accepted, held by the run-time gate (Act 2). PR 0 adds a review round: kept, with delivery stacked on it (Act 2). Review before merge costs time: kept for code pull requests only (Act 2). "Met" needed evidence: revised with measured job times (Act 3). |
| Correctness of time | sign-off | The day rules are supplied by the client and tested in domain and SQL forms against a zone and daylight-saving matrix. |
| Security and privacy | object | Owner isolation without row-level security: an open question and a risk. Hooks protect Claude Code sessions only: a risk. |
| End user | sign-off | The single user does not yet rely on Calendar daily, so failures cost little today; correctness of time protects the experience that matters. |
| Business | object | Two success signs have no owner or date: an accepted risk. Run cost is untracked: assumption A1 and a risk. |
