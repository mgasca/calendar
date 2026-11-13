# Ledger: Ticket Kata

Never published or stitched. The interview resumes from this file.

## Progress

| Act | State |
| --- | --- |
| Act 1: Setup | confirmed 2026-11-13 |
| Driving characteristics | confirmed 2026-11-13 |
| Act 2: Confrontation | confirmed 2026-11-13 |
| Act 3: Resolution | confirmed 2026-11-13 |

## Gaps

| Id | Act | Gap | State | Answer or assumption |
| --- | --- | --- | --- | --- |
| S1 | 1 | Problem | closed | Paper sales oversell popular concerts. |
| S4 | 1 | Why now | closed | 120 oversold seats last season; promoters at risk. |

## Assumptions

| Id | Statement | Agreed | Risk |
| --- | --- | --- | --- |
| A1 | Tills are offline for at most an hour | 2026-11-13 | Act 3 risk |

## Driving characteristics

| Characteristic | Requirement | Target | State |
| --- | --- | --- | --- |
| Consistency | "No seat may be sold twice" | Zero oversold seats per season | driving |
| Elasticity | "Popular concerts sell out within minutes" | 2,000 concurrent buyers, p95 hold under 2 s | driving |
| Cost | "A budget of 30,000 euros" | Run cost under 300 euros a month outside on-sales | driving |

## Panel

| Id | Role | Name |
| --- | --- | --- |
| consistency | characteristic | Consistency expert |
| elasticity | characteristic | Elasticity expert |
| cost | characteristic | Cost expert |
| end-user | end-user | End-User expert |
| business | business | Business expert |

### Synergy/conflict map (confirmed 2026-11-13)

| Pair | Relation | Reason |
| --- | --- | --- |
| elasticity / cost | conflict | Scale-out for on-sales raises the run cost |
| consistency / elasticity | conflict | One writer per concert limits parallel holds |
| end-user / business | synergy | Fair on-sales keep fans and promoters |

### Rounds

| Phase | Date | Answered | Returned nothing | What changed |
| --- | --- | --- | --- | --- |
| questions | 2026-11-13 | 5 | none | Added the offline-tills constraint |
| alternatives | 2026-11-13 | 5 | none | Row lock rejected on elasticity |
| review | 2026-11-13 | 5 | none | Elasticity objected to offline sales: risk A1 added; others signed off |

## Options

Mode: build. Panel appendix: no.
